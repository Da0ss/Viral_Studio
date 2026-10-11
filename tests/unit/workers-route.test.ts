import { afterEach, beforeEach, expect, test, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), cleanup: vi.fn(), reconcile: vi.fn(), generation: vi.fn() }));
vi.mock('@/lib/worker-authorization', () => ({ authorizeScheduledWorker: mocks.auth }));
vi.mock('@/lib/media-cleanup-adapter', () => ({ runOneMediaCleanup: mocks.cleanup }));
vi.mock('@/lib/media-upload-reconcile-adapter', () => ({ runOneMediaUploadReconcile: mocks.reconcile }));
vi.mock('@/lib/generation-worker', () => ({ runGenerationWorkerBatch: mocks.generation }));
import { GET } from '@/app/api/internal/workers/route';

beforeEach(() => {
  vi.resetAllMocks(); mocks.auth.mockReturnValue(200);
  for (const flag of ['MEDIA_CLEANUP_ENABLED', 'MEDIA_UPLOAD_RECONCILE_ENABLED', 'GENERATION_ENABLED']) vi.stubEnv(flag, 'true');
  mocks.cleanup.mockResolvedValue('empty'); mocks.reconcile.mockResolvedValue('completed'); mocks.generation.mockResolvedValue({ claimed: 0, advanced: 0 });
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

test('does not call queues before authorization and marks response no-store', async () => {
  mocks.auth.mockReturnValue(401);
  const response = await GET(new Request('https://app.test/api/internal/workers'));
  expect(response.status).toBe(401);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(mocks.cleanup).not.toHaveBeenCalled(); expect(mocks.generation).not.toHaveBeenCalled();
});

test('drains each enabled queue fairly and returns redacted structured counts', async () => {
  mocks.reconcile.mockResolvedValueOnce('completed').mockResolvedValue('empty');
  const response = await GET(new Request('https://app.test/api/internal/workers'));
  const body = await response.json();
  expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
  expect(mocks.generation).toHaveBeenCalledWith(1, expect.any(Number));
  const deadlineAt = mocks.generation.mock.calls[0][1] as number;
  expect(mocks.cleanup).toHaveBeenCalledWith(deadlineAt);
  expect(mocks.reconcile).toHaveBeenCalledWith(deadlineAt);
  expect(mocks.cleanup).toHaveBeenCalledOnce(); expect(mocks.reconcile).toHaveBeenCalledTimes(2);
  expect(body).toMatchObject({ checked: 4, confirmed: true, counts: { started: 4, completed: 1, failed: 0 } });
  expect(body.correlationId).toMatch(/^[0-9a-f-]{36}$/);
});

test('reports failure generically while allowing other queues to drain', async () => {
  const logs = vi.spyOn(console, 'info').mockImplementation(() => undefined);
  mocks.cleanup.mockRejectedValue(new Error('private secret'));
  mocks.reconcile.mockResolvedValueOnce('completed').mockResolvedValue('empty');
  const response = await GET(new Request('https://app.test/api/internal/workers'));
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({ checked: 4, confirmed: false, counts: { failed: 1 } });
  expect(mocks.reconcile).toHaveBeenCalledTimes(2);
  expect(JSON.stringify(logs.mock.calls)).not.toContain('private secret');
  expect(JSON.parse(logs.mock.calls.at(-1)![0])).toMatchObject({ event: 'worker_batch_finished', counts: { started: 4, failed: 1 } });
});

test('does not invoke queues when all workers are disabled', async () => {
  for (const flag of ['MEDIA_CLEANUP_ENABLED', 'MEDIA_UPLOAD_RECONCILE_ENABLED', 'GENERATION_ENABLED']) vi.stubEnv(flag, 'false');
  const response = await GET(new Request('https://app.test/api/internal/workers'));
  expect(response.status).toBe(503); expect(response.headers.get('cache-control')).toBe('no-store');
  expect(mocks.cleanup).not.toHaveBeenCalled(); expect(mocks.reconcile).not.toHaveBeenCalled(); expect(mocks.generation).not.toHaveBeenCalled();
});
