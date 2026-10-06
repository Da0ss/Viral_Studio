import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const timeoutMs = 15_000;
const sessionTimeoutMs = 30_000;
const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const testId = randomUUID();
const advisoryKey = [
  Number.parseInt(testId.slice(0, 8), 16) | 0,
  Number.parseInt(testId.slice(8, 16), 16) | 0,
];
const appNames = [`vs_${testId.slice(0, 8)}_a`, `vs_${testId.slice(0, 8)}_b`];
const emails = [
  `concurrency-owner-a-${testId}@example.invalid`,
  `concurrency-owner-b-${testId}@example.invalid`,
];
const password = `${randomUUID()}Aa1!`;
const organizationId = randomUUID();
const projectOrganizationId = randomUUID();
const projectId = randomUUID();
const assetIds = [randomUUID(), randomUUID()];
const paths = assetIds.map((assetId, index) =>
  `projects/${projectId}/${assetId}/concurrency-${index}.png`,
);
const users = [];
let connection;
let authUrl;
let serviceRoleKey;

function run(command, args, { input, env = process.env, timeout = timeoutMs, cwd } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env,
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeout);
    child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
    child.once('error', error => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', code => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
    if (input !== undefined) child.stdin.end(input);
    else child.stdin.end();
  });
}

async function localStatus() {
  let result;
  try {
    result = await run(process.execPath, [
      fileURLToPath(new URL('../node_modules/supabase/dist/supabase.js', import.meta.url)),
      'status', '-o', 'json',
    ], {
      cwd: repoRoot,
      env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: '1' },
    });
  } catch {
    throw new Error('Supabase CLI is unavailable. Install it and start the local Supabase stack first.');
  }
  if (result.code !== 0 || result.timedOut) {
    throw new Error('Could not read local Supabase status. Start the local stack and retry.');
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error('Supabase status did not return JSON; no status output or credentials were printed.');
  }
}

function pick(status, ...names) {
  for (const name of names) {
    if (typeof status[name] === 'string' && status[name]) return status[name];
  }
  return undefined;
}

function pickStatus(status, ...names) {
  return pick(status.env ?? status, ...names) ?? pick(status, ...names);
}

function parseLocalConnection(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('Local database URL is missing or invalid in Supabase status.');
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error('Supabase status returned a non-PostgreSQL database URL.');
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
    throw new Error('Refusing to run concurrency fixtures against a non-local database.');
  }
  if (!url.username || !url.password || !url.port || !url.pathname.slice(1)) {
    throw new Error('Local database URL is missing connection fields.');
  }
  return {
    host,
    port: url.port,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.slice(1)),
    sslmode: url.searchParams.get('sslmode'),
  };
}

async function sql(statement, { timeout = timeoutMs } = {}) {
  const env = {
    ...process.env,
    PGPASSWORD: connection.password,
    PGCONNECT_TIMEOUT: '5',
    ...(connection.sslmode ? { PGSSLMODE: connection.sslmode } : {}),
  };
  const args = [
    '-X', '-qAt', '-v', 'ON_ERROR_STOP=1',
    '-h', connection.host, '-p', connection.port,
    '-U', connection.user, '-d', connection.database,
  ];
  const result = await run('psql', args, { input: statement, env, timeout, cwd: repoRoot });
  if (result.timedOut) throw new Error('psql exceeded the bounded timeout.');
  if (result.code !== 0) {
    // Do not echo server diagnostics: they may include deployment details.
    throw new Error(`psql failed with exit code ${result.code}.`);
  }
  return result.stdout.trim();
}

async function authRequest(path, method, body) {
  const response = await fetch(new URL(path, authUrl), {
    method,
    headers: {
      apikey: serviceRoleKey,
      authorization: `Bearer ${serviceRoleKey}`,
      'content-type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`Supabase Auth admin request failed with HTTP ${response.status}.`);
  }
  return payload;
}

async function createAuthUsers() {
  for (const email of emails) {
    const user = await authRequest('/auth/v1/admin/users', 'POST', {
      email,
      password,
      email_confirm: true,
    });
    if (!user?.id) throw new Error('Supabase Auth did not return an ID for a temporary fixture user.');
    users.push(user.id);
  }
}

async function setupFixtures() {
  const userA = users[0];
  const userB = users[1];
  await sql(`
    set lock_timeout = '5s';
    set statement_timeout = '10s';
    do $$ begin
      if exists (select 1 from private.media_deletion_outbox
        where completed_at is null
          and available_at <= clock_timestamp() + interval '20 seconds'
          and (lease_until is null or lease_until <= clock_timestamp() + interval '20 seconds')) then
        raise exception 'Pre-existing ready cleanup jobs prevent an isolated claim test';
      end if;
    end $$;
    insert into public.organizations(id, name, slug, created_by)
    values ('${organizationId}', 'Concurrency fixture', 'concurrency-${testId}', '${userA}');
    insert into public.organization_members(organization_id, user_id, role)
    values ('${organizationId}', '${userB}', 'owner');
    insert into public.organizations(id, name, slug, created_by)
    values ('${projectOrganizationId}', 'Concurrency project fixture', 'concurrency-project-${testId}', '${userA}');
    insert into public.organization_members(organization_id, user_id, role)
    values ('${projectOrganizationId}', '${userB}', 'owner');
    insert into public.projects(id, organization_id, name, created_by)
    values ('${projectId}', '${projectOrganizationId}', 'Concurrency fixture project', '${userA}');
    insert into public.project_members(project_id, user_id, role)
    values ('${projectId}', '${userB}', 'owner');
    insert into private.media_deletion_outbox(asset_id, project_id, object_path)
    values ('${assetIds[0]}', '${projectId}', '${paths[0]}'),
           ('${assetIds[1]}', '${projectId}', '${paths[1]}');
  `);
}

function psqlArgs() {
  return [
    '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose',
    '-h', connection.host, '-p', connection.port,
    '-U', connection.user, '-d', connection.database,
  ];
}

function startPsqlSession(applicationName) {
  const env = {
    ...process.env,
    PGPASSWORD: connection.password,
    PGAPPNAME: applicationName,
    PGCONNECT_TIMEOUT: '5',
    ...(connection.sslmode ? { PGSSLMODE: connection.sslmode } : {}),
  };
  const child = spawn('psql', psqlArgs(), {
    cwd: repoRoot,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  child.stdin.on('error', () => {});
  const session = { child, stdout: '', stderr: '' };
  session.timer = setTimeout(() => {
    session.timedOut = true;
    child.kill();
  }, sessionTimeoutMs);
  session.closed = new Promise(resolve => {
    child.stdout.setEncoding('utf8').on('data', chunk => { session.stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', chunk => { session.stderr += chunk; });
    child.once('error', error => {
      clearTimeout(session.timer);
      session.error = error;
      resolve(null);
    });
    child.once('close', code => {
      clearTimeout(session.timer);
      session.code = code;
      resolve(code);
    });
  });
  return session;
}

async function waitForOutput(session, marker, label) {
  const endAt = Date.now() + timeoutMs;
  while (Date.now() < endAt) {
    if (session.stdout.includes(marker)) return;
    if (session.code !== undefined || session.error || session.timedOut) {
      throw new Error(`${label} session exited before synchronization.`);
    }
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`${label} session did not reach the synchronization point in time.`);
}

async function releaseWhenBothWaiting(sessions, { isolation, primeQuery, statements }) {
  const lockSql = `select pg_advisory_lock(${advisoryKey[0]}, ${advisoryKey[1]}), 'BARRIER_LOCKED';\n`;
  const releaseSql = `select pg_advisory_unlock(${advisoryKey[0]}, ${advisoryKey[1]}), 'BARRIER_RELEASED';\n`;
  const coordinator = startPsqlSession(`vs_${testId.slice(0, 8)}_barrier`);
  let released = false;
  try {
    coordinator.child.stdin.write(lockSql);
    await waitForOutput(coordinator, 'BARRIER_LOCKED', 'Barrier coordinator');
    sessions.forEach((session, index) => {
      session.child.stdin.write(`
        begin isolation level ${isolation};
        set local lock_timeout = '5s';
        set local statement_timeout = '10s';
        ${primeQuery ?? ''}
        select pg_advisory_xact_lock(${advisoryKey[0]}, ${advisoryKey[1]});
        ${statements[index]}
        commit;
      `);
    });

    const quotedApps = appNames.map(name => `'${name}'`).join(', ');
    const endAt = Date.now() + timeoutMs;
    while (Date.now() < endAt) {
      const waiting = await sql(`select count(*) from pg_stat_activity
        where application_name in (${quotedApps}) and wait_event_type = 'Lock' and state = 'active';`);
      if (waiting === String(sessions.length)) break;
      if (sessions.some(session => session.code !== undefined || session.error || session.timedOut)) {
        throw new Error('A worker exited before both sessions reached the barrier.');
      }
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    const waiting = await sql(`select count(*) from pg_stat_activity
      where application_name in (${quotedApps}) and wait_event_type = 'Lock' and state = 'active';`);
    if (waiting !== String(sessions.length)) throw new Error('Both sessions did not block at the deterministic barrier.');
    coordinator.child.stdin.write(releaseSql);
    await waitForOutput(coordinator, 'BARRIER_RELEASED', 'Barrier release');
    released = true;
  } finally {
    if (!released && coordinator.child.exitCode === null) {
      coordinator.child.stdin.write(releaseSql);
      await waitForOutput(coordinator, 'BARRIER_RELEASED', 'Barrier cleanup').catch(() => {});
    }
    coordinator.child.stdin.end('\\q\n');
    sessions.forEach(session => {
      if (session.child.exitCode === null) session.child.stdin.end('\\q\n');
    });
    await Promise.all([coordinator.closed, ...sessions.map(session => session.closed)]);
  }
}

async function testConcurrentOwnerRemoval() {
  await testConcurrentLastOwnerRemoval({
    table: 'public.project_members',
    parentColumn: 'project_id',
    parentId: projectId,
    label: 'project',
  });
  await testConcurrentLastOwnerRemoval({
    table: 'public.organization_members',
    parentColumn: 'organization_id',
    parentId: organizationId,
    label: 'organization',
  });
}

async function testConcurrentLastOwnerRemoval({ table, parentColumn, parentId, label }) {
  const sessions = users.map((_, index) => startPsqlSession(appNames[index]));
  const statements = users.map(userId => `delete from ${table}
    where ${parentColumn} = '${parentId}' and user_id = '${userId}';`);
  await releaseWhenBothWaiting(sessions, {
    isolation: 'repeatable read',
    primeQuery: `select count(*) from ${table} where ${parentColumn} = '${parentId}';`,
    statements,
  });
  const outcomes = sessions.map(session => ({ code: session.code, stderr: session.stderr, timedOut: session.timedOut }));
  if (outcomes.some(outcome => outcome.timedOut)) {
    throw new Error(`Concurrent ${label} owner removal timed out.`);
  }
  const successes = outcomes.filter(outcome => outcome.code === 0).length;
  const expectedFailures = outcomes.filter(outcome =>
    outcome.code !== 0 && /23514|40001/.test(outcome.stderr),
  ).length;
  if (successes !== 1 || expectedFailures !== 1) {
    throw new Error(`Concurrent ${label} owner removal did not produce one commit and one invariant rejection.`);
  }
  const retainedOwners = await sql(`select count(*) from ${table}
    where ${parentColumn} = '${parentId}' and role = 'owner';`);
  if (retainedOwners !== '1') throw new Error(`Concurrent ${label} removal violated the one-owner invariant.`);
  console.log(`PASS: concurrent ${label} last-owner removals serialize; one owner remains.`);
}

async function testConcurrentCleanupClaims() {
  const sessions = appNames.map(appName => startPsqlSession(appName));
  await releaseWhenBothWaiting(sessions, {
    isolation: 'read committed',
    statements: appNames.map(() => `select object_path || '|' || lease_token::text from public.claim_media_cleanup();`),
  });
  const outcomes = sessions.map(session => ({
    code: session.code,
    stdout: session.stdout,
    timedOut: session.timedOut,
  }));
  if (outcomes.some(outcome => outcome.timedOut || outcome.code !== 0)) {
    throw new Error('Concurrent cleanup claim session failed or timed out.');
  }
  const claims = outcomes.map(outcome => outcome.stdout.trim().split(/\r?\n/).filter(Boolean)).flat();
  const claimedPaths = claims.map(row => row.split('|')[0]);
  const tokens = claims.map(row => row.split('|')[1]);
  if (claims.length !== 2 || new Set(claimedPaths).size !== 2
    || !paths.every(path => claimedPaths.includes(path))
    || tokens.some(token => !token)) {
    throw new Error('Concurrent cleanup claims were missing, duplicated, or claimed non-fixture work.');
  }
  console.log('PASS: concurrent cleanup workers receive distinct leased jobs.');
}

async function cleanup() {
  const failures = [];
  if (connection) {
    // Restrict SQL cleanup to the exact fixture IDs and paths created above.
    await sql(`
      set lock_timeout = '5s';
      set statement_timeout = '10s';
      delete from private.media_deletion_outbox
        where project_id = '${projectId}' and object_path in (${paths.map(path => `'${path}'`).join(', ')});
      delete from public.organizations where id in ('${organizationId}', '${projectOrganizationId}');
    `).catch(() => failures.push('database fixture cleanup failed'));
  }
  for (const userId of users.reverse()) {
    await authRequest(`/auth/v1/admin/users/${encodeURIComponent(userId)}`, 'DELETE')
      .catch(() => failures.push('Auth fixture cleanup failed'));
  }
  return failures;
}

let checksPassed = false;
try {
  const status = await localStatus();
  const apiUrl = pickStatus(status, 'API_URL', 'api_url');
  const dbUrl = pickStatus(status, 'DB_URL', 'db_url');
  serviceRoleKey = pickStatus(status, 'SERVICE_ROLE_KEY', 'service_role_key');
  if (!apiUrl || !dbUrl || !serviceRoleKey) {
    throw new Error('Supabase status JSON is missing local API/database credentials.');
  }
  authUrl = new URL(apiUrl);
  const authHost = authUrl.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (authUrl.protocol !== 'http:' || !['localhost', '127.0.0.1', '::1'].includes(authHost)) {
    throw new Error('Refusing to create Auth fixtures against a non-local Supabase API.');
  }
  connection = parseLocalConnection(dbUrl);
  try {
    const result = await run('psql', ['--version']);
    if (result.code !== 0) throw new Error('psql client is unavailable.');
  } catch {
    throw new Error('psql is unavailable. Install PostgreSQL client tools before running this test.');
  }

  await createAuthUsers();
  await setupFixtures();
  await testConcurrentOwnerRemoval();
  await testConcurrentCleanupClaims();
  checksPassed = true;
} catch (error) {
  console.error(`FAIL: ${error.message}`);
  process.exitCode = 1;
} finally {
  const cleanupFailures = await cleanup();
  for (const failure of cleanupFailures) {
    console.error(`FAIL: ${failure}. Remove only fixture ${testId} after inspecting the local database.`);
  }
  if (cleanupFailures.length) process.exitCode = 1;
  if (checksPassed && cleanupFailures.length === 0) {
    console.log('PASS: native local Supabase concurrency checks completed; fixtures cleaned up.');
  }
  // Keep credentials out of accidental later logs and stack traces.
  serviceRoleKey = undefined;
  if (connection) connection.password = '';
}
