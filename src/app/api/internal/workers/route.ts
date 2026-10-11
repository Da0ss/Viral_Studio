import { randomUUID } from 'node:crypto';
import { authorizeScheduledWorker } from '@/lib/worker-authorization';
import { runOneMediaCleanup } from '@/lib/media-cleanup-adapter';
import { runOneMediaUploadReconcile } from '@/lib/media-upload-reconcile-adapter';
import { runGenerationWorkerBatch } from '@/lib/generation-worker';
import { drainScheduledWorkers, type ScheduledWorkerQueue } from '@/lib/scheduled-worker';

export const runtime = 'nodejs';
export const maxDuration = 120;

// Stop admitting work at 100s, leaving 20s for response/logging before the
// route's configured 120s function limit. Queue reserves are conservative.
const workBudgetMs = 100_000;

export async function GET(request: Request) {
  const startedAt = Date.now();
  const correlationId = randomUUID();
  const respond = (body: Record<string, unknown>, code: number) => Response.json(body, {
    status: code,
    headers: { 'Cache-Control': 'no-store' },
  });
  const status = authorizeScheduledWorker(request);
  if (status !== 200) return respond({ error: status === 401 ? 'Unauthorized' : 'Worker unavailable' }, status);

  const enabledQueues: ScheduledWorkerQueue[] = [];
  if (process.env.MEDIA_CLEANUP_ENABLED === 'true') enabledQueues.push({
    name: 'media_cleanup', reserveMs: 25_000, runOne: runOneMediaCleanup,
  });
  if (process.env.MEDIA_UPLOAD_RECONCILE_ENABLED === 'true') enabledQueues.push({
    name: 'media_upload_reconcile', reserveMs: 25_000, runOne: runOneMediaUploadReconcile,
  });
  if (process.env.GENERATION_ENABLED === 'true') enabledQueues.push({
    name: 'generation', reserveMs: 75_000, runOne: deadlineAt => runGenerationWorkerBatch(1, deadlineAt),
  });
  if (enabledQueues.length === 0) return respond({ error: 'Workers disabled' }, 503);

  console.info(JSON.stringify({ event: 'worker_batch_start', route: '/api/internal/workers', correlationId, enabledQueues: enabledQueues.length }));
  const result = await drainScheduledWorkers({ queues: enabledQueues, deadlineAt: startedAt + workBudgetMs });
  const durationMs = Date.now() - startedAt;
  console.info(JSON.stringify({
    event: 'worker_batch_finished', route: '/api/internal/workers', correlationId,
    counts: { started: result.started, confirmed: result.confirmed, failed: result.failed, queues: result.queues },
    deadlineReached: result.deadlineReached, durationMs,
  }));
  return respond({
    correlationId,
    checked: result.started,
    confirmed: result.failed === 0,
    counts: { started: result.started, completed: result.confirmed, failed: result.failed, queues: result.queues },
    deadlineReached: result.deadlineReached,
  }, result.failed > 0 ? 503 : 200);
}
