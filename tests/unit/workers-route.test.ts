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
test('does not call queues before authorization', async () => {
  mocks.auth.mockReturnValue(401);
  expect((await GET(new Request('https://app.test/api/internal/workers'))).status).toBe(401);
  expect(mocks.cleanup).not.toHaveBeenCalled(); expect(mocks.generation).not.toHaveBeenCalled();
});
test('bounds generation batch and checks all enabled queues', async () => {
  const result = await GET(new Request('https://app.test/api/internal/workers'));
  expect(result.status).toBe(200); expect(result.headers.get('cache-control')).toBe('no-store');
  expect(mocks.generation).toHaveBeenCalledWith(1);
  expect(await result.json()).toEqual({ checked: 3, confirmed: true });
});
test('reports uncertainty generically while other queues still run', async () => {
  const logs = vi.spyOn(console, 'info').mockImplementation(() => undefined);
  mocks.cleanup.mockRejectedValue(new Error('private secret'));
  const result = await GET(new Request('https://app.test/api/internal/workers'));
  expect(result.status).toBe(503); expect(await result.json()).toEqual({ checked: 3, confirmed: false });
  expect(mocks.reconcile).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(logs.mock.calls)).not.toContain('private secret');
  expect(JSON.parse(logs.mock.calls.at(-1)![0])).toMatchObject({ event: 'worker_batch_finished', checked: 3, confirmed: false });
});
test.each([
  { claimed: 1, advanced: 0 }, { claimed: 1, advanced: 2 },
  { claimed: -1, advanced: -1 }, { claimed: 0.5, advanced: 0.5 },
])('does not report an unconfirmed generation batch as success: %j', async counts => {
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  mocks.generation.mockResolvedValue(counts);
  const result = await GET(new Request('https://app.test/api/internal/workers'));
  expect(result.status).toBe(503);
  expect(await result.json()).toEqual({ checked: 3, confirmed: false });
  expect(mocks.cleanup).toHaveBeenCalledOnce();
  expect(mocks.reconcile).toHaveBeenCalledOnce();
});
test.each([undefined, 'stale', 'unexpected'])('fails closed on an unrecognized queue outcome %s', async outcome => {
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  mocks.reconcile.mockResolvedValue(outcome);
  const response = await GET(new Request('https://app.test/api/internal/workers'));
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ checked: 3, confirmed: false });
});
