import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';

// Use only with queue flags disabled. Credentials are never logged.
const local = parseEnv(await readFile('.env.worker-verification.local', 'utf8'));
const base = new URL(local.HOSTED_APP_BASE_URL);
if (base.protocol !== 'https:') throw new Error('Expected HTTPS deployment');
for (const key of ['CRON_SECRET', 'MEDIA_CLEANUP_SECRET', 'MEDIA_UPLOAD_RECONCILE_SECRET']) {
  if (!/^[0-9a-f]{64}$/.test(local[key] ?? '')) throw new Error(`Invalid ${key} configuration`);
}
const cases = [
  ['metrics_missing', '/api/internal/worker-metrics', 'GET', null, 401],
  ['metrics_wrong', '/api/internal/worker-metrics', 'GET', 'incorrect-test-credential', 401],
  ['metrics_authorized', '/api/internal/worker-metrics', 'GET', local.CRON_SECRET, 200],
  ['workers_disabled', '/api/internal/workers', 'GET', local.CRON_SECRET, 503],
  ['cleanup_disabled', '/api/internal/media-cleanup', 'POST', local.MEDIA_CLEANUP_SECRET, 503],
  ['reconcile_disabled', '/api/internal/media-upload-reconcile', 'POST', local.MEDIA_UPLOAD_RECONCILE_SECRET, 503],
];
const observations = [];
try {
  const settled = await Promise.allSettled(cases.map(async ([label, path, method, credential, expected]) => {
    const response = await fetch(new URL(path, base), {
      method, headers: credential ? { Authorization: `Bearer ${credential}` } : {},
      redirect: 'manual', signal: AbortSignal.timeout(25000),
    });
    observations.push({ label, status: response.status, cacheControl: response.headers.get('cache-control'), contentType: response.headers.get('content-type') });
    const body = await response.json();
    if (response.status !== expected) throw new Error(`${label}: unexpected HTTP ${response.status}`);
    if (!/\bno-store\b/i.test(response.headers.get('cache-control') ?? '')) throw new Error(`${label}: cache boundary failed`);
    if (label === 'metrics_authorized') {
      if (!body.queues || !body.generation_budget || !body.generated_at) throw new Error('Metrics schema missing');
      if (/"(?:prompt|lease_token|token|object_path|user_id|job_id|requested_by)"\s*:/.test(JSON.stringify(body))) {
        throw new Error('Unexpected private field in aggregate metrics');
      }
      return { label, status: response.status, cacheControl: 'no-store', queues: body.queues, generationBudget: body.generation_budget };
    }
    if (label.endsWith('_disabled') && !/disabled/i.test(body.error ?? '')) throw new Error(`${label}: expected disabled queue`);
    return { label, status: response.status, cacheControl: 'no-store', error: body.error };
  }));
  const results = settled.map((result, index) => result.status === 'fulfilled'
    ? result.value : { label: cases[index][0], failed: true });
  console.log(JSON.stringify(results));
  if (settled.some(result => result.status === 'rejected')) process.exitCode = 1;
} catch {
  console.log(JSON.stringify(observations));
  // Network errors may embed configured endpoints. Do not print raw errors.
  console.error('Worker HTTP verification failed; no credentials printed.');
  process.exitCode = 1;
}
