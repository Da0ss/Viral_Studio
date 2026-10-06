import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  admin: vi.fn(), submit: vi.fn(), poll: vi.fn(), download: vi.fn(), cancel: vi.fn(),
  rpc: vi.fn(), upload: vi.fn(), storageDownload: vi.fn(), savedJob: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.admin }));
vi.mock('@/lib/huggingface-video', () => ({
  submitVideo: mocks.submit, pollVideo: mocks.poll, downloadVideo: mocks.download, cancelVideo: mocks.cancel,
  VideoProviderError: class VideoProviderError extends Error { constructor(message: string, readonly code: string) { super(message); } },
}));

import { advanceGenerationJob, runGenerationWorkerBatch } from '@/lib/generation-worker';

const generated = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 109, 112, 52, 50, 0, 0, 0, 0]);
const claimed = (overrides: Record<string, unknown> = {}) => ({
  job_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', dispatch_state: 'submitting',
  lease_token: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', project_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  requested_by: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', prompt: 'A slow shot of clouds',
  provider_request_path: null, cancel_requested: false, output_storage_path: null, ...overrides,
});

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
  await expect(runGenerationWorkerBatch(1)).resolves.toMatchObject({ claimed: 1, advanced: 1 });
  expect(mocks.rpc).toHaveBeenCalledWith('authorize_generation_dispatch', expect.any(Object));
  expect(mocks.submit).toHaveBeenCalledTimes(1);
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

it('does not expose admin work to callers while the feature flag is off', async () => {
  vi.stubEnv('GENERATION_ENABLED', 'false');
  await expect(runGenerationWorkerBatch(1)).resolves.toEqual({ claimed: 0, advanced: 0 });
  await expect(advanceGenerationJob('job', 'user')).resolves.toBe(false);
  expect(mocks.admin).not.toHaveBeenCalled();
});
