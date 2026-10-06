import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { POST } from '@/app/api/internal/media-upload-reconcile/route';
const mocks = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock('@/lib/media-upload-reconcile-adapter', () => ({ runOneMediaUploadReconcile: mocks.run }));
const secret = 'a'.repeat(64);
function request(authorization?: string) { return new Request('http://localhost/api/internal/media-upload-reconcile', { method: 'POST', headers: authorization ? { authorization } : {} }); }
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv('MEDIA_UPLOAD_RECONCILE_SECRET', secret); vi.stubEnv('MEDIA_UPLOAD_RECONCILE_ENABLED', 'true'); vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'different'); mocks.run.mockResolvedValue('empty'); });
afterEach(() => vi.unstubAllEnvs());
it('requires the separate machine credential', async () => { expect((await POST(request())).status).toBe(401); expect(mocks.run).not.toHaveBeenCalled(); });
it('stays disabled unless explicitly enabled', async () => { vi.stubEnv('MEDIA_UPLOAD_RECONCILE_ENABLED', '1'); expect((await POST(request(`Bearer ${secret}`))).status).toBe(503); });
it('returns bounded outcomes and redacts failures', async () => {
  mocks.run.mockResolvedValue('completed'); const response = await POST(request(`Bearer ${secret}`));
  expect(response.status).toBe(200); expect(await response.json()).toEqual({ outcome: 'completed' });
  mocks.run.mockRejectedValue(new Error('SQL secret trace')); const failure = await POST(request(`Bearer ${secret}`));
  expect(failure.status).toBe(503); expect(await failure.text()).not.toMatch(/SQL|secret/);
});
