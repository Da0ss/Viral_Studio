import { readFile, readdir } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { detectClientSecrets } from './lib/client-secrets.mjs';
const root = new URL('../', import.meta.url);
const secretName = /(?:SERVICE_ROLE|SECRET|PASSWORD|PRIVATE_KEY|ACCESS_TOKEN|API_KEY|HF_TOKEN|HUGGING_FACE_HUB_TOKEN)/i;
const values = [];
function collect(env) {
  for (const [name, value] of Object.entries(env)) {
    if (secretName.test(name) && value) values.push({ name, value });
  }
}
collect(process.env);
for (const file of ['.env', '.env.local', '.env.production', '.env.production.local']) {
  try { collect(parseEnv(await readFile(new URL(file, root), 'utf8'))); }
  catch (error) { if (error.code !== 'ENOENT') throw new Error('Cannot inspect local environment file'); }
}
async function files(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const url = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory);
    if (entry.isDirectory()) result.push(...await files(url));
    else if (/\.(?:js|json|map|css)$/.test(entry.name)) result.push(url);
  }
  return result;
}
try {
  const bundleFiles = await files(new URL('.next/static/', root));
  if (!bundleFiles.length) throw new Error('No client bundle: run pnpm build first');
  let failed = false;
  for (const file of bundleFiles) {
    const findings = detectClientSecrets(await readFile(file, 'utf8'), values);
    if (findings.length) {
      // Never print a credential or matching source excerpt.
      console.error(`FAIL: server-secret exposure in ${decodeURIComponent(file.pathname)} (${findings.join(', ')})`);
      failed = true;
    }
  }
  if (failed) process.exitCode = 1;
  else console.log(`PASS: ${bundleFiles.length} client files checked; ${new Set(values.map(item => item.name)).size} configured sensitive variable names compared.`);
  console.log('Scope: literal/escaped/URL-encoded values of at least 12 characters and Supabase secret/JWT patterns. Not a repository-history or obfuscated-secret audit.');
} catch (error) { console.error(`FAIL: ${error.message}`); process.exitCode = 1; }
