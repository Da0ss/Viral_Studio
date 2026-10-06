import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { POST } from '@/app/api/projects/[projectId]/media/finalize/route';
import { maxMediaBytes } from '@/lib/media-file';

const mocks = vi.hoisted(() => ({ client: vi.fn(), admin: vi.fn(), storageFetch: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.client }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.admin }));
vi.mock('@/lib/supabase/config', () => ({ getSupabasePublicConfig: () => ({ url: 'https://storage.test' }) }));
vi.mock('@/lib/deadline-fetch', () => ({ createDeadlineFetch: () => mocks.storageFetch }));
const project = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const intentId = '12121212-1212-4212-8212-121212121212';
const lease = '13131313-1313-4313-8313-131313131313';
const bytes = new Uint8Array([137,80,78,71,13,10,26,10]);
const hash = createHash('sha256').update(bytes).digest('hex');
const path = `projects/${project}/${intentId}/photo.png`;
const context = { params: Promise.resolve({ projectId: project }) };
function setup(stored = bytes, authenticated = true, finishError = false) {
  const callerRpc = vi.fn().mockResolvedValue({ data: true, error: null });
  const adminRpc = vi.fn(async (name: string) => name === 'get_media_upload_verification'
    ? { data: [{ object_path: path, mime_type: 'image/png', content_sha256: hash, size_bytes: bytes.length }], error: null }
    : { data: finishError ? null : 'asset-id', error: finishError ? { message: 'uncertain acknowledgement' } : null });
  mocks.storageFetch.mockResolvedValue({ ok: true, headers: new Headers({ 'content-length': String(stored.byteLength) }), body: new Blob([stored]).stream() });
  mocks.client.mockResolvedValue({ auth: { getUser: vi.fn().mockResolvedValue({ data: { user: authenticated ? { id: 'user' } : null }, error: null }) }, rpc: callerRpc });
  mocks.admin.mockReturnValue({ rpc: adminRpc, storage: { from: vi.fn(() => ({ download })) } });
  return { callerRpc, adminRpc };
}
function request(origin = 'http://localhost') {
  return new Request(`http://localhost/api/projects/${project}/media/finalize`, {
    method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ intentId, leaseToken: lease }),
  });
}
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role'); });
afterEach(() => vi.unstubAllEnvs());

it('authenticates the caller and verifies the exact stored bytes before finalizing', async () => {
  const client = setup();
  const response = await POST(request(), context);
  expect(response.status).toBe(201);
  expect(await response.json()).toEqual({ id: 'asset-id' });
  expect(mocks.storageFetch).toHaveBeenCalledWith(`https://storage.test/storage/v1/object/authenticated/project-media/${path}`, expect.objectContaining({ redirect: 'error', headers: expect.any(Object) }));
  expect(client.adminRpc).toHaveBeenCalledWith('finish_media_upload', { target_intent: intentId, token: lease, actual_hash: hash, actual_size: bytes.length });
});
it('fails closed without reflecting private transport details when Storage redirects', async () => {
  const client = setup();
  mocks.storageFetch.mockRejectedValue(new Error('redirected with private credential'));
  const response = await POST(request(), context);
  expect(response.status).toBe(502);
  expect(JSON.stringify(await response.json())).not.toContain('private credential');
  expect(client.adminRpc).not.toHaveBeenCalledWith('finish_media_upload', expect.anything());
});
it('does not create asset metadata when stored content has a different hash', async () => {
  const client = setup(new Uint8Array([1, 2, 3]));
  expect((await POST(request(), context)).status).toBe(422);
  expect(client.adminRpc).not.toHaveBeenCalledWith('finish_media_upload', expect.anything());
});
it('keeps the intent retryable when the finish acknowledgement is uncertain', async () => {
  const client = setup(bytes, true, true);
  const response = await POST(request(), context);
  expect(response.status).toBe(202);
  expect(response.headers.get('retry-after')).toBe('3');
  expect(client.adminRpc).toHaveBeenCalledWith('finish_media_upload', expect.objectContaining({ actual_hash: hash, actual_size: bytes.length }));
});
it('rejects a stored object with a declared length above the bucket cap', async () => {
  const client = setup();
  mocks.storageFetch.mockResolvedValue({ ok: true, headers: new Headers({ 'content-length': String(maxMediaBytes + 1) }), body: new Blob([bytes]).stream() });
  expect((await POST(request(), context)).status).toBe(422);
  expect(client.adminRpc).not.toHaveBeenCalledWith('finish_media_upload', expect.anything());
});
it('rejects unauthenticated and cross-origin finalization', async () => {
  setup(bytes, false);
  expect((await POST(request(), context)).status).toBe(401);
  vi.resetAllMocks();
  expect((await POST(request('https://attacker.invalid'), context)).status).toBe(403);
  expect(mocks.client).not.toHaveBeenCalled();
});
