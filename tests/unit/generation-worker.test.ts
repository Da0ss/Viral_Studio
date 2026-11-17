import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  admin: vi.fn(), submit: vi.fn(), poll: vi.fn(), download: vi.fn(), cancel: vi.fn(),
  rpc: vi.fn(), upload: vi.fn(), storageDownload: vi.fn(), savedJob: vi.fn(),
  falSubmit: vi.fn(), falPoll: vi.fn(), falCancel: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.admin }));
vi.mock('@/lib/fal-video', () => ({
  submitFalVideo: mocks.falSubmit, pollFalVideo: mocks.falPoll, cancelFalVideo: mocks.falCancel,
  falConfigured: () => Boolean(process.env.FAL_KEY?.trim()),
  isFalModelKey: (value: string) => ['ltx', 'minimax', 'kling', 'seedance'].includes(value),
  validateFalRequestPath: (value: string) => value,
}));
vi.mock('@/lib/huggingface-video', () => ({
  VIDEO_MODEL: 'Lightricks/LTX-Video-0.9.7-distilled', VIDEO_PROVIDER: 'fal-ai',
  submitVideo: mocks.submit, pollVideo: mocks.poll, downloadVideo: mocks.download, cancelVideo: mocks.cancel,
  VideoProviderError: class VideoProviderError extends Error { constructor(message: string, readonly code: string) { super(message); } },
}));

import { advanceGenerationJob, runGenerationWorkerBatch } from '@/lib/generation-worker';
import { VideoProviderError as MockedProviderError } from '@/lib/huggingface-video';

const generated = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 109, 112, 52, 50, 0, 0, 0, 0]);
const claimed = (overrides: Record<string, unknown> = {}) => ({
  job_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', dispatch_state: 'submitting',
  lease_token: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', project_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  requested_by: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', prompt: 'A slow shot of clouds',
  provider_request_path: null, cancel_requested: false, output_storage_path: null,
  provider: 'fal-ai', model: 'Lightricks/LTX-Video-0.9.7-distilled', ...overrides,
});
const falJob = (overrides: Record<string, unknown> = {}) => claimed({ provider: 'fal', model: 'ltx', ...overrides });

beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv('GENERATION_ENABLED', 'true');
  mocks.submit.mockResolvedValue('/fal-ai/ltx-video-13b-distilled/requests/job123');
  mocks.poll.mockResolvedValue({ status: 'pending' });
  mocks.download.mockResolvedValue(generated);
  mocks.cancel.mockResolvedValue(undefined);
  mocks.upload.mockResolvedValue({ data: { path: 'projects/project/job/generation.mp4' }, error: null });
  mocks.storageDownload.mockResolvedValue({ data: null, error: new Error('missing') });
  mocks.savedJob.mockResolvedValue({ data: null });
  mocks.rpc.mockImplementation(async (name: string) => {
    if (name === 'claim_generation_jobs' || name === 'claim_generation_job_for_view') return { data: [claimed()], error: null };
    if (name === 'authorize_generation_dispatch') return { data: true, error: null };
    if (name === 'record_generation_submission' || name === 'finish_generation_success' || name === 'extend_generation_lease'
      || name === 'prepare_generation_output') return { data: true, error: null };
    return { data: true, error: null };
  });
  const client = {
    rpc: mocks.rpc,
    storage: { from: () => ({ upload: mocks.upload, download: mocks.storageDownload }) },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mocks.savedJob }) }) }),
  };
  mocks.admin.mockReturnValue(client);
});

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

it('never submits a second time when submit acknowledgement is uncertain', async () => {
  mocks.submit.mockRejectedValue(new Error('private token or transport details'));
  const deadlineAt = Date.now() + 80_000;
  await expect(runGenerationWorkerBatch(1, deadlineAt)).resolves.toMatchObject({ claimed: 1, advanced: 1 });
  expect(mocks.admin).toHaveBeenCalledWith({ requestTimeoutMs: 30_000, deadlineAt });
  expect(mocks.rpc).toHaveBeenCalledWith('authorize_generation_dispatch', expect.any(Object));
  expect(mocks.submit).toHaveBeenCalledOnce();
  expect(mocks.submit).toHaveBeenCalledWith('A slow shot of clouds', deadlineAt);
  expect(mocks.rpc).toHaveBeenCalledWith('mark_generation_uncertain', expect.objectContaining({ error_code: 'temporary' }));
  expect(mocks.rpc).not.toHaveBeenCalledWith('record_generation_submission', expect.anything());
  expect(mocks.rpc).not.toHaveBeenCalledWith('retry_generation_poll', expect.anything());
});

it('does not count an unconfirmed uncertain transition as advanced work', async () => {
  mocks.submit.mockRejectedValue(new Error('private transport details'));
  mocks.rpc.mockImplementation(async (name: string) => {
    if (name === 'claim_generation_jobs') return { data: [claimed()], error: null };
    if (name === 'authorize_generation_dispatch') return { data: true, error: null };
    if (name === 'mark_generation_uncertain') return { data: null, error: new Error('database unavailable') };
    return { data: true, error: null };
  });
  await expect(runGenerationWorkerBatch(1)).resolves.toEqual({ claimed: 1, advanced: 0 });
  expect(mocks.submit).toHaveBeenCalledOnce();
});

it('does not make the paid provider call when cancellation was recorded before submit', async () => {
  mocks.rpc.mockImplementation(async (name: string) => name === 'claim_generation_jobs'
    ? { data: [claimed({ cancel_requested: true })], error: null }
    : { data: true, error: null });
  await runGenerationWorkerBatch(1);
  expect(mocks.submit).not.toHaveBeenCalled();
  expect(mocks.rpc).toHaveBeenCalledWith('finish_generation_pre_submit_cancel', expect.any(Object));
});

it('persists completed provider output through the canonical asset path', async () => {
  mocks.rpc.mockImplementation(async (name: string) => {
    if (name === 'claim_generation_jobs') return { data: [claimed({
      dispatch_state: 'submitted', provider_request_path: '/fal-ai/ltx-video-13b-distilled/requests/job123',
    })], error: null };
    if (name === 'poll_generation' || name === 'claim_generation_job_for_view') return { data: [], error: null };
    if (name === 'pollVideo') return { data: null, error: null };
    if (name === 'extend_generation_lease') return { data: true, error: null };
    if (name === 'prepare_generation_output') return { data: 'projects/cccccccc-cccc-4ccc-8ccc-cccccccccccc/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/generation.mp4', error: null };
    if (name === 'finish_generation_success') return { data: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', error: null };
    return { data: true, error: null };
  });
  mocks.poll.mockResolvedValue({ status: 'completed', url: 'https://v3.fal.media/output.mp4' });
  await runGenerationWorkerBatch(1);
  expect(mocks.submit).not.toHaveBeenCalled();
  expect(mocks.download).toHaveBeenCalledOnce();
  expect(mocks.upload).toHaveBeenCalledWith(expect.stringContaining('/generation.mp4'), generated,
    expect.objectContaining({ contentType: 'video/mp4', upsert: false }));
  expect(mocks.rpc).toHaveBeenCalledWith('finish_generation_success', expect.objectContaining({ output_size_bytes: generated.byteLength }));
});

it('preserves output after a lost finalize acknowledgement and schedules safe retry', async () => {
  mocks.rpc.mockImplementation(async (name: string) => {
    if (name === 'claim_generation_jobs') return { data: [claimed({
      dispatch_state: 'submitted', provider_request_path: '/fal-ai/ltx-video-13b-distilled/requests/job123',
    })], error: null };
    if (name === 'extend_generation_lease') return { data: true, error: null };
    if (name === 'prepare_generation_output') return { data: 'projects/cccccccc-cccc-4ccc-8ccc-cccccccccccc/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/generation.mp4', error: null };
    if (name === 'finish_generation_success') return { data: null, error: new Error('lost response') };
    return { data: true, error: null };
  });
  mocks.poll.mockResolvedValue({ status: 'completed', url: 'https://v3.fal.media/output.mp4' });
  await runGenerationWorkerBatch(1);
  expect(mocks.upload).toHaveBeenCalledOnce();
  expect(mocks.savedJob).toHaveBeenCalledOnce();
  expect(mocks.rpc).toHaveBeenCalledWith('retry_generation_poll', expect.objectContaining({ error_code: 'database_finalize_retry' }));
  expect(mocks.storageDownload).not.toHaveBeenCalled();
});

const withClaim = (job: Record<string, unknown>) => mocks.rpc.mockImplementation(async (name: string) =>
  name === 'claim_generation_jobs' ? { data: [job], error: null } : { data: true, error: null });

it('closes unknown provider/model pairs without charge and never submits', async () => {
  withClaim(claimed({ provider: 'nope', model: 'x' }));
  await runGenerationWorkerBatch(1);
  expect(mocks.submit).not.toHaveBeenCalled();
  expect(mocks.falSubmit).not.toHaveBeenCalled();
  expect(mocks.rpc).toHaveBeenCalledWith('finish_generation_without_charge', expect.objectContaining({ error_code: 'model_unsupported' }));
  expect(mocks.rpc).not.toHaveBeenCalledWith('authorize_generation_dispatch', expect.anything());
});

it('closes Fal submissions without charge while the multimodel flag is off', async () => {
  vi.stubEnv('FAL_KEY', 'key'); vi.stubEnv('GENERATION_MULTIMODEL_ENABLED', 'false');
  withClaim(falJob());
  await runGenerationWorkerBatch(1);
  expect(mocks.falSubmit).not.toHaveBeenCalled();
  expect(mocks.rpc).toHaveBeenCalledWith('finish_generation_without_charge', expect.objectContaining({ error_code: 'multimodel_disabled' }));
});

it('closes Fal submissions without charge when FAL_KEY is missing', async () => {
  vi.stubEnv('FAL_KEY', ''); vi.stubEnv('GENERATION_MULTIMODEL_ENABLED', 'true');
  withClaim(falJob());
  await runGenerationWorkerBatch(1);
  expect(mocks.falSubmit).not.toHaveBeenCalled();
  expect(mocks.rpc).toHaveBeenCalledWith('finish_generation_without_charge', expect.objectContaining({ error_code: 'multimodel_disabled' }));
});

it('submits Fal jobs through the adapter, logs without the prompt, and records the path', async () => {
  vi.stubEnv('FAL_KEY', 'key'); vi.stubEnv('GENERATION_MULTIMODEL_ENABLED', 'true');
  mocks.falSubmit.mockResolvedValue({ requestPath: '/fal-ai/ltx-video/requests/req_1', requestId: 'req_1' });
  const log = vi.spyOn(console, 'info').mockImplementation(() => undefined);
  withClaim(falJob());
  await runGenerationWorkerBatch(1);
  expect(mocks.falSubmit).toHaveBeenCalledWith('ltx', 'A slow shot of clouds', undefined, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  expect(mocks.submit).not.toHaveBeenCalled();
  const line = String(log.mock.calls[0]?.[0]);
  expect(JSON.parse(line)).toMatchObject({ jobId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', model: 'ltx', requestId: 'req_1' });
  expect(line).not.toContain('clouds');
  expect(mocks.rpc).toHaveBeenCalledWith('record_generation_submission', expect.objectContaining({ request_path: '/fal-ai/ltx-video/requests/req_1' }));
});

it('keeps polling already-submitted Fal jobs even when the flag is off', async () => {
  vi.stubEnv('GENERATION_MULTIMODEL_ENABLED', 'false'); vi.stubEnv('FAL_KEY', '');
  mocks.falPoll.mockResolvedValue({ status: 'pending' });
  withClaim(falJob({ dispatch_state: 'submitted', provider_request_path: '/fal-ai/ltx-video/requests/req_1' }));
  await runGenerationWorkerBatch(1);
  expect(mocks.falPoll).toHaveBeenCalledWith('ltx', '/fal-ai/ltx-video/requests/req_1', undefined);
  expect(mocks.rpc).toHaveBeenCalledWith('retry_generation_poll', expect.any(Object));
});

it('cancels submitted Fal jobs through the Fal adapter', async () => {
  mocks.falCancel.mockResolvedValue(undefined);
  withClaim(falJob({ dispatch_state: 'cancelling', provider_request_path: '/fal-ai/ltx-video/requests/req_1' }));
  await runGenerationWorkerBatch(1);
  expect(mocks.falCancel).toHaveBeenCalledOnce();
  expect(mocks.cancel).not.toHaveBeenCalled();
  expect(mocks.rpc).toHaveBeenCalledWith('finish_generation_cancel', expect.any(Object));
});

const legacyRow = (overrides: Record<string, unknown> = {}) => {
  const { provider: _provider, model: _model, ...row } = claimed(overrides);
  return row;
};

it('treats pre-migration claim rows lacking provider/model as the legacy pair (submitting)', async () => {
  withClaim(legacyRow());
  await runGenerationWorkerBatch(1);
  expect(mocks.submit).toHaveBeenCalledOnce();
  expect(mocks.rpc).not.toHaveBeenCalledWith('finish_generation_without_charge', expect.objectContaining({ error_code: 'model_unsupported' }));
  expect(mocks.rpc).toHaveBeenCalledWith('record_generation_submission', expect.any(Object));
});

it('keeps polling pre-migration submitted rows lacking provider/model', async () => {
  withClaim(legacyRow({ dispatch_state: 'submitted', provider_request_path: '/fal-ai/ltx-video-13b-distilled/requests/job123' }));
  await runGenerationWorkerBatch(1);
  expect(mocks.poll).toHaveBeenCalledOnce();
  expect(mocks.rpc).not.toHaveBeenCalledWith('mark_generation_uncertain', expect.anything());
  expect(mocks.rpc).toHaveBeenCalledWith('retry_generation_poll', expect.any(Object));
});

it('keeps explicit null provider/model unsupported', async () => {
  withClaim(claimed({ provider: null, model: null }));
  await runGenerationWorkerBatch(1);
  expect(mocks.submit).not.toHaveBeenCalled();
  expect(mocks.rpc).toHaveBeenCalledWith('finish_generation_without_charge', expect.objectContaining({ error_code: 'model_unsupported' }));
});

it('counts a job finalized as model_disabled by the dispatch gate as handled, without submitting', async () => {
  mocks.rpc.mockImplementation(async (name: string) => {
    if (name === 'claim_generation_jobs') return { data: [claimed()], error: null };
    if (name === 'authorize_generation_dispatch') return { data: false, error: null };
    return { data: true, error: null };
  });
  mocks.savedJob.mockResolvedValue({ data: { status: 'failed', dispatch_state: 'finalized', last_error_code: 'model_disabled' } });
  await expect(runGenerationWorkerBatch(1)).resolves.toEqual({ claimed: 1, advanced: 1 });
  expect(mocks.submit).not.toHaveBeenCalled();
});

it('does not count a denied dispatch as handled when the job is still queued', async () => {
  mocks.rpc.mockImplementation(async (name: string) => {
    if (name === 'claim_generation_jobs') return { data: [claimed()], error: null };
    if (name === 'authorize_generation_dispatch') return { data: false, error: null };
    return { data: true, error: null };
  });
  mocks.savedJob.mockResolvedValue({ data: { status: 'running', dispatch_state: 'submitting', last_error_code: null } });
  await expect(runGenerationWorkerBatch(1)).resolves.toEqual({ claimed: 1, advanced: 0 });
});

it('does not expose admin work to callers while the feature flag is off', async () => {
  vi.stubEnv('GENERATION_ENABLED', 'false');
  await expect(runGenerationWorkerBatch(1)).resolves.toEqual({ claimed: 0, advanced: 0 });
  await expect(advanceGenerationJob('job', 'user')).resolves.toBe(false);
  expect(mocks.admin).not.toHaveBeenCalled();
});

// ---- Additional branch coverage: money/safety paths of advance() ----

const providerError = (code: string) => new MockedProviderError('x', code);
const submittedRow = (overrides: Record<string, unknown> = {}) => claimed({
  dispatch_state: 'submitted', provider_request_path: '/fal-ai/ltx-video-13b-distilled/requests/job123', ...overrides,
});
const outputPath = 'projects/cccccccc-cccc-4ccc-8ccc-cccccccccccc/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/generation.mp4';
type RpcResults = Record<string, { data: unknown; error?: unknown }>;
/** Claim returns `job`; every other RPC returns `results[name]` or `{ data: true }`. */
const rpcWith = (job: Record<string, unknown>, results: RpcResults = {}) =>
  mocks.rpc.mockImplementation(async (name: string) => {
    if (name === 'claim_generation_jobs' || name === 'claim_generation_job_for_view') return { data: [job], error: null };
    const result = results[name];
    return result ? { error: null, ...result } : { data: true, error: null };
  });
const completedPipeline = (results: RpcResults = {}) => {
  mocks.poll.mockResolvedValue({ status: 'completed', url: 'https://v3.fal.media/output.mp4' });
  rpcWith(submittedRow(), { prepare_generation_output: { data: outputPath }, finish_generation_success: { data: 'asset' }, ...results });
};
const blobOf = (bytes: Uint8Array) => ({
  size: bytes.byteLength,
  arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
});

it('rejects invalid batch sizes and claim errors', async () => {
  await expect(runGenerationWorkerBatch(0)).rejects.toThrow('Invalid generation worker batch size.');
  await expect(runGenerationWorkerBatch(9)).rejects.toThrow('Invalid generation worker batch size.');
  await expect(runGenerationWorkerBatch(1.5)).rejects.toThrow('Invalid generation worker batch size.');
  mocks.rpc.mockResolvedValue({ data: null, error: new Error('db') });
  await expect(runGenerationWorkerBatch(1)).rejects.toThrow('Could not claim generation jobs.');
  await expect(advanceGenerationJob('job', 'user')).rejects.toThrow('Could not advance this generation.');
});

it('treats a null claim result as no work', async () => {
  mocks.rpc.mockResolvedValue({ data: null, error: null });
  await expect(runGenerationWorkerBatch(1)).resolves.toEqual({ claimed: 0, advanced: 0 });
  await expect(advanceGenerationJob('job', 'user')).resolves.toBe(false);
});

it('advanceGenerationJob claims for the viewer and reports whether work advanced', async () => {
  rpcWith(claimed());
  await expect(advanceGenerationJob('job-1', 'user-1')).resolves.toBe(true);
  expect(mocks.rpc).toHaveBeenCalledWith('claim_generation_job_for_view', { target_job: 'job-1', viewer_id: 'user-1' });
  mocks.submit.mockRejectedValue(new Error('x'));
  rpcWith(claimed(), { mark_generation_uncertain: { data: false } });
  await expect(advanceGenerationJob('job-1', 'user-1')).resolves.toBe(false);
});

it('does not submit when the dispatch gate errors, and does not count it', async () => {
  rpcWith(claimed(), { authorize_generation_dispatch: { data: null, error: new Error('db') } });
  await expect(runGenerationWorkerBatch(1)).resolves.toEqual({ claimed: 1, advanced: 0 });
  expect(mocks.submit).not.toHaveBeenCalled();
});

it('counts a denied dispatch as handled when the job already completed or was cancelled', async () => {
  rpcWith(claimed(), { authorize_generation_dispatch: { data: false } });
  mocks.savedJob.mockResolvedValueOnce({ data: { status: 'completed' } });
  await expect(runGenerationWorkerBatch(1)).resolves.toMatchObject({ advanced: 1 });
  mocks.savedJob.mockReset();
  mocks.savedJob.mockResolvedValueOnce({ data: { status: 'running' } }).mockResolvedValueOnce({ data: { status: 'cancelled' } });
  await expect(runGenerationWorkerBatch(1)).resolves.toMatchObject({ advanced: 1 });
  expect(mocks.submit).not.toHaveBeenCalled();
});

it.each(['rejected', 'unconfigured'])('closes without charge when submit fails with %s', async (code) => {
  mocks.submit.mockRejectedValue(providerError(code));
  await expect(runGenerationWorkerBatch(1)).resolves.toMatchObject({ advanced: 1 });
  expect(mocks.rpc).toHaveBeenCalledWith('finish_generation_without_charge', expect.objectContaining({ error_code: code }));
  expect(mocks.rpc).not.toHaveBeenCalledWith('mark_generation_uncertain', expect.anything());
});

it.each(['uncertain', 'temporary'])('keeps the reservation (uncertain) when submit fails with %s', async (code) => {
  mocks.submit.mockRejectedValue(providerError(code));
  await runGenerationWorkerBatch(1);
  expect(mocks.rpc).toHaveBeenCalledWith('mark_generation_uncertain', expect.objectContaining({ error_code: code }));
  expect(mocks.rpc).not.toHaveBeenCalledWith('finish_generation_without_charge', expect.anything());
});

it('logs a submission without the prompt and marks uncertain when the ack cannot be persisted', async () => {
  const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
  rpcWith(claimed(), { record_generation_submission: { data: false } });
  await expect(runGenerationWorkerBatch(1)).resolves.toMatchObject({ advanced: 1 });
  expect(JSON.parse(String(info.mock.calls[0][0]))).toMatchObject({ event: 'generation.submitted', requestId: null });
  expect(String(info.mock.calls[0][0])).not.toContain('clouds');
  expect(mocks.rpc).toHaveBeenCalledWith('mark_generation_uncertain', expect.objectContaining({ error_code: 'submit_ack_persist_failed' }));
  rpcWith(claimed(), { record_generation_submission: { data: null, error: new Error('db') } });
  mocks.rpc.mockClear();
  await runGenerationWorkerBatch(1);
  expect(mocks.submit).toHaveBeenCalledTimes(2);
  expect(mocks.rpc).toHaveBeenCalledWith('mark_generation_uncertain', expect.objectContaining({ error_code: 'submit_ack_persist_failed' }));
});

it('logs the Fal request id on submit and passes the job id to the adapter', async () => {
  const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.stubEnv('GENERATION_MULTIMODEL_ENABLED', 'true'); vi.stubEnv('FAL_KEY', 'k');
  mocks.falSubmit.mockResolvedValue({ requestPath: '/fal-ai/ltx-video/requests/req_1', requestId: 'req_1' });
  withClaim(falJob());
  await runGenerationWorkerBatch(1);
  expect(JSON.parse(String(info.mock.calls[0][0]))).toEqual({
    event: 'generation.submitted', jobId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', model: 'ltx', requestId: 'req_1',
  });
  expect(mocks.falSubmit).toHaveBeenCalledWith('ltx', 'A slow shot of clouds', undefined, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
});

it('marks submitted rows without a provider path uncertain', async () => {
  rpcWith(submittedRow({ provider_request_path: null }));
  await runGenerationWorkerBatch(1);
  expect(mocks.rpc).toHaveBeenCalledWith('mark_generation_uncertain', expect.objectContaining({ error_code: 'provider_path_missing' }));
  expect(mocks.poll).not.toHaveBeenCalled();
});

it('keeps the reservation for submitted rows of an unknown provider', async () => {
  rpcWith(submittedRow({ provider: 'mystery', model: 'x' }));
  await runGenerationWorkerBatch(1);
  expect(mocks.rpc).toHaveBeenCalledWith('mark_generation_uncertain', expect.objectContaining({ error_code: 'model_unsupported' }));
});

it('cancels via a cancel_requested flag on a submitted row and retries a failed cancel', async () => {
  rpcWith(submittedRow({ cancel_requested: true }));
  await runGenerationWorkerBatch(1);
  expect(mocks.cancel).toHaveBeenCalledOnce();
  expect(mocks.rpc).toHaveBeenCalledWith('finish_generation_cancel', expect.any(Object));
  mocks.cancel.mockRejectedValue(new Error('x'));
  await runGenerationWorkerBatch(1);
  expect(mocks.rpc).toHaveBeenCalledWith('retry_generation_poll', expect.objectContaining({ delay_seconds: 10, error_code: 'cancel_retry' }));
});

it('schedules a short retry while the provider is still pending', async () => {
  rpcWith(submittedRow());
  await runGenerationWorkerBatch(1);
  expect(mocks.rpc).toHaveBeenCalledWith('retry_generation_poll', expect.objectContaining({ delay_seconds: 5, error_code: null }));
});

it.each(['temporary', 'unconfigured'])('retries polling on %s provider errors', async (code) => {
  mocks.poll.mockRejectedValue(providerError(code));
  rpcWith(submittedRow());
  await runGenerationWorkerBatch(1);
  expect(mocks.rpc).toHaveBeenCalledWith('retry_generation_poll', expect.objectContaining({ delay_seconds: 10, error_code: code }));
});

it('retries a non-provider poll exception as temporary and fails permanent poll errors', async () => {
  mocks.poll.mockRejectedValueOnce(new Error('boom'));
  rpcWith(submittedRow());
  await runGenerationWorkerBatch(1);
  expect(mocks.rpc).toHaveBeenCalledWith('retry_generation_poll', expect.objectContaining({ error_code: 'temporary' }));
  mocks.poll.mockRejectedValueOnce(providerError('invalid_result'));
  await runGenerationWorkerBatch(1);
  expect(mocks.rpc).toHaveBeenCalledWith('finish_generation_failure', expect.objectContaining({ error_code: 'invalid_result' }));
});

it('does not download when the lease cannot be extended after completion', async () => {
  completedPipeline({ extend_generation_lease: { data: false } });
  await expect(runGenerationWorkerBatch(1)).resolves.toEqual({ claimed: 1, advanced: 0 });
  expect(mocks.download).not.toHaveBeenCalled();
  completedPipeline({ extend_generation_lease: { data: null, error: new Error('db') } });
  await expect(runGenerationWorkerBatch(1)).resolves.toEqual({ claimed: 1, advanced: 0 });
});

it('retries a temporary download failure and fails a permanent one', async () => {
  completedPipeline();
  mocks.download.mockRejectedValueOnce(providerError('temporary'));
  await runGenerationWorkerBatch(1);
  expect(mocks.rpc).toHaveBeenCalledWith('retry_generation_poll', expect.objectContaining({ error_code: 'temporary' }));
  mocks.download.mockRejectedValueOnce(providerError('invalid_result'));
  await runGenerationWorkerBatch(1);
  expect(mocks.rpc).toHaveBeenCalledWith('finish_generation_failure', expect.objectContaining({ error_code: 'invalid_result' }));
  expect(mocks.upload).not.toHaveBeenCalled();
});

it('stops without uploading when the output path is unavailable', async () => {
  completedPipeline({ prepare_generation_output: { data: null, error: new Error('db') } });
  await expect(runGenerationWorkerBatch(1)).resolves.toMatchObject({ advanced: 0 });
  completedPipeline({ prepare_generation_output: { data: true } });
  await expect(runGenerationWorkerBatch(1)).resolves.toMatchObject({ advanced: 0 });
  expect(mocks.upload).not.toHaveBeenCalled();
});

it.each([[2, false], [3, true]])('stops when lease extension number %i fails (upload expected: %s)', async (failingCall, uploaded) => {
  completedPipeline();
  const base = mocks.rpc.getMockImplementation()!;
  let extendCalls = 0;
  mocks.rpc.mockImplementation(async (name: string, args: unknown) => {
    if (name === 'extend_generation_lease') { extendCalls += 1; return { data: extendCalls !== failingCall, error: null }; }
    return base(name, args);
  });
  await expect(runGenerationWorkerBatch(1)).resolves.toMatchObject({ advanced: 0 });
  expect(mocks.upload).toHaveBeenCalledTimes(uploaded ? 1 : 0);
  expect(mocks.rpc).not.toHaveBeenCalledWith('finish_generation_success', expect.anything());
});

it('retries storage when an upload conflicts and the existing object cannot be read', async () => {
  completedPipeline();
  mocks.upload.mockResolvedValue({ data: null, error: new Error('exists') });
  await runGenerationWorkerBatch(1);
  expect(mocks.rpc).toHaveBeenCalledWith('retry_generation_poll', expect.objectContaining({ delay_seconds: 30, error_code: 'storage_retry' }));
  expect(mocks.rpc).not.toHaveBeenCalledWith('finish_generation_success', expect.anything());
});

it('flags output_conflict for an existing object with a different size or hash, never overwriting', async () => {
  completedPipeline();
  mocks.upload.mockResolvedValue({ data: null, error: new Error('exists') });
  mocks.storageDownload.mockResolvedValueOnce({ data: blobOf(new Uint8Array([1, 2, 3])), error: null });
  await runGenerationWorkerBatch(1);
  mocks.storageDownload.mockResolvedValueOnce({ data: blobOf(new Uint8Array(generated.byteLength).fill(7)), error: null });
  await runGenerationWorkerBatch(1);
  const conflicts = mocks.rpc.mock.calls.filter(([name, args]) => name === 'retry_generation_poll' && (args as { error_code: string }).error_code === 'output_conflict');
  expect(conflicts).toHaveLength(2);
  expect(mocks.rpc).not.toHaveBeenCalledWith('finish_generation_success', expect.anything());
});

it('finalizes when an identical object already exists in storage', async () => {
  completedPipeline();
  mocks.upload.mockResolvedValue({ data: null, error: new Error('exists') });
  mocks.storageDownload.mockResolvedValue({ data: blobOf(generated), error: null });
  await expect(runGenerationWorkerBatch(1)).resolves.toMatchObject({ advanced: 1 });
  expect(mocks.rpc).toHaveBeenCalledWith('finish_generation_success', expect.objectContaining({ output_size_bytes: generated.byteLength }));
});

it('treats an already-completed row as done when the finalize response was lost', async () => {
  completedPipeline({ finish_generation_success: { data: null, error: new Error('lost') } });
  mocks.savedJob.mockResolvedValue({ data: { status: 'completed' } });
  await expect(runGenerationWorkerBatch(1)).resolves.toMatchObject({ advanced: 1 });
  expect(mocks.rpc).not.toHaveBeenCalledWith('retry_generation_poll', expect.objectContaining({ error_code: 'database_finalize_retry' }));
});
