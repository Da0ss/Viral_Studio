import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { POST } from '@/app/api/internal/media-cleanup/route';
const mocks = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock('@/lib/media-cleanup-adapter', () => ({ runOneMediaCleanup: mocks.run }));
const secret = 'a'.repeat(64); // Invalid fixture credential, never used externally.
function request(authorization?: string, query = '') {
  return new Request(`http://localhost/api/internal/media-cleanup${query}`, {
    method: 'POST', headers: authorization ? { authorization } : {},
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('MEDIA_CLEANUP_SECRET', secret);
  vi.stubEnv('MEDIA_CLEANUP_ENABLED', 'true');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'different-test-key');
  mocks.run.mockResolvedValue('empty');
});
afterEach(() => vi.unstubAllEnvs());
it.each([undefined, '', 'Bearer wrong', `Basic ${secret}`, `Bearer ${'b'.repeat(64)}`, 'x'.repeat(513)])('denies invalid auth %s before worker access', async header => {
  const response = await POST(request(header));
  expect(response.status).toBe(401); expect(response.headers.get('cache-control')).toBe('no-store');
  expect(mocks.run).not.toHaveBeenCalled();
});
it('does not accept secrets in query strings', async () => {
  expect((await POST(request(undefined, `?secret=${secret}`))).status).toBe(401);
  expect(mocks.run).not.toHaveBeenCalled();
});
it.each(['', 'short', 'A'.repeat(64)])('fails closed for invalid server configuration %s', async configured => {
  vi.stubEnv('MEDIA_CLEANUP_SECRET', configured);
  expect((await POST(request(`Bearer ${configured}`))).status).toBe(503);
  expect(mocks.run).not.toHaveBeenCalled();
});
it('rejects reuse of the privileged Supabase key', async () => {
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', secret);
  expect((await POST(request(`Bearer ${secret}`))).status).toBe(503);
  expect(mocks.run).not.toHaveBeenCalled();
});
it.each(['false', '', '1'])('stays disabled unless explicitly true: %s', async flag => {
  vi.stubEnv('MEDIA_CLEANUP_ENABLED', flag);
  expect((await POST(request(`Bearer ${secret}`))).status).toBe(503);
  expect(mocks.run).not.toHaveBeenCalled();
});
it.each(['empty', 'completed', 'retry_scheduled', 'stale'])('returns bounded outcome %s', async outcome => {
  mocks.run.mockResolvedValue(outcome);
  const response = await POST(request(`Bearer ${secret}`));
  expect(response.status).toBe(200); expect(await response.json()).toEqual({ outcome });
  expect(mocks.run).toHaveBeenCalledTimes(1);
});
it.each(['invalid', 'unconfirmed'])('does not report uncertain work as success: %s', async outcome => {
  mocks.run.mockResolvedValue(outcome);
  expect((await POST(request(`Bearer ${secret}`))).status).toBe(503);
});
it('redacts provider and SQL exceptions', async () => {
  mocks.run.mockRejectedValue(new Error('SQL secret stack trace'));
  const response = await POST(request(`Bearer ${secret}`));
  expect(response.status).toBe(503); expect(await response.json()).toEqual({ error: 'Cleanup not confirmed' });
});
