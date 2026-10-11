import { beforeEach, expect, it, vi } from 'vitest';
import { getMediaVersions, maxMediaVersionPage, mediaVersionPageSize } from '@/lib/media';

const mocks = vi.hoisted(() => ({ client: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.client }));

const assetId = 'abababab-abab-4bab-8bab-abababababab';
const version = { id: 'acacacac-acac-4cac-8cac-acacacacacac', asset_id: assetId, version_number: 2, mime_type: 'image/png', size_bytes: 128, created_by: '11111111-1111-4111-8111-111111111111', created_at: '2026-10-01T00:00:00Z' };

beforeEach(() => vi.resetAllMocks());

function setup({ user = true, rows = [version], count = rows.length, error = null, authError = null } = {}) {
  const query = {
    select: vi.fn(), eq: vi.fn(), order: vi.fn(), range: vi.fn().mockResolvedValue({ data: rows, count, error }),
  };
  query.select.mockReturnValue(query); query.eq.mockReturnValue(query); query.order.mockReturnValue(query);
  const from = vi.fn().mockReturnValue(query);
  mocks.client.mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: user ? { id: '11111111-1111-4111-8111-111111111111' } : null }, error: authError }) },
    from,
  });
  return { from, query };
}

it('validates the canonical asset ID and bounded page before creating a client', async () => {
  expect((await getMediaVersions('asset')).status).toBe('error');
  expect((await getMediaVersions(assetId, maxMediaVersionPage + 1)).status).toBe('error');
  expect(mocks.client).not.toHaveBeenCalled();
});

it('does not query version rows for an unauthenticated caller', async () => {
  const client = setup({ user: false });
  expect(await getMediaVersions(assetId)).toMatchObject({ status: 'unauthenticated', authenticated: false });
  expect(client.from).not.toHaveBeenCalled();
});

it('uses bounded, stable RLS pagination and selects no storage path', async () => {
  const { query } = setup({ count: 25 });
  const result = await getMediaVersions(assetId.toUpperCase(), 2);
  expect(result).toMatchObject({ status: 'success', total: 25, page: 2, pageSize: mediaVersionPageSize, items: [version] });
  expect(query.select).toHaveBeenCalledWith('id, asset_id, version_number, mime_type, size_bytes, created_by, created_at', { count: 'exact' });
  expect(query.eq).toHaveBeenCalledWith('asset_id', assetId);
  expect(query.order.mock.calls).toEqual([[ 'version_number', { ascending: false } ], [ 'id', { ascending: false } ]]);
  expect(query.range).toHaveBeenCalledWith(24, 47);
  expect(query.select.mock.calls[0][0]).not.toContain('storage_path');
});

it('represents denied or absent rows as empty and redacts database failures', async () => {
  setup({ rows: [], count: 0 });
  expect(await getMediaVersions(assetId)).toMatchObject({ status: 'empty', total: 0, items: [] });
  setup({ error: { message: 'private SQL detail' }, count: null });
  const result = await getMediaVersions(assetId);
  expect(result).toMatchObject({ status: 'error', authenticated: true, code: 'query_error', items: [] });
  expect(JSON.stringify(result)).not.toContain('private SQL detail');
});
