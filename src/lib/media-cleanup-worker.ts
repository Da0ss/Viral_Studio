import 'server-only';
import { z } from 'zod';

const jobSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  leaseToken: z.string().uuid(),
  bucket: z.literal('project-media'),
  path: z.string().regex(/^projects\/[0-9a-f-]{36}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[a-zA-Z0-9][a-zA-Z0-9_-]{0,100}\.[a-z0-9]{1,8}$/),
  attempts: z.number().int().min(1).max(2147483647),
});
export type MediaCleanupJob = z.infer<typeof jobSchema>;
export type CleanupFailure = 'referenced' | 'storage_failed' | 'verification_failed';
export interface MediaCleanupPorts {
  // Adapter must atomically validate/renew the lease and inspect ALL references,
  // not just rows visible to the original user's RLS. No stale token may pass.
  inspectAndRenew(job: MediaCleanupJob): Promise<'ready' | 'referenced' | 'stale'>;
  remove(bucket: 'project-media', path: string): Promise<{ error: unknown | null }>;
  // Both writes must compare the token AND require an unexpired lease.
  complete(job: MediaCleanupJob): Promise<boolean>;
  retry(job: MediaCleanupJob, failure: CleanupFailure, delaySeconds: number): Promise<boolean>;
}
export type CleanupOutcome = 'completed' | 'retry_scheduled' | 'stale' | 'unconfirmed' | 'invalid';

export function cleanupRetrySeconds(attempts: number): number {
  return Math.min(3600, 30 * 2 ** Math.min(7, Math.max(0, attempts - 1)));
}

/** Core only: no scheduled runner/DB adapter is wired until fencing is verified. */
export async function processMediaCleanup(input: unknown, ports: MediaCleanupPorts): Promise<CleanupOutcome> {
  const parsed = jobSchema.safeParse(input);
  if (!parsed.success || parsed.data.path.split('/')[1] !== parsed.data.projectId) return 'invalid';
  const job = parsed.data;
  const defer = async (failure: CleanupFailure): Promise<CleanupOutcome> => {
    try {
      return await ports.retry(job, failure, cleanupRetrySeconds(job.attempts)) ? 'retry_scheduled' : 'stale';
    } catch { return 'unconfirmed'; }
  };
  let inspection: 'ready' | 'referenced' | 'stale';
  try { inspection = await ports.inspectAndRenew(job); }
  catch { return defer('verification_failed'); }
  if (inspection === 'stale') return 'stale';
  if (inspection === 'referenced') return defer('referenced');
  try {
    const result = await ports.remove(job.bucket, job.path);
    if (result.error) return defer('storage_failed');
  } catch { return defer('storage_failed'); }
  // An uncertain acknowledgement must not report completion or overwrite a
  // newer lease. Leave the queue item to expire and be reclaimed.
  try { return await ports.complete(job) ? 'completed' : 'stale'; }
  catch { return 'unconfirmed'; }
}
