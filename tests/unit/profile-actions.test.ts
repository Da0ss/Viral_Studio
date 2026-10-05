import { beforeEach, describe, expect, it, vi } from 'vitest';
import { updateProfile, uploadAvatar } from '@/actions/profile';
import type { ProfileValues } from '@/types/profile';
const mocks = vi.hoisted(() => ({ client: vi.fn(), revalidate: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.client }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
const input: ProfileValues = { name: 'Анна', email: 'anna@example.invalid', role: 'Дизайнер', language: 'ru', timezone: 'Asia/Qyzylorda', avatar_path: 'avatars/stale/path.png', notification_email: true, notification_browser: true, notification_marketing: false };
function setup({ user = true, updated = true } = {}) {
  const query = { eq: vi.fn(), is: vi.fn(), select: vi.fn(), maybeSingle: vi.fn() };
  query.eq.mockReturnValue(query); query.is.mockReturnValue(query); query.select.mockReturnValue(query);
  query.maybeSingle.mockResolvedValue({ data: updated ? { id: 'user' } : null, error: null });
  const update = vi.fn().mockReturnValue(query);
  const read = { eq: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({ data: { avatar_path: null }, error: null }) };
  read.eq.mockReturnValue(read);
  const storage = { upload: vi.fn().mockResolvedValue({ error: null }), remove: vi.fn().mockResolvedValue({ error: null }), createSignedUrl: vi.fn().mockResolvedValue({ data: { signedUrl: 'https://example.invalid/avatar' }, error: null }) };
  mocks.client.mockResolvedValue({ auth: { getUser: vi.fn().mockResolvedValue({ data: { user: user ? { id: 'user', email: input.email } : null }, error: null }), updateUser: vi.fn().mockResolvedValue({ error: null }) }, from: vi.fn(() => ({ update, select: vi.fn(() => read) })), storage: { from: vi.fn(() => storage) } });
  return { query, update, storage, read };
}
beforeEach(() => vi.resetAllMocks());
describe('profile action persistence boundaries', () => {
  it.each(['returned', 'thrown'])('preserves successful persistence when signing fails (%s)', async (failure) => {
    const client = setup();
    if (failure === 'returned') client.storage.createSignedUrl.mockResolvedValue({ data: null, error: { message: 'private detail' } });
    else client.storage.createSignedUrl.mockRejectedValue(new Error('private detail'));
    const form = new FormData();
    form.set('avatar', new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'avatar.png', { type: 'image/png' }));
    const result = await uploadAvatar(form);
    expect(result).toMatchObject({ status: 'uploaded', signedUrl: null, avatarPath: client.storage.upload.mock.calls[0][0] });
    expect(JSON.stringify(result)).not.toContain('private detail');
    expect(mocks.revalidate).toHaveBeenCalledWith('/profile');
  });
  it('reports cleanup failure without promising a nonexistent retry', async () => {
    const client = setup();
    client.read.maybeSingle.mockResolvedValue({ data: { avatar_path: 'avatars/user/old.png' }, error: null });
    client.storage.remove.mockRejectedValue(new Error('private detail'));
    const form = new FormData();
    form.set('avatar', new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'avatar.png', { type: 'image/png' }));
    expect(await uploadAvatar(form)).toMatchObject({ status: 'uploaded', warning: expect.stringContaining('повторная очистка пока недоступна') });
  });
  it('never writes a stale avatar path during ordinary profile save', async () => {
    const client = setup();
    expect(await updateProfile(input)).toHaveProperty('status', 'saved');
    expect(client.update.mock.calls[0][0]).not.toHaveProperty('avatar_path');
    expect(client.query.eq).toHaveBeenCalledWith('id', 'user');
  });
  it('rejects a missing profile instead of claiming success', async () => {
    setup({ updated: false });
    expect(await updateProfile(input)).toHaveProperty('status', 'error');
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
  it('does not mutate profiles for guests', async () => {
    const client = setup({ user: false });
    expect(await updateProfile(input)).toHaveProperty('status', 'error');
    expect(client.update).not.toHaveBeenCalled();
  });
  it('removes the newly uploaded object if the avatar compare-and-set loses', async () => {
    const client = setup({ updated: false });
    const form = new FormData();
    form.set('avatar', new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'avatar.png', { type: 'image/png' }));
    expect(await uploadAvatar(form)).toHaveProperty('status', 'error');
    expect(client.query.is).toHaveBeenCalledWith('avatar_path', null);
    const uploadedPath = client.storage.upload.mock.calls[0][0];
    expect(client.storage.remove).toHaveBeenCalledWith([uploadedPath]);
    expect(client.storage.createSignedUrl).not.toHaveBeenCalled();
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
});
