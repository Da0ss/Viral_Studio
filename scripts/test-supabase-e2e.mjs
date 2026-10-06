import { randomBytes, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createClient } from '@supabase/supabase-js';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function collectValues(value, result = new Map(), prefix = '') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
  for (const [key, nested] of Object.entries(value)) {
    const normalized = key.toLowerCase().replace(/[^a-z\d]/g, '_');
    const path = prefix ? `${prefix}_${normalized}` : normalized;
    if (typeof nested === 'string' && nested) result.set(path, nested);
    else collectValues(nested, result, path);
  }
  return result;
}

function pick(values, ...keys) {
  for (const key of keys) {
    for (const [path, value] of values) {
      if (path === key || path.endsWith(`_${key}`)) return value;
    }
  }
}

async function removeProjectObjects(admin, projectId) {
  const bucket = admin.storage.from('project-media');
  async function list(path) {
    const all = [];
    for (let offset = 0; ; offset += 100) {
      const { data, error } = await bucket.list(path, { limit: 100, offset });
      if (error) throw error;
      all.push(...(data ?? []));
      if (!data || data.length < 100) break;
    }
    return all;
  }
  async function walk(path) {
    const objects = await list(path);
    const files = objects.filter(object => object.id).map(object => `${path}/${object.name}`);
    for (const directory of objects.filter(object => !object.id)) {
      files.push(...await walk(`${path}/${directory.name}`));
    }
    return files;
  }
  const paths = await walk(`projects/${projectId}`);
  if (paths.length) {
    const { error } = await bucket.remove(paths);
    if (error) throw error;
  }
}

function assertLoopback(raw, label) {
  let url;
  try { url = new URL(raw); } catch { throw new Error(`Supabase status returned an invalid ${label}.`); }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '::1'].includes(host)) {
    throw new Error(`Refusing to run authenticated browser acceptance against a non-local ${label}.`);
  }
  return url;
}

async function localCredentials() {
  let stdout;
  try {
    ({ stdout } = await execFileAsync(process.execPath, [
      resolve(root, 'node_modules', 'supabase', 'dist', 'supabase.js'),
      '--workdir', root, 'status', '--output', 'json',
    ], { cwd: root, windowsHide: true, timeout: 30_000, maxBuffer: 1024 * 1024,
      env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: '1' } }));
  } catch {
    throw new Error('Could not read local Supabase status. Start the disposable local stack first.');
  }
  let status;
  try { status = JSON.parse(stdout); } catch { throw new Error('Supabase CLI did not return status JSON.'); }
  const values = collectValues(status);
  const url = pick(values, 'api_url', 'supabase_url');
  const anonKey = pick(values, 'anon_key', 'publishable_key');
  const serviceRoleKey = pick(values, 'service_role_key', 'secret_key');
  if (!url || !anonKey || !serviceRoleKey) throw new Error('Local Supabase status omitted API credentials.');
  assertLoopback(url, 'API URL');
  return { url: new URL(url).origin, anonKey, serviceRoleKey };
}

async function run(script, args, env) {
  await new Promise((resolvePromise, reject) => {
    const child = execFile(process.execPath, [resolve(root, script), ...args], {
      cwd: root, env, windowsHide: true, maxBuffer: 8 * 1024 * 1024,
    }, error => error ? reject(new Error(`${script} failed; see the preceding command output.`)) : resolvePromise());
    child.stdout?.pipe(process.stdout);
    child.stderr?.pipe(process.stderr);
  });
}

async function main() {
  const credentials = await localCredentials();
  const admin = createClient(credentials.url, credentials.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const suiteId = randomUUID();
  const password = `${randomBytes(32).toString('base64url')}Az9!`;
  const organizationName = `Browser acceptance ${suiteId}`;
  const fixture = { desktopOwner: null, desktopViewer: null, mobileOwner: null, mobileViewer: null };
  let primaryFailure;
  try {
    for (const role of Object.keys(fixture)) {
      const email = `browser-${role}-${suiteId}@example.invalid`;
      const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      if (error || !data.user) throw new Error(`Could not create the temporary ${role} Auth identity.`);
      fixture[role] = { id: data.user.id, email };
    }

    const env = {
      ...process.env,
      CI: 'true',
      GENERATION_ENABLED: 'false',
      NEXT_PUBLIC_SUPABASE_URL: credentials.url,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: credentials.anonKey,
      NEXT_PUBLIC_APP_URL: 'http://127.0.0.1:3001',
      E2E_MAIL_URL: 'http://127.0.0.1:54324',
      E2E_DESKTOP_OWNER_EMAIL: fixture.desktopOwner.email,
      E2E_DESKTOP_VIEWER_EMAIL: fixture.desktopViewer.email,
      E2E_MOBILE_OWNER_EMAIL: fixture.mobileOwner.email,
      E2E_MOBILE_VIEWER_EMAIL: fixture.mobileViewer.email,
      E2E_PASSWORD: password,
      E2E_ORGANIZATION_NAME: organizationName,
      E2E_FIXTURE_ID: suiteId,
      E2E_SUPABASE_SERVICE_ROLE_KEY: credentials.serviceRoleKey,
    };
    console.log('Building production app with the disposable local Supabase public configuration.');
    await run('node_modules/next/dist/bin/next', ['build'], env);
    console.log('Running authenticated browser acceptance against local Supabase.');
    await run('node_modules/@playwright/test/cli.js', ['test', 'tests/e2e/authenticated.spec.ts'], env);
  } catch (error) {
    primaryFailure = error;
  } finally {
    const cleanupFailures = [];
    try {
      const { data: organizations, error } = await admin.from('organizations').select('id').like('name', `${organizationName} %`);
      if (error) throw error;
      const organizationIds = (organizations ?? []).map(row => row.id);
      if (organizationIds.length) {
        const { data: projects, error: projectError } = await admin.from('projects').select('id').in('organization_id', organizationIds);
        if (projectError) throw projectError;
        const projectIds = (projects ?? []).map(row => row.id);
        if (projectIds.length) {
          for (const projectId of projectIds) await removeProjectObjects(admin, projectId);
        }
        const { error: deleteError } = await admin.from('organizations').delete().in('id', organizationIds);
        if (deleteError) throw deleteError;
      }
    } catch {
      cleanupFailures.push('temporary organization/project/media cleanup failed');
    }
    for (const role of Object.keys(fixture).reverse()) {
      if (!fixture[role]) continue;
      try {
        const { error } = await admin.auth.admin.deleteUser(fixture[role].id);
        if (error) cleanupFailures.push(`temporary ${role} Auth cleanup failed`);
      } catch {
        cleanupFailures.push(`temporary ${role} Auth cleanup failed`);
      }
    }
    if (cleanupFailures.length) {
      console.error(`Cleanup failed: ${cleanupFailures.join('; ')}. Reset the disposable local stack before reuse.`);
      process.exitCode = 1;
    }
  }
  if (primaryFailure) throw primaryFailure;
  if (process.exitCode === 1) throw new Error('Authenticated browser acceptance fixture cleanup failed.');
  console.log('Authenticated local Supabase browser acceptance passed; temporary Auth and app fixtures were removed.');
}

main().catch(error => {
  console.error(`Authenticated local Supabase browser acceptance failed: ${error.message}`);
  process.exitCode = 1;
});
