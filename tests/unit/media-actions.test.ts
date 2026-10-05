import { beforeEach, expect, it, vi } from 'vitest';
import { prepareMediaDownload } from '@/actions/media';
const mocks = vi.hoisted(() => ({ client: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.client }));
const project = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const path = `projects/${project}/77777777-7777-4777-8777-777777777777/clip.mp4`;
function form(id = '77777777-7777-4777-8777-777777777777') { const data = new FormData(); data.set('assetId', id); data.set('storage_path', 'attacker/path'); return data; }
function setup(user = true, asset: unknown = { project_id: project, storage_path: path }) {
  const query = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({ data: asset, error: null }) };
  query.select.mockReturnValue(query); query.eq.mockReturnValue(query);
  const signed = vi.fn().mockResolvedValue({ data: { signedUrl: 'https://example.invalid/file?token=short' }, error: null });
  const from = vi.fn(() => query);
  mocks.client.mockResolvedValue({ auth: { getUser: vi.fn().mockResolvedValue({ data: { user: user ? { id: 'user' } : null }, error: null }) }, from, storage: { from: vi.fn(() => ({ createSignedUrl: signed })) } });
  return { from, signed, query };
}
beforeEach(() => vi.resetAllMocks());
it('rejects malformed IDs before any backend access', async () => {
  expect(await prepareMediaDownload({}, form('invalid'))).toHaveProperty('error');
  expect(mocks.client).not.toHaveBeenCalled();
});
it('denies guests without querying assets', async () => {
  const client = setup(false);
  expect(await prepareMediaDownload({}, form())).toHaveProperty('error');
  expect(client.from).not.toHaveBeenCalled();
});
it('never signs unavailable assets', async () => {
  const client = setup(true, null);
  expect(await prepareMediaDownload({}, form())).toHaveProperty('error');
  expect(client.signed).not.toHaveBeenCalled();
});
it.each(['../private.mp4', path.replace(project, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')])('rejects invalid or mismatched paths %s', async storage_path => {
  const client = setup(true, { project_id: project, storage_path });
  expect(await prepareMediaDownload({}, form())).toHaveProperty('error');
  expect(client.signed).not.toHaveBeenCalled();
});
it('signs only the database path for 60 seconds with download disposition', async () => {
  const client = setup();
  expect(await prepareMediaDownload({}, form())).toHaveProperty('url');
  expect(client.signed).toHaveBeenCalledWith(path, 60, { download: true });
});
it('redacts Storage transport failures', async () => {
  const client = setup();
  client.signed.mockRejectedValue(new Error('SQL secret stack'));
  const result = await prepareMediaDownload({}, form());
  expect(result).toHaveProperty('error');
  expect(JSON.stringify(result)).not.toMatch(/SQL|secret|stack/);
});
