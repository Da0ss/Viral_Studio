import { authorizeScheduledWorker } from '@/lib/worker-authorization';
import { runOneMediaCleanup } from '@/lib/media-cleanup-adapter';
import { runOneMediaUploadReconcile } from '@/lib/media-upload-reconcile-adapter';
import { runGenerationWorkerBatch } from '@/lib/generation-worker';

export const runtime = 'nodejs';
export const maxDuration = 120;

/** One bounded claim per enabled queue. DB leases arbitrate overlapping calls. */
export async function GET(request: Request) {
  const startedAt = Date.now();
  const status = authorizeScheduledWorker(request);
  const respond = (body: Record<string, unknown>, code: number) => Response.json(body, { status: code, headers: { 'Cache-Control': 'no-store' } });
  if (status !== 200) return respond({ error: status === 401 ? 'Unauthorized' : 'Worker unavailable' }, status);
  console.info(JSON.stringify({ event: 'worker_batch_start', route: '/api/internal/workers' }));
  const tasks: Promise<unknown>[] = [];
  if (process.env.MEDIA_CLEANUP_ENABLED === 'true') tasks.push(runOneMediaCleanup());
  if (process.env.MEDIA_UPLOAD_RECONCILE_ENABLED === 'true') tasks.push(runOneMediaUploadReconcile());
  if (process.env.GENERATION_ENABLED === 'true') tasks.push(runGenerationWorkerBatch(1));
  if (!tasks.length) return respond({ error: 'Workers disabled' }, 503);
  const outcomes = await Promise.allSettled(tasks);
  const failed = outcomes.some(result => {
    if (result.status === 'rejected') return true;
    if (result.value && typeof result.value === 'object' && 'claimed' in result.value) {
      const counts = result.value as { claimed: unknown; advanced: unknown };
      return typeof counts.claimed !== 'number' || typeof counts.advanced !== 'number'
        || !Number.isSafeInteger(counts.claimed) || !Number.isSafeInteger(counts.advanced)
        || counts.claimed < 0 || counts.advanced < 0 || counts.advanced !== counts.claimed;
    }
    return !['empty', 'completed', 'retry_scheduled'].includes(String(result.value));
  });
  console.info(JSON.stringify({ event: 'worker_batch_finished', route: '/api/internal/workers', checked: tasks.length, confirmed: !failed, durationMs: Date.now() - startedAt }));
  // Never reflect provider responses, credentials, SQL errors or raw job content.
  return respond({ checked: tasks.length, confirmed: !failed }, failed ? 503 : 200);
}
