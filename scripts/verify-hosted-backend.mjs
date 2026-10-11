import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Read only the app's local environment file. Values are retained in memory and
// never included in diagnostics or output.
try {
  const envText = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8');
  for (const line of envText.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z\d_]*)\s*=\s*(.*?)\s*$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[match[1]] = value;
  }
} catch { /* Environment may be supplied by the invoking process instead. */ }

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const appUrl = process.env.HOSTED_APP_BASE_URL || process.env.NEXT_PUBLIC_APP_URL;
const timeoutMs = 8_000;

function requireConfig(name, value) {
  if (!value) throw new Error(`Missing required configuration: ${name}`);
}

async function request(label, url, init = {}, expected) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs), redirect: 'manual' });
  const contentType = response.headers.get('content-type') ?? '';
  const body = await response.text();
  console.log(`${label}: HTTP ${response.status}${contentType ? ` (${contentType.split(';')[0]})` : ''}`);
  if (expected && !expected.includes(response.status)) throw new Error(`${label} returned an unexpected HTTP status.`);
  return { status: response.status, body };
}

async function main() {
  requireConfig('NEXT_PUBLIC_SUPABASE_URL', supabaseUrl);
  requireConfig('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY', publishableKey);
  requireConfig('HOSTED_APP_BASE_URL or NEXT_PUBLIC_APP_URL', appUrl);

  const supabase = new URL(supabaseUrl);
  const app = new URL(appUrl);
  if (!['https:', 'http:'].includes(supabase.protocol) || !['https:', 'http:'].includes(app.protocol)) {
    throw new Error('Configured endpoints must use HTTP or HTTPS.');
  }

  const authHeaders = { apikey: publishableKey };
  await request('Supabase Auth health', new URL('/auth/v1/health', supabase), { headers: authHeaders }, [200]);
  const anonymousProjects = await request('Anonymous projects query (RLS probe)', new URL('/rest/v1/projects?select=id&limit=1', supabase), {
    headers: { ...authHeaders, Authorization: `Bearer ${publishableKey}`, Accept: 'application/json' },
  }, [200]);
  if (anonymousProjects.status === 200) {
    let rows;
    try { rows = JSON.parse(anonymousProjects.body); } catch { throw new Error('Anonymous projects query returned invalid JSON.'); }
    if (!Array.isArray(rows) || rows.length !== 0) throw new Error('Anonymous RLS probe returned visible project rows.');
    console.log('Anonymous projects visibility: zero rows');
  }

  await request('Guest generation history', new URL('/api/generations', app), {}, [401]);
  await request('Invalid generation query (proxy boundary)', new URL('/api/generations?unexpected=1', app), {}, [401]);
  await request('Worker endpoint without credential', new URL('/api/internal/workers', app), {}, [401, 503]);
  await request('Worker metrics without credential', new URL('/api/internal/worker-metrics', app), {}, [401, 503]);
  await request('Cleanup endpoint without credential', new URL('/api/internal/media-cleanup', app), { method: 'POST' }, [401, 503]);
  await request('Upload reconcile without credential', new URL('/api/internal/media-upload-reconcile', app), { method: 'POST' }, [401, 503]);

  console.log('Read-only probes finished. No authentication, database writes, Storage objects, or provider calls were attempted.');
}

main().catch(error => {
  console.error(`Hosted backend verification failed: ${error.message}`);
  process.exitCode = 1;
});
