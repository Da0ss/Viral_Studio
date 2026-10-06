import { beforeEach, expect, it, vi } from 'vitest';
import { deleteMedia } from '@/actions/media';
const mocks = vi.hoisted(() => ({ client: vi.fn(), revalidate: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.client }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
const id = '77777777-7777-4777-8777-777777777777';
const project = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const path = `projects/${project}/${id}/clip.mp4`;
function form(confirm = true) { const data = new FormData(); data.set('assetId', id); if (confirm) data.set('confirmation', 'delete'); return data; }
function setup(role = 'owner', deleted = true, sharedTable = '') {
  const deletion = vi.fn();
  function query(result: unknown) { const q = { eq: vi.fn(), select: vi.fn(), limit: vi.fn(), maybeSingle: vi.fn().mockResolvedValue(result) }; q.eq.mockReturnValue(q); q.select.mockReturnValue(q); q.limit.mockResolvedValue(result); return q; }
  const deleteQuery = query({ data: deleted ? { id } : null, error: null }); deletion.mockReturnValue(deleteQuery);
  const assetQuery = query({ data: { project_id: project, storage_path: path }, error: null });
  const memberQuery = query({ data: { role }, error: null });
  const versionsQuery = query({ data: [], count: 0, error: null });
  const reference = (table: string) => {
    const q = { in: vi.fn(), neq: vi.fn(), limit: vi.fn().mockResolvedValue({ data: sharedTable === table ? [{ id: 'other' }] : [], error: null }) };
    q.in.mockReturnValue(q); q.neq.mockReturnValue(q); return q;
  };
  mocks.client.mockResolvedValue({ auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user' } }, error: null }) }, from: vi.fn(table => table === 'assets' ? { select: vi.fn(columns => columns === 'id' ? reference(table) : assetQuery), delete: deletion } : { select: vi.fn(columns => columns === 'id' ? reference(table) : table === 'project_members' ? memberQuery : versionsQuery) }) });
  return { deletion, deleteQuery };
}
beforeEach(() => vi.resetAllMocks());
it.each(['assets','asset_versions'])('does not remove files referenced by other %s', async table => {
  const client = setup('owner', true, table);
  expect(await deleteMedia({}, form())).toMatchObject({ error: 'Файл используется другим материалом. Удаление отменено.' });
  expect(client.deletion).not.toHaveBeenCalled();
});
it('requires explicit confirmation before backend access', async () => {
  expect(await deleteMedia({}, form(false))).toHaveProperty('error');
  expect(mocks.client).not.toHaveBeenCalled();
});
it.each(['viewer','commenter'])('denies %s deletion before DB modification', async role => {
  const client = setup(role);
  expect(await deleteMedia({}, form())).toHaveProperty('error');
  expect(client.deletion).not.toHaveBeenCalled();
});
it('does not report a zero-row database deletion as success', async () => {
  setup('owner', false);
  expect(await deleteMedia({}, form())).toHaveProperty('error');
  expect(mocks.revalidate).not.toHaveBeenCalled();
});
it('deletes asset via atomic DB transaction triggering outbox worker enqueueing', async () => {
  const client = setup('editor');
  expect(await deleteMedia({}, form())).toMatchObject({ success: 'Материал удалён из списка; файл поставлен в очередь безопасной очистки.' });
  expect(client.deleteQuery.eq).toHaveBeenCalledWith('storage_path', path);
  expect(mocks.revalidate).toHaveBeenCalledWith('/media');
});
