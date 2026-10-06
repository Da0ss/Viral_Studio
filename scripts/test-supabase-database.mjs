import { randomBytes } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const supabaseDirectory = path.join(root, 'supabase');
const fixtures = [
  { key: 'owner', emailLabel: 'owner', placeholder: '11111111-1111-4111-8111-111111111111' },
  { key: 'viewer', emailLabel: 'viewer', placeholder: '22222222-2222-4222-8222-222222222222' },
  { key: 'outsider', emailLabel: 'outsider', placeholder: '33333333-3333-4333-8333-333333333333' },
];

function fail(message) {
  throw new Error(message);
}

function run(command, args, { cwd, env, input, timeoutMs = 120_000 } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(command, args, {
        cwd,
        env,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch {
      reject(new Error(`Could not start ${command}`));
      return;
    }
    const stdout = [];
    const stderr = [];
    let outputSize = 0;
    let settled = false;
    const maxOutputSize = 8 * 1024 * 1024;
    const timeout = setTimeout(() => {
      settled = true;
      child.kill();
      reject(new Error(`${command} exceeded the ${timeoutMs}ms time limit`));
    }, timeoutMs);
    const finish = callback => value => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback(value);
    };
    const rejectOnce = finish(reject);
    const resolveOnce = finish(resolve);

    for (const [stream, chunks] of [[child.stdout, stdout], [child.stderr, stderr]]) {
      stream.on('data', chunk => {
        outputSize += chunk.length;
        if (outputSize > maxOutputSize) {
          settled = true;
          clearTimeout(timeout);
          child.kill();
          reject(new Error('Process output exceeded the safety limit'));
          return;
        }
        chunks.push(chunk);
      });
    }

    child.on('error', () => rejectOnce(new Error(`Could not start ${command}`)));
    child.on('close', code => resolveOnce({
      code,
      stdout: Buffer.concat(stdout).toString('utf8'),
      stderr: Buffer.concat(stderr).toString('utf8'),
    }));
    if (input === undefined) child.stdin.end();
    else child.stdin.end(input);
  });
}

function isLoopback(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host === '::1') return true;
  const octets = host.split('.');
  return octets.length === 4
    && octets.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255)
    && Number(octets[0]) === 127;
}

function requiredUrl(value, name, protocols) {
  if (typeof value !== 'string' || !value) fail(`Supabase status omitted ${name}`);
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail(`Supabase status returned an invalid ${name}`);
  }
  if (!protocols.includes(parsed.protocol) || !isLoopback(parsed.hostname)) {
    fail(`${name} must use a loopback address; refusing to connect to a non-local Supabase stack`);
  }
  return parsed;
}

function getStatusValue(status, ...names) {
  const flattened = new Map();
  const visit = (value, prefix = '') => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    for (const [key, nested] of Object.entries(value)) {
      const normalized = key.replace(/[^a-z\d]/gi, '_').toUpperCase();
      const pathKey = prefix ? `${prefix}_${normalized}` : normalized;
      if (typeof nested === 'string' && nested) flattened.set(pathKey, nested);
      visit(nested, pathKey);
    }
  };
  visit(status);
  for (const name of names) {
    const value = flattened.get(name.replace(/[^a-z\d]/gi, '_').toUpperCase());
    if (value) return value;
  }
  return undefined;
}

function parseStatus(output) {
  try {
    const parsed = JSON.parse(output);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    return parsed;
  } catch {
    fail('Could not parse `supabase status --output json`; no status values were printed');
  }
}

function psqlEnvironment(databaseUrl) {
  const query = new URLSearchParams(databaseUrl.search);
  const env = {
    ...process.env,
    PGHOST: databaseUrl.hostname.replace(/^\[|\]$/g, ''),
    PGPORT: databaseUrl.port || '5432',
    PGUSER: decodeURIComponent(databaseUrl.username),
    PGPASSWORD: decodeURIComponent(databaseUrl.password),
    PGDATABASE: decodeURIComponent(databaseUrl.pathname.replace(/^\//, '')),
    PGCONNECT_TIMEOUT: '5',
    PGAPPNAME: 'viral-studio-local-db-acceptance',
  };
  const sslMode = query.get('sslmode');
  if (sslMode) env.PGSSLMODE = sslMode;
  return env;
}

async function runSql(psqlEnv, sql, label, options = {}) {
  const result = await run('psql', ['--no-psqlrc', '--quiet', '--set', 'ON_ERROR_STOP=1', '--set', 'VERBOSITY=sqlstate', ...(options.capture ? ['--tuples-only', '--no-align'] : [])], {
    cwd: root,
    env: psqlEnv,
    input: sql,
    timeoutMs: options.timeoutMs ?? 120_000,
  });
  if (result.code !== 0) {
    // Keep diagnostics useful without exposing connection details or SQL/data.
    const sqlstate = /ERROR:\s*([0-9A-Z]{5})\b/.exec(result.stderr)?.[1];
    fail(`${label} failed in psql (exit ${result.code ?? 'unknown'}${sqlstate ? `, SQLSTATE ${sqlstate}` : ''}); inspect the local database logs for details`);
  }
  return options.capture ? result.stdout.trim() : undefined;
}

function replaceFixtureIds(sql, usersByKey) {
  let result = sql;
  for (const fixture of fixtures) {
    const user = usersByKey.get(fixture.key);
    if (!user) fail(`Missing Auth fixture ${fixture.key}`);
    result = result.replaceAll(fixture.placeholder, user.id);
  }
  return result;
}

async function main() {
  const configPath = path.join(supabaseDirectory, 'config.toml');
  try {
    await readFile(configPath, 'utf8');
  } catch {
    fail('Missing supabase/config.toml. Initialize and start a disposable local Supabase project before running this command.');
  }

  let statusResult;
  try {
    const cliEntrypoint = path.join(root, 'node_modules', 'supabase', 'dist', 'supabase.js');
    statusResult = await run(process.execPath, [cliEntrypoint, '--workdir', root, 'status', '--output', 'json'], {
      cwd: root,
      env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: '1' },
      timeoutMs: 30_000,
    });
  } catch {
    fail('Supabase CLI is unavailable. Install it and start the local Supabase stack first.');
  }
  if (statusResult.code !== 0) fail('Supabase CLI could not read local status. Start the local Supabase stack first.');

  const status = parseStatus(statusResult.stdout);
  const apiUrl = requiredUrl(getStatusValue(status, 'API_URL', 'api_url'), 'API_URL', ['http:', 'https:']);
  const databaseUrl = requiredUrl(getStatusValue(status, 'DB_URL', 'db_url'), 'DB_URL', ['postgres:', 'postgresql:']);
  const serviceRoleKey = getStatusValue(status, 'SERVICE_ROLE_KEY', 'service_role_key');
  if (!serviceRoleKey) fail('Supabase status omitted SERVICE_ROLE_KEY; refusing to create Auth fixtures');
  if (!databaseUrl.username || !databaseUrl.password || !databaseUrl.pathname.slice(1)) {
    fail('DB_URL must include a database, username, and password');
  }

  const runId = randomBytes(10).toString('hex');
  const usersByKey = new Map();
  const cleanupErrors = [];
  const password = randomBytes(32).toString('base64url');
  const psqlEnv = psqlEnvironment(databaseUrl);
  let auth;
  let seedLoaded = false;
  let passedSuiteCount = 0;

  const migrationDirectory = path.join(supabaseDirectory, 'migrations');
  const migrationFiles = (await readdir(migrationDirectory)).filter(file => file.endsWith('.sql')).sort();
  const expectedVersions = migrationFiles.map(file => {
    const match = /^(\d+)_.*\.sql$/.exec(file);
    if (!match) fail(`Migration filename does not start with a version: ${file}`);
    return match[1];
  }).sort();
  const preflightJson = await runSql(psqlEnv, `
    select json_build_object(
      'versions', coalesce((select json_agg(version::text order by version::text) from supabase_migrations.schema_migrations), '[]'::json),
      'seed_fixture_exists', exists(select 1 from public.organizations where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
    )::text;
  `, 'local database preflight', { capture: true, timeoutMs: 30_000 });
  let preflight;
  try {
    preflight = JSON.parse(preflightJson);
  } catch {
    fail('Could not read local migration preflight results');
  }
  if (!Array.isArray(preflight.versions)) fail('Local migration catalog returned an unexpected result');
  const actualVersions = preflight.versions.map(String).sort();
  if (JSON.stringify(actualVersions) !== JSON.stringify(expectedVersions)) {
    fail(`Local migration catalog does not exactly match this checkout (${actualVersions.length} applied, ${expectedVersions.length} expected). Reset the disposable local database first.`);
  }
  if (preflight.seed_fixture_exists) {
    fail('The deterministic seed organization already exists. Reset the disposable local database before running acceptance suites.');
  }
  console.log(`Local PostgreSQL preflight passed: ${actualVersions.length} migration versions match this checkout; seed fixture is absent.`);

  const timedFetch = async (input, init = {}) => {
    const timeoutSignal = AbortSignal.timeout(20_000);
    const signal = init.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal;
    return fetch(input, { ...init, signal });
  };

  try {
    auth = createClient(apiUrl.origin, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { fetch: timedFetch },
    });
    for (const fixture of fixtures) {
      const email = `viral.local.acceptance.${runId}.${fixture.emailLabel}@example.invalid`;
      const { data, error } = await auth.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { acceptance_fixture: true },
      });
      if (error || !data.user?.id) fail(`Could not create local Auth fixture ${fixture.key}`);
      usersByKey.set(fixture.key, { id: data.user.id, email });
      console.log(`Created local Auth fixture: ${fixture.key}`);
    }

    const seed = await readFile(path.join(supabaseDirectory, 'seed.sql'), 'utf8');
    await runSql(psqlEnv, replaceFixtureIds(seed, usersByKey), 'supabase/seed.sql');
    seedLoaded = true;
    console.log('Passed supabase/seed.sql');

    const testDirectory = path.join(supabaseDirectory, 'tests');
    const tests = (await readdir(testDirectory))
      .filter(file => file.endsWith('_acceptance.sql'))
      .sort();
    if (tests.length === 0) fail('No SQL acceptance suites were found in supabase/tests');

    for (const file of tests) {
      const sql = await readFile(path.join(testDirectory, file), 'utf8');
      await runSql(psqlEnv, replaceFixtureIds(sql, usersByKey), `supabase/tests/${file}`);
      passedSuiteCount += 1;
      console.log(`Passed supabase/tests/${file}`);
    }
  } finally {
    // Remove only the deterministic organization inserted by this seed. Its
    // project-owned rows cascade; other data is never cascade-deleted here.
    if (seedLoaded) {
      try {
        await runSql(
          psqlEnv,
          "delete from public.organizations where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';",
          'local fixture cleanup',
        );
      } catch {
        cleanupErrors.push('seed-data');
      }
    }
    for (const fixture of [...fixtures].reverse()) {
      const user = usersByKey.get(fixture.key);
      if (!user) continue;
      try {
        const { error } = await auth.auth.admin.deleteUser(user.id);
        if (error) cleanupErrors.push(fixture.key);
      } catch {
        cleanupErrors.push(fixture.key);
      }
    }
    if (cleanupErrors.length) {
      fail(`Local fixture cleanup failed (${cleanupErrors.join(', ')}). The acceptance run is marked failed; reset this disposable local database before reusing it.`);
    }
  }
  console.log(`PASS: seed plus ${passedSuiteCount} SQL acceptance suites against local Supabase/PostgreSQL; temporary Auth fixtures and seed organization cleaned up.`);
}

main().catch(error => {
  console.error(`FAIL: ${error instanceof Error ? error.message : 'Unexpected local database test failure'}`);
  process.exitCode = 1;
});
