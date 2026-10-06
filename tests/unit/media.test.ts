import { beforeEach, expect, it, vi } from 'vitest';
import { getMedia, parseMediaPage } from '@/lib/media';
const mocks = vi.hoisted(() => ({ client: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.client }));
beforeEach(() => vi.resetAllMocks());
it('normalizes pagination without accepting malformed offsets', () => {
  expect(['0', '-1', '2junk', undefined].map(parseMediaPage)).toEqual([1, 1, 1, 1]);
  expect(parseMediaPage('999999')).toBe(10000);
});
function setup(user = true, error: unknown = null) {
  const query = { select: vi.fn(), order: vi.fn(), range: vi.fn().mockResolvedValue({ data: [{ id: 'asset', project_id: 'project', name: 'Real file' }], count: 25, error }) };
  query.select.mockReturnValue(query); query.order.mockReturnValue(query);
  const membershipQuery = { select: vi.fn(), eq: vi.fn(), in: vi.fn().mockResolvedValue({ data: [{ project_id: 'project', role: 'owner' }], error: null }) };
  membershipQuery.select.mockReturnValue(membershipQuery); membershipQuery.eq.mockReturnValue(membershipQuery);
  const from = vi.fn((table: string) => table === 'assets' ? query : membershipQuery);
  mocks.client.mockResolvedValue({ auth: { getUser: vi.fn().mockResolvedValue({ data: { user: user ? { id: 'user' } : null }, error: null }) }, from });
  return { query, from, membershipQuery };
}
it('does not query private records for guests', async () => {
  const client = setup(false);
  expect(await getMedia(1)).toHaveProperty('authenticated', false);
  expect(client.from).not.toHaveBeenCalled();
});
it('reads bounded records without exposing Storage paths', async () => {
  const client = setup();
  expect(await getMedia(2)).toMatchObject({ total: 25, items: [{ name: 'Real file' }] });
  expect(client.query.range).toHaveBeenCalledWith(24, 47);
  expect(client.query.select.mock.calls[0][0]).not.toContain('storage_path');
  expect(client.membershipQuery.in).toHaveBeenCalledWith('project_id', ['project']);
});
it('redacts database errors', async () => {
  setup(true, { message: 'SQL private detail' });
  const result = await getMedia(1);
  expect(result.items).toEqual([]);
  expect(result.error).toBeTruthy();
  expect(JSON.stringify(result)).not.toContain('SQL');
});
