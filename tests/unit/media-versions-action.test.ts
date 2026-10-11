import { beforeEach, expect, it, vi } from 'vitest';
import { listMediaVersions } from '@/actions/media';

const mediaVersionsLimit = 20;

const mocks = vi.hoisted(() => ({ client: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.client }));
const asset = '77777777-7777-4777-8777-777777777777';
const row = (n: number) => ({ id: `id-${n}`, version_number: n, mime_type: 'image/png', size_bytes: 10, created_at: '2026-10-01T00:00:00.000Z' });
function setup({ user = true, rows = [row(2), row(1)] as unknown[] | null, error = null as unknown } = {}) {
  const query = { select: vi.fn(), eq: vi.fn(), order: vi.fn(), limit: vi.fn().mockResolvedValue({ data: rows, error }) };
  query.select.mockReturnValue(query); query.eq.mockReturnValue(query); query.order.mockReturnValue(query);
  const from = vi.fn(() => query);
  mocks.client.mockResolvedValue({ auth: { getUser: vi.fn().mockResolvedValue({ data: { user: user ? { id: 'user' } : null }, error: null }) }, from });
  return { from, query };
}
beforeEach(() => vi.resetAllMocks());

it('rejects malformed asset IDs before any backend access', async () => {
  expect(await listMediaVersions('nope')).toMatchObject({ versions: [], error: 'msg.media.badItem' });
  expect(mocks.client).not.toHaveBeenCalled();
});
it('does not query versions for a signed-out caller', async () => {
  const client = setup({ user: false });
  expect(await listMediaVersions(asset)).toMatchObject({ error: 'msg.auth.signInAgain' });
  expect(client.from).not.toHaveBeenCalled();
});
it('reads a bounded, newest-first list through the caller session without storage paths', async () => {
  const client = setup();
  expect(await listMediaVersions(asset)).toEqual({ versions: [row(2), row(1)], hasMore: false });
  expect(client.from).toHaveBeenCalledWith('asset_versions');
  expect(client.query.select).toHaveBeenCalledWith(expect.not.stringContaining('storage_path'));
  expect(client.query.eq).toHaveBeenCalledWith('asset_id', asset);
  expect(client.query.order).toHaveBeenCalledWith('version_number', { ascending: false });
  expect(client.query.limit).toHaveBeenCalledWith(mediaVersionsLimit + 1);
});
it('reports that older versions were cut off', async () => {
  setup({ rows: Array.from({ length: mediaVersionsLimit + 1 }, (_, i) => row(mediaVersionsLimit + 1 - i)) });
  const result = await listMediaVersions(asset);
  expect(result.versions).toHaveLength(mediaVersionsLimit);
  expect(result.hasMore).toBe(true);
});
it('returns an error instead of an empty list when the query fails', async () => {
  setup({ rows: null, error: { message: 'private detail' } });
  const result = await listMediaVersions(asset);
  expect(result).toEqual({ versions: [], hasMore: false, error: 'msg.media.versionsFailed' });
});
