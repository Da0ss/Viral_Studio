import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';

/** Reads aggregate worker health through the service-role-only metrics RPC. */
export async function readWorkerMetrics(): Promise<Record<string, unknown>> {
  const client = createAdminClient({ requestTimeoutMs: 15_000 });
  const { data, error } = await client.rpc('get_worker_metrics');
  if (error || !data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Worker metrics unavailable');
  }
  return data as Record<string, unknown>;
}
