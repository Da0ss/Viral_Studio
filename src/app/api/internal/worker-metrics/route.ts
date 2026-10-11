import { authorizeScheduledWorker } from '@/lib/worker-authorization';
import { readWorkerMetrics } from '@/lib/worker-metrics';

export const runtime = 'nodejs';
export const maxDuration = 20;

const reply = (body: Record<string, unknown>, status: number) => Response.json(body, {
  status,
  headers: { 'Cache-Control': 'no-store' },
});

/** Read-only aggregate metrics; disabled unless explicitly enabled. */
export async function GET(request: Request) {
  const authStatus = authorizeScheduledWorker(request);
  if (authStatus !== 200) return reply({ error: authStatus === 401 ? 'Unauthorized' : 'Worker unavailable' }, authStatus);
  if (process.env.WORKER_METRICS_ENABLED !== 'true') return reply({ error: 'Worker metrics unavailable' }, 503);
  try {
    return reply(await readWorkerMetrics(), 200);
  } catch {
    return reply({ error: 'Worker metrics unavailable' }, 503);
  }
}
