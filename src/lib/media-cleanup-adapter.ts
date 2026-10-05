import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { processMediaCleanup, type MediaCleanupPorts } from './media-cleanup-worker';

/** Server invocation only; the machine endpoint requires a separate secret. */
export async function runOneMediaCleanup() {
  const client = createAdminClient({ requestTimeoutMs: 20_000 });
  const response = await Promise.resolve(client.rpc('claim_media_cleanup')).catch(() => {
    throw new Error('Cleanup claim failed');
  });
  const { data: claimed, error: claimError } = response;
  if (claimError || !Array.isArray(claimed)) throw new Error('Cleanup claim failed');
  if (claimed.length === 0) return 'empty' as const;
  if (claimed.length !== 1) throw new Error('Invalid cleanup claim');
  const row = claimed[0];
  if (!row || typeof row !== 'object' || Array.isArray(row)) return 'invalid' as const;
  const job = {
    id: row.id, projectId: row.project_id, leaseToken: row.lease_token,
    bucket: row.bucket_id, path: row.object_path, attempts: row.attempts,
  };
  const ports: MediaCleanupPorts = {
    async inspectAndRenew(current) {
      const { data, error } = await client.rpc('inspect_media_cleanup', { job_id: current.id, token: current.leaseToken });
      if (error || !['ready', 'referenced', 'stale'].includes(data)) throw new Error('Cleanup inspection failed');
      return data as 'ready' | 'referenced' | 'stale';
    },
    async remove(bucket, path) {
      return client.storage.from(bucket).remove([path]);
    },
    async complete(current) {
      const { data, error } = await client.rpc('finish_media_cleanup', { job_id: current.id, token: current.leaseToken });
      if (error || typeof data !== 'boolean') throw new Error('Cleanup acknowledgement failed');
      return data;
    },
    async retry(current, failure, delaySeconds) {
      const { data, error } = await client.rpc('finish_media_cleanup', {
        job_id: current.id, token: current.leaseToken, failure, delay_seconds: delaySeconds,
      });
      if (error || typeof data !== 'boolean') throw new Error('Cleanup retry failed');
      return data;
    },
  };
  return processMediaCleanup(job, ports);
}
