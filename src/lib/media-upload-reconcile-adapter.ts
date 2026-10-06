import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';

const canonicalPath = /^projects\/([0-9a-f-]{36})\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[a-zA-Z0-9][a-zA-Z0-9_-]{0,100}\.[a-z0-9]{1,8}$/;

/** Claim one expired upload intent, remove only its reserved object, then fence the acknowledgement. */
export async function runOneMediaUploadReconcile() {
  const client = createAdminClient({ requestTimeoutMs: 20_000 });
  const { data, error } = await client.rpc('claim_media_upload_cleanup');
  if (error || !Array.isArray(data)) throw new Error('Upload cleanup claim failed');
  if (data.length === 0) return 'empty' as const;
  if (data.length !== 1) throw new Error('Invalid upload cleanup claim');
  const row = data[0];
  if (!row || typeof row !== 'object' || row.bucket_id !== 'project-media' ||
      typeof row.intent_id !== 'string' || typeof row.lease_token !== 'string' ||
      typeof row.object_path !== 'string' || !canonicalPath.test(row.object_path)) return 'invalid' as const;

  let removed = false;
  try {
    const { error: removeError } = await client.storage.from('project-media').remove([row.object_path]);
    removed = !removeError;
  } catch { removed = false; }
  const { data: finished, error: finishError } = await client.rpc('finish_media_upload_cleanup', {
    target_intent: row.intent_id, token: row.lease_token, success: removed, delay_seconds: 60,
  });
  if (finishError || typeof finished !== 'boolean') return 'unconfirmed' as const;
  if (!finished) return 'stale' as const;
  return removed ? 'completed' as const : 'retry_scheduled' as const;
}
