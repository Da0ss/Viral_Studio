import { beforeEach, expect, it, vi } from 'vitest';
import { GET, POST } from '@/app/api/projects/[projectId]/media/route';
import { createHash } from 'node:crypto';

const mocks = vi.hoisted(() => ({ client: vi.fn(), admin: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.client }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.admin }));
const project = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const intentId = '12121212-1212-4212-8212-121212121212';
const lease = '13131313-1313-4313-8313-131313131313';
const key = '14141414-1414-4414-8414-141414141414';
const path = `projects/${project}/${intentId}/photo.png`;
const png = new Uint8Array([137,80,78,71,13,10,26,10]);
const hash = createHash('sha256').update(png).digest('hex');
const context = { params: Promise.resolve({ projectId: project }) };
function request(origin = 'http://localhost', withKey = true) {
  const headers = new Headers({ origin, 'content-type': 'application/json' });
  if (withKey) headers.set('idempotency-key', key);
  return new Request(`http://localhost/api/projects/${project}/media`, { method: 'POST', headers,
    body: JSON.stringify({ sha256: hash, mimeType: 'image/png', fileName: 'photo.png', size: png.length }) });
}
function setup(options: { outcome?: string; status?: string; beginError?: boolean; existingToken?: string } = {}) {
  const bucket = { createSignedUploadUrl: vi.fn().mockResolvedValue({ data: { token: 'signed-token', signedUrl: '/signed' }, error: null }) };
  const clientRpc = vi.fn(async (name: string) => {
    if (name === 'get_media_upload_status') return { data: [{ outcome: options.status ?? 'none', asset_id: options.status === 'completed' ? 'asset' : null }], error: null };
    if (name === 'begin_media_upload') {
      if (options.beginError) return { data: null, error: { code: '42501' } };
      const outcome = options.outcome ?? 'upload';
      return { data: [{ outcome, intent_id: intentId, lease_token: lease, object_path: path, asset_id: outcome === 'completed' ? 'asset' : null }], error: null };
    }
    if (name === 'assert_media_upload_lease') return { data: true, error: null };
    return { data: null, error: { message: 'unexpected caller RPC' } };
  });
  const adminRpc = vi.fn(async (_name: string, args: { signed_token?: string }) => ({
    data: [{ upload_token: args.signed_token ?? options.existingToken ?? null, expires_at: '2026-10-06T12:00:00.000Z' }], error: null,
  }));
  mocks.client.mockResolvedValue({ auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user' } }, error: null }) }, rpc: clientRpc });
  mocks.admin.mockReturnValue({ rpc: adminRpc, storage: { from: vi.fn(() => bucket) } });
  return { clientRpc, adminRpc, bucket };
}
beforeEach(() => vi.resetAllMocks());

it('requires same-origin requests and a UUID idempotency key', async () => {
  expect((await POST(request('https://attacker.invalid'), context)).status).toBe(403);
  expect((await POST(request('http://localhost', false), context)).status).toBe(400);
  expect(mocks.client).not.toHaveBeenCalled();
});
it('bounds the metadata request body before parsing', async () => {
  setup();
  const stream = new ReadableStream<Uint8Array>({ pull(controller) { controller.enqueue(new Uint8Array(20_000)); } });
  const response = await POST(new Request(`http://localhost/api/projects/${project}/media`, { method: 'POST', headers: { origin: 'http://localhost', 'content-type': 'application/json', 'idempotency-key': key }, body: stream, duplex: 'half' } as RequestInit), context);
  expect(response.status).toBe(413);
});
it('reserves the quota then returns the persisted signed token for the canonical path', async () => {
  const client = setup();
  const response = await POST(request(), context);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ intentId, leaseToken: lease, path, token: 'signed-token' });
  expect(client.clientRpc).toHaveBeenCalledWith('begin_media_upload', expect.objectContaining({ target_project: project, request_key: key, content_hash: hash, content_type: 'image/png', upload_size: png.length }));
  expect(client.bucket.createSignedUploadUrl).toHaveBeenCalledWith(path, { upsert: false });
  expect(client.adminRpc).toHaveBeenCalledWith('store_media_upload_token', { target_intent: intentId, token: lease, signed_token: 'signed-token' });
});
it('replays the durable signed token without minting a new capability', async () => {
  const client = setup({ existingToken: 'persisted-token' });
  const response = await POST(request(), context);
  expect(response.status).toBe(200);
  expect((await response.json()).token).toBe('persisted-token');
  expect(client.bucket.createSignedUploadUrl).not.toHaveBeenCalled();
});
it('returns a completed idempotent result without creating another signed URL', async () => {
  const client = setup({ outcome: 'completed' });
  expect((await POST(request(), context)).status).toBe(201);
  expect(client.bucket.createSignedUploadUrl).not.toHaveBeenCalled();
});
it('communicates quota, role and mismatched-payload outcomes', async () => {
  const quota = setup({ outcome: 'quota' });
  expect((await POST(request(), context)).status).toBe(429);
  vi.resetAllMocks();
  const forbidden = setup({ beginError: true });
  expect((await POST(request(), context)).status).toBe(403);
  vi.resetAllMocks();
  const conflict = setup({ outcome: 'conflict' });
  expect((await POST(request(), context)).status).toBe(409);
  expect(quota.bucket.createSignedUploadUrl).not.toHaveBeenCalled();
  expect(forbidden.bucket.createSignedUploadUrl).not.toHaveBeenCalled();
  expect(conflict.bucket.createSignedUploadUrl).not.toHaveBeenCalled();
});
it('reports durable status for a repeated payload key', async () => {
  const client = setup({ status: 'completed' });
  const response = await GET(new Request(`http://localhost/api/projects/${project}/media`, { headers: { 'idempotency-key': key, 'x-content-sha256': hash } }), context);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ status: 'completed', id: 'asset' });
  expect(client.clientRpc).toHaveBeenCalledWith('get_media_upload_status', { target_project: project, request_key: key, content_hash: hash });
});
