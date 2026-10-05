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
  const query = { select: vi.fn(), order: vi.fn(), range: vi.fn().mockResolvedValue({ data: [{ id: 'asset', name: 'Real file' }], count: 25, error }) };
  query.select.mockReturnValue(query); query.order.mockReturnValue(query);
  const from = vi.fn(() => query);
  mocks.client.mockResolvedValue({ auth: { getUser: vi.fn().mockResolvedValue({ data: { user: user ? { id: 'user' } : null }, error: null }) }, from });
  return { query, from };
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
});
it('redacts database errors', async () => {
  setup(true, { message: 'SQL private detail' });
  const result = await getMedia(1);
  expect(result.items).toEqual([]);
  expect(result.error).toBeTruthy();
  expect(JSON.stringify(result)).not.toContain('SQL');
});
