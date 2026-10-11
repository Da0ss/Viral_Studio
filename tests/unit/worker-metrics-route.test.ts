import { afterEach, beforeEach, expect, test, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), metrics: vi.fn() }));
vi.mock('@/lib/worker-authorization', () => ({ authorizeScheduledWorker: mocks.auth }));
vi.mock('@/lib/worker-metrics', () => ({ readWorkerMetrics: mocks.metrics }));
import { GET } from '@/app/api/internal/worker-metrics/route';

beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockReturnValue(200);
  mocks.metrics.mockResolvedValue({ queues: { generation: { depth: 1, ready: 1 } } });
  vi.stubEnv('WORKER_METRICS_ENABLED', 'true');
});
afterEach(() => { vi.unstubAllEnvs(); });

test('requires scheduler auth before reading metrics', async () => {
  mocks.auth.mockReturnValue(401);
  const response = await GET(new Request('https://app.test/api/internal/worker-metrics'));
  expect(response.status).toBe(401);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(mocks.metrics).not.toHaveBeenCalled();
});

test('stays disabled until explicitly enabled', async () => {
  vi.stubEnv('WORKER_METRICS_ENABLED', 'false');
  const response = await GET(new Request('https://app.test/api/internal/worker-metrics'));
  expect(response.status).toBe(503);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(mocks.metrics).not.toHaveBeenCalled();
});

test('returns aggregate metrics without caching', async () => {
  const response = await GET(new Request('https://app.test/api/internal/worker-metrics'));
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(await response.json()).toEqual({ queues: { generation: { depth: 1, ready: 1 } } });
  expect(mocks.metrics).toHaveBeenCalledOnce();
});

test('redacts RPC failures', async () => {
  mocks.metrics.mockRejectedValue(new Error('secret SQL diagnostic'));
  const response = await GET(new Request('https://app.test/api/internal/worker-metrics'));
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: 'Worker metrics unavailable' });
});
