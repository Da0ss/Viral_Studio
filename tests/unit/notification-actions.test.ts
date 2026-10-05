import { beforeEach, describe, expect, it, vi } from 'vitest';
import { markNotificationRead } from '@/actions/notifications';
const mocks = vi.hoisted(() => ({ client: vi.fn(), revalidate: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.client }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
const id = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const form = () => { const data = new FormData(); data.set('notificationId', id); return data; };
function setup(user = true, data: unknown = { id }) {
  const query = { eq: vi.fn(), is: vi.fn(), select: vi.fn(), maybeSingle: vi.fn() };
  query.eq.mockReturnValue(query); query.is.mockReturnValue(query); query.select.mockReturnValue(query);
  query.maybeSingle.mockResolvedValue({ data, error: null });
  const update = vi.fn(() => query);
  mocks.client.mockResolvedValue({ auth: { getUser: vi.fn().mockResolvedValue({ data: { user: user ? { id: 'current-user' } : null }, error: null }) }, from: vi.fn(() => ({ update, select: query.select })) });
  return { query, update };
}
beforeEach(() => vi.resetAllMocks());
describe('notification read action', () => {
  it('denies guests before mutation', async () => {
    const client = setup(false);
    expect(await markNotificationRead({}, form())).toHaveProperty('error');
    expect(client.update).not.toHaveBeenCalled();
  });
  it('scopes mutation to the authenticated owner and unread state', async () => {
    const client = setup();
    expect(await markNotificationRead({}, form())).toHaveProperty('success');
    expect(client.query.eq).toHaveBeenCalledWith('user_id', 'current-user');
    expect(client.query.eq).toHaveBeenCalledWith('id', id);
    expect(client.query.is).toHaveBeenCalledWith('read_at', null);
    expect(mocks.revalidate).toHaveBeenCalledWith('/notifications');
  });
  it('rejects unavailable rows without false success', async () => {
    setup(true, null);
    expect(await markNotificationRead({}, form())).toHaveProperty('error');
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
  it('does not leak internal errors from rejected requests', async () => {
    mocks.client.mockRejectedValue(new Error('SQL secret stack'));
    const result = await markNotificationRead({}, form());
    expect(result).toHaveProperty('error');
    expect(JSON.stringify(result)).not.toMatch(/SQL|secret|stack/);
  });
});
