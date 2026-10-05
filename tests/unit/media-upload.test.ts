import { beforeEach, expect, it, vi } from 'vitest';
import { POST } from '@/app/api/projects/[projectId]/media/route';
const mocks = vi.hoisted(() => ({ client: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.client }));
const id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const context = { params: Promise.resolve({ projectId: id }) };
function request(origin = 'http://localhost', bytes = new Uint8Array([137,80,78,71,13,10,26,10])) {
  const form = new FormData(); form.set('file', new File([bytes], '../../photo.html', { type: 'image/png' }));
  return new Request(`http://localhost/api/projects/${id}/media`, { method: 'POST', headers: { origin }, body: form });
}
function setup(role = 'owner', inserted = true, user = true) {
  const member = { eq: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({ data: { role }, error: null }) }; member.eq.mockReturnValue(member);
  const insertQuery = { select: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({ data: inserted ? { id: 'asset' } : null, error: null }) }; insertQuery.select.mockReturnValue(insertQuery);
  const insert = vi.fn(() => insertQuery);
  const bucket = { upload: vi.fn().mockResolvedValue({ error: null }), remove: vi.fn().mockResolvedValue({ error: null }) };
  mocks.client.mockResolvedValue({ auth: { getUser: vi.fn().mockResolvedValue({ data: { user: user ? { id: 'user' } : null }, error: null }) }, from: vi.fn((table) => table === 'project_members' ? { select: vi.fn(() => member) } : { insert }), storage: { from: vi.fn(() => bucket) } });
  return { bucket, insert };
}
beforeEach(() => vi.resetAllMocks());
it('rejects declared oversized requests before backend access', async () => {
  const req = request();
  req.headers.set('content-length', String(52 * 1024 * 1024));
  const response = await POST(req, context);
  expect(response.status).toBe(413);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(mocks.client).not.toHaveBeenCalled();
});
it.each([undefined, '1'])('cancels oversized streamed bytes even when Content-Length is %s', async length => {
  const client = setup();
  const cancelled = vi.fn();
  // Reuse a chunk: test the actual byte-counting loop without allocating a
  // second giant fixture or allowing the stream to run forever.
  const chunk = new Uint8Array(1024 * 1024);
  const stream = new ReadableStream<Uint8Array>({ pull(controller) { controller.enqueue(chunk); }, cancel: cancelled });
  const headers: Record<string, string> = { origin: 'http://localhost', 'content-type': 'multipart/form-data; boundary=test' };
  if (length) headers['content-length'] = length;
  const init = { method: 'POST', headers, body: stream, duplex: 'half' };
  const response = await POST(new Request(`http://localhost/api/projects/${id}/media`, init), context);
  expect(response.status).toBe(413);
  expect(cancelled).toHaveBeenCalledTimes(1);
  expect(client.bucket.upload).not.toHaveBeenCalled();
  expect(client.insert).not.toHaveBeenCalled();
});
it('rejects malformed multipart bodies without Storage writes', async () => {
  const client = setup();
  const response = await POST(new Request(`http://localhost/api/projects/${id}/media`, { method: 'POST', headers: { origin: 'http://localhost', 'content-type': 'multipart/form-data; boundary=test' }, body: 'malformed' }), context);
  expect(response.status).toBe(400);
  expect(client.bucket.upload).not.toHaveBeenCalled();
});
it('does not disclose backend exceptions', async () => {
  mocks.client.mockRejectedValue(new Error('SQL secret stack'));
  const response = await POST(request(), context);
  expect(response.status).toBe(502);
  expect(await response.text()).not.toMatch(/SQL|secret|stack/);
});
it('rejects cross-origin requests before backend access', async () => {
  expect((await POST(request('https://attacker.invalid'), context)).status).toBe(403);
  expect(mocks.client).not.toHaveBeenCalled();
});
it.each(['viewer', 'commenter'])('denies %s upload', async role => {
  const client = setup(role);
  expect((await POST(request(), context)).status).toBe(403);
  expect(client.bucket.upload).not.toHaveBeenCalled();
});
it('denies guests', async () => {
  setup('owner', true, false);
  expect((await POST(request(), context)).status).toBe(401);
});
it('rejects content-type spoofing before Storage writes', async () => {
  const client = setup();
  expect((await POST(request('http://localhost', new Uint8Array([1,2,3])), context)).status).toBe(400);
  expect(client.bucket.upload).not.toHaveBeenCalled();
});
it('uploads immutable bytes with server-owned paths and creator', async () => {
  const client = setup();
  expect((await POST(request(), context)).status).toBe(201);
  expect(client.bucket.upload.mock.calls[0][0]).toMatch(new RegExp(`^projects/${id}/[0-9a-f-]+/photo\\.png$`));
  expect(client.bucket.upload.mock.calls[0][2]).toEqual({ contentType: 'image/png', upsert: false });
  expect(client.insert.mock.calls[0][0]).toMatchObject({ project_id: id, created_by: 'user', kind: 'image' });
});
it('cleans up an upload if metadata is not saved', async () => {
  const client = setup('editor', false);
  expect((await POST(request(), context)).status).toBe(502);
  expect(client.bucket.remove).toHaveBeenCalledWith([client.bucket.upload.mock.calls[0][0]]);
});
