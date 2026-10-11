import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';

// Run only after confirming the global pending queue contains this run's fixtures.
// The worker claims one object per request. Never print credentials or raw errors.
const local = parseEnv(await readFile('.env.worker-verification.local', 'utf8'));
const base = new URL(local.HOSTED_APP_BASE_URL);
if (base.protocol !== 'https:' || !/^[0-9a-f]{64}$/.test(local.MEDIA_CLEANUP_SECRET ?? '')) {
  throw new Error('Invalid cleanup verification configuration');
}
try {
  for (let object = 1; object <= 3; object++) {
    const response = await fetch(new URL('/api/internal/media-cleanup', base), {
      method: 'POST', headers: { Authorization: `Bearer ${local.MEDIA_CLEANUP_SECRET}` },
      redirect: 'manual', signal: AbortSignal.timeout(30000),
    });
    const body = await response.json();
    console.log(JSON.stringify({ object, status: response.status, outcome: body.outcome ?? null }));
    if (response.status !== 200 || body.outcome !== 'completed') throw new Error('Cleanup not completed');
  }
  const response = await fetch(new URL('/api/internal/worker-metrics', base), {
    headers: { Authorization: `Bearer ${local.CRON_SECRET}` },
    redirect: 'manual', signal: AbortSignal.timeout(30000),
  });
  const body = await response.json();
  if (response.status !== 200 || !body.queues || !body.generation_budget ||
      !/\bno-store\b/i.test(response.headers.get('cache-control') ?? '') ||
      /"(?:prompt|lease_token|token|object_path|user_id|job_id|requested_by)"\s*:/.test(JSON.stringify(body))) {
    throw new Error('Aggregate metrics verification failed');
  }
  console.log(JSON.stringify({ metricsStatus: response.status, queues: body.queues, generationBudget: body.generation_budget }));
} catch {
  console.error('Hosted cleanup verification failed; no credentials printed.');
  process.exitCode = 1;
}
