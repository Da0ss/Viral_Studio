import { execFileSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';
import { detectClientSecrets } from './lib/client-secrets.mjs';

const root = new URL('../', import.meta.url);
const cwd = fileURLToPath(root);
const values = [];
const sensitiveName = /(?:SERVICE_ROLE|SECRET|PASSWORD|PRIVATE_KEY|ACCESS_TOKEN|API_KEY|HF_TOKEN|HUGGING_FACE_HUB_TOKEN)/i;
function collect(env) {
  for (const [name, value] of Object.entries(env)) {
    if (sensitiveName.test(name) && value) values.push({ name, value });
  }
}
collect(process.env);
for (const file of ['.env', '.env.local', '.env.production', '.env.production.local']) {
  try { collect(parseEnv(await readFile(new URL(file, root), 'utf8'))); }
  catch (error) { if (error.code !== 'ENOENT') throw new Error('Cannot inspect environment file'); }
}
const git = (...args) => execFileSync('git', args, { cwd, maxBuffer: 32 * 1024 * 1024 });
let failures = 0;
function inspect(bytes, label) {
  // The detector's explicitly named synthetic regression fixture is not a key.
  const content = bytes.toString('utf8').replaceAll('sb_secret_fake_only_test_value', 'synthetic-test-fixture');
  const findings = detectClientSecrets(content, values);
  if (findings.length) {
    console.error(`FAIL: ${label}: ${findings.join(', ')}`);
    failures++;
  }
}

try {
  const objects = [...new Set(git('rev-list', '--objects', '--all', 'HEAD').toString().trim().split('\n').map(line => line.split(' ')[0]).filter(Boolean))];
  let blobs = 0;
  const metadata = execFileSync('git', ['cat-file', '--batch-check'], {
    cwd, input: objects.join('\n') + '\n', maxBuffer: 32 * 1024 * 1024,
  }).toString().trim().split('\n').map(line => line.split(' '));
  const blobIds = metadata.filter(([, type, size]) => {
    if (type === 'blob' && Number(size) > 16 * 1024 * 1024) throw new Error('History blob exceeds audit size limit');
    return type === 'blob';
  }).map(([oid]) => oid);
  const batch = execFileSync('git', ['cat-file', '--batch'], {
    cwd, input: blobIds.join('\n') + '\n', maxBuffer: 32 * 1024 * 1024,
  });
  let offset = 0;
  for (const oid of blobIds) {
    const newline = batch.indexOf(10, offset);
    const [returnedOid, type, sizeText] = batch.subarray(offset, newline).toString().split(' ');
    const size = Number(sizeText);
    if (newline < offset || returnedOid !== oid || type !== 'blob' || !Number.isSafeInteger(size)) throw new Error('Invalid Git batch response');
    offset = newline + 1;
    inspect(batch.subarray(offset, offset + size), `history blob ${oid.slice(0, 12)}`);
    offset += size + 1;
    blobs++;
  }
  const paths = git('ls-files', '-z', '--cached', '--others', '--exclude-standard').toString().split('\0').filter(Boolean);
  for (const path of paths) {
    try { inspect(await readFile(new URL(path.replaceAll('\\', '/'), root)), 'workspace file'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  let serverFiles = 0;
  async function inspectServer(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const url = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory);
      if (entry.isDirectory()) await inspectServer(url);
      else if (/\.(?:js|json|map)$/.test(entry.name)) {
        inspect(await readFile(url), 'server build file');
        serverFiles++;
      }
    }
  }
  await inspectServer(new URL('.next/server/', root));
  console.log(`${failures ? 'FAIL' : 'PASS'}: ${blobs} historical blobs, ${paths.length} workspace paths, ${serverFiles} server build files scanned.`);
  console.log('Scope: all fetched Git refs, current non-ignored files, built SSR files; known configured values and Supabase/Hugging Face token patterns. Not a proof against unknown or obfuscated credentials.');
  if (failures) process.exitCode = 1;
} catch {
  // Do not print command errors: Git output could contain historical credentials.
  console.error('FAIL: secret audit could not inspect its entire declared scope. Fetch full history and build first.');
  process.exitCode = 1;
}
