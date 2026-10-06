import 'server-only';

import { createHash } from 'node:crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  cancelVideo,
  downloadVideo,
  pollVideo,
  submitVideo,
  VideoProviderError,
} from '@/lib/huggingface-video';

const maxBatchSize = 8;
const backoffSeconds = (attempt: number) => Math.min(300, 5 * 2 ** Math.min(6, Math.max(0, attempt - 1)));

type ClaimedJob = {
  job_id: string;
  dispatch_state: 'submitting' | 'submitted' | 'polling' | 'cancelling';
  lease_token: string;
  project_id: string;
  requested_by: string;
  prompt: string;
  provider_request_path: string | null;
  cancel_requested: boolean;
  output_storage_path: string | null;
};

const codeOf = (error: unknown) => error instanceof VideoProviderError ? error.code : 'temporary';
const enabled = () => process.env.GENERATION_ENABLED === 'true';

async function acknowledged(admin: ReturnType<typeof createAdminClient>, name: string, args: Record<string, unknown>) {
  const { data, error } = await admin.rpc(name, args);
  return !error && data === true;
}

async function isCompleted(admin: ReturnType<typeof createAdminClient>, id: string) {
  const { data } = await admin.from('generation_jobs').select('status').eq('id', id).maybeSingle();
  return data?.status === 'completed';
}

async function advance(admin: ReturnType<typeof createAdminClient>, job: ClaimedJob): Promise<boolean> {
  const { job_id: id, lease_token: leaseToken } = job;
  if (job.dispatch_state === 'submitting') {
    if (job.cancel_requested) {
      return acknowledged(admin, 'finish_generation_pre_submit_cancel', { target_job: id, token: leaseToken });
    }
    const { data: authorized, error: authorizationError } = await admin.rpc('authorize_generation_dispatch', {
      target_job: id, token: leaseToken,
    });
    if (authorizationError || authorized !== true) {
      return !authorizationError && authorized === false ? isCompleted(admin, id).then(async completed => {
        if (completed) return true;
        const { data: state } = await admin.from('generation_jobs').select('status').eq('id', id).maybeSingle();
        return state?.status === 'cancelled';
      }) : false;
    }
    try {
      const requestPath = await submitVideo(job.prompt);
      const { data, error } = await admin.rpc('record_generation_submission', {
        target_job: id, token: leaseToken, request_path: requestPath,
      });
      if (error || data !== true) {
        // The external request may already be accepted. Leave the row for the
        // expired-lease guard to classify as uncertain; never resubmit it.
        return acknowledged(admin, 'mark_generation_uncertain', { target_job: id, token: leaseToken, error_code: 'submit_ack_persist_failed' });
      }
      return true;
    } catch (error) {
      const code = codeOf(error);
      if (error instanceof VideoProviderError && (code === 'rejected' || code === 'unconfigured')) {
        return acknowledged(admin, 'finish_generation_without_charge', { target_job: id, token: leaseToken, error_code: code });
      } else {
        return acknowledged(admin, 'mark_generation_uncertain', { target_job: id, token: leaseToken, error_code: code });
      }
    }
  }

  const requestPath = job.provider_request_path;
  if (!requestPath) {
    return acknowledged(admin, 'mark_generation_uncertain', { target_job: id, token: leaseToken, error_code: 'provider_path_missing' });
  }
  if (job.dispatch_state === 'cancelling' || job.cancel_requested) {
    try {
      await cancelVideo(requestPath);
      return acknowledged(admin, 'finish_generation_cancel', { target_job: id, token: leaseToken });
    } catch {
      return acknowledged(admin, 'retry_generation_poll', {
        target_job: id, token: leaseToken, delay_seconds: backoffSeconds(2), error_code: 'cancel_retry',
      });
    }
  }

  let result;
  try {
    result = await pollVideo(requestPath);
  } catch (error) {
    const code = codeOf(error);
    if (code === 'temporary' || code === 'unconfigured') {
      return acknowledged(admin, 'retry_generation_poll', {
        target_job: id, token: leaseToken, delay_seconds: backoffSeconds(2), error_code: code,
      });
    } else {
      return acknowledged(admin, 'finish_generation_failure', { target_job: id, token: leaseToken, error_code: code });
    }
  }
  if (result.status === 'pending') {
    return acknowledged(admin, 'retry_generation_poll', {
      target_job: id, token: leaseToken, delay_seconds: backoffSeconds(1), error_code: null,
    });
  }

  const { data: resultLease, error: resultLeaseError } = await admin.rpc('extend_generation_lease', {
    target_job: id, token: leaseToken,
  });
  if (resultLeaseError || resultLease !== true) return false;

  let bytes: Uint8Array;
  try {
    bytes = await downloadVideo(result.url);
  } catch (error) {
    const code = codeOf(error);
    if (code === 'temporary') {
      return acknowledged(admin, 'retry_generation_poll', {
        target_job: id, token: leaseToken, delay_seconds: backoffSeconds(2), error_code: code,
      });
    } else {
      return acknowledged(admin, 'finish_generation_failure', { target_job: id, token: leaseToken, error_code: code });
    }
  }

  const { data: path, error: pathError } = await admin.rpc('prepare_generation_output', { target_job: id, token: leaseToken });
  if (pathError || typeof path !== 'string') return false;
  const { data: uploadLease, error: uploadLeaseError } = await admin.rpc('extend_generation_lease', {
    target_job: id, token: leaseToken,
  });
  if (uploadLeaseError || uploadLease !== true) return false;
  const storage = admin.storage.from('project-media');
  // A prior worker may have uploaded bytes and died before the DB commit. Keep
  // the canonical object immutable; conflicts are verified below, never replaced.
  const { error: uploadError } = await storage.upload(path, bytes, {
    contentType: 'video/mp4', upsert: false, cacheControl: '3600',
  });
  if (uploadError) {
    const { data: existing, error: readError } = await storage.download(path);
    if (readError || !existing) {
      return acknowledged(admin, 'retry_generation_poll', { target_job: id, token: leaseToken, delay_seconds: 30, error_code: 'storage_retry' });
    }
    if (existing.size !== bytes.byteLength || existing.size > 50 * 1024 * 1024) {
      return acknowledged(admin, 'retry_generation_poll', { target_job: id, token: leaseToken, delay_seconds: 60, error_code: 'output_conflict' });
    }
    const existingBytes = new Uint8Array(await existing.arrayBuffer());
    const hash = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
    if (hash(existingBytes) !== hash(bytes)) {
      return acknowledged(admin, 'retry_generation_poll', { target_job: id, token: leaseToken, delay_seconds: 60, error_code: 'output_conflict' });
    }
  }
  const { data: finalizeLease, error: finalizeLeaseError } = await admin.rpc('extend_generation_lease', {
    target_job: id, token: leaseToken,
  });
  if (finalizeLeaseError || finalizeLease !== true) return false;
  const { data: assetId, error: completeError } = await admin.rpc('finish_generation_success', {
    target_job: id, token: leaseToken, output_size_bytes: bytes.byteLength,
  });
  if (completeError || !assetId) {
    // An RPC can commit while its response is lost. Preserve immutable bytes;
    // the next fenced lease checks the row and safely retries finalization.
    if (await isCompleted(admin, id)) return true;
    return acknowledged(admin, 'retry_generation_poll', { target_job: id, token: leaseToken, delay_seconds: 30, error_code: 'database_finalize_retry' });
  }
  return true;
}

/** Called by the exact-auth cron aggregator. The feature flag is fail-closed. */
export async function runGenerationWorkerBatch(batchSize = 1): Promise<{ claimed: number; advanced: number }> {
  if (!enabled()) return { claimed: 0, advanced: 0 };
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > maxBatchSize) throw new Error('Invalid generation worker batch size.');
  const admin = createAdminClient({ requestTimeoutMs: 30_000 });
  const { data, error } = await admin.rpc('claim_generation_jobs', { batch_size: batchSize });
  if (error) throw new Error('Could not claim generation jobs.');
  const jobs = (data ?? []) as ClaimedJob[];
  let advanced = 0;
  for (const job of jobs) if (await advance(admin, job)) advanced += 1;
  return { claimed: jobs.length, advanced };
}

/** User detail polling: RLS is checked by the route before this service-role claim. */
export async function advanceGenerationJob(jobId: string, viewerId: string): Promise<boolean> {
  if (!enabled()) return false;
  const admin = createAdminClient({ requestTimeoutMs: 30_000 });
  const { data, error } = await admin.rpc('claim_generation_job_for_view', { target_job: jobId, viewer_id: viewerId });
  if (error) throw new Error('Could not advance this generation.');
  const jobs = (data ?? []) as ClaimedJob[];
  for (const job of jobs) if (await advance(admin, job)) return true;
  return false;
}
