// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProfileForm } from '@/components/profile-form';
import type { ProfileValues } from '@/types/profile';

const mocks = vi.hoisted(() => ({ save: vi.fn(), upload: vi.fn(), refresh: vi.fn() }));
vi.mock('@/actions/profile', () => ({ updateProfile: mocks.save, uploadAvatar: mocks.upload }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
const profile: ProfileValues = { name: 'Анна', email: 'anna@example.invalid', role: 'Дизайнер', language: 'ru', timezone: 'Asia/Qyzylorda', avatar_path: '', notification_email: true, notification_browser: true, notification_marketing: false };
function deferred() {
  let resolve!: (value: unknown) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:test'), revokeObjectURL: vi.fn() }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
async function editName() {
  const user = userEvent.setup();
  render(<ProfileForm initialProfile={profile} initialAvatarUrl={null} />);
  await user.clear(screen.getByLabelText('Имя'));
  await user.type(screen.getByLabelText('Имя'), 'Новое имя');
  return user;
}
async function selectAvatar(user: ReturnType<typeof userEvent.setup>) {
  await user.upload(screen.getByLabelText('Файл аватара'), new File(['fake bytes'], 'photo.png', { type: 'image/png' }));
}
describe('profile and avatar operation coordination', () => {
  it('updates the saved baseline and clears retry controls without a signed preview', async () => {
    mocks.upload.mockResolvedValue({ status: 'uploaded', avatarPath: 'avatars/user/saved.png', signedUrl: null, warning: 'Аватар сохранён, но предпросмотр недоступен.' });
    const user = await editName();
    await selectAvatar(user);
    await user.click(screen.getByRole('button', { name: 'Загрузить аватар' }));
    await screen.findByText('Аватар сохранён, но предпросмотр недоступен.');
    expect(screen.queryByRole('button', { name: 'Загрузить аватар' })).toBeNull();
    expect(screen.queryByAltText('Предпросмотр аватара')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Отменить', exact: true }));
    expect(document.querySelector<HTMLInputElement>('input[name="avatar_path"]')?.value).toBe('avatars/user/saved.png');
    expect(mocks.upload).toHaveBeenCalledTimes(1);
  });
  it('retains the confirmed email while a change awaits confirmation', async () => {
    mocks.save.mockResolvedValue({ status: 'saved', emailChangePending: true });
    const user = await editName();
    await user.clear(screen.getByLabelText('Email'));
    await user.type(screen.getByLabelText('Email'), 'new@example.invalid');
    await user.click(screen.getByRole('button', { name: 'Сохранить', exact: true }));
    await waitFor(() => expect((screen.getByLabelText('Email') as HTMLInputElement).value).toBe(profile.email));
    expect(screen.getAllByText(/Подтвердите новый email/).length).toBeGreaterThan(0);
    expect((screen.getByLabelText('Имя') as HTMLInputElement).value).toBe('Новое имя');
  });
  it('rejects oversized avatar selection without starting a request', async () => {
    const user = await editName();
    await user.upload(screen.getByLabelText('Файл аватара'), new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'large.png', { type: 'image/png' }));
    expect(screen.getByText('Размер файла не должен превышать 5 МБ.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Загрузить аватар' })).toBeNull();
    expect(mocks.upload).not.toHaveBeenCalled();
  });
  it('blocks avatar controls and editable fields during save, then unlocks after failure', async () => {
    const pending = deferred();
    mocks.save.mockReturnValue(pending.promise);
    const user = await editName();
    await selectAvatar(user);
    await user.click(screen.getByRole('button', { name: 'Сохранить', exact: true }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
    expect((screen.getByLabelText('Файл аватара') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Загрузить аватар' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByLabelText('Имя').closest('fieldset')?.disabled).toBe(true);
    await act(async () => pending.reject(new Error('network unavailable')));
    await waitFor(() => expect((screen.getByRole('button', { name: 'Сохранить', exact: true }) as HTMLButtonElement).disabled).toBe(false));
    expect((screen.getByRole('button', { name: 'Загрузить аватар' }) as HTMLButtonElement).disabled).toBe(false);
    expect(mocks.upload).not.toHaveBeenCalled();
  });
  it('blocks save/cancel during avatar upload and preserves other dirty fields after success', async () => {
    const pending = deferred();
    mocks.upload.mockReturnValue(pending.promise);
    const user = await editName();
    await selectAvatar(user);
    await user.click(screen.getByRole('button', { name: 'Загрузить аватар' }));
    expect((screen.getByRole('button', { name: 'Сохранить', exact: true }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Отменить', exact: true }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => pending.resolve({ status: 'uploaded', avatarPath: 'avatars/user/photo.png', signedUrl: 'https://example.invalid/photo.png' }));
    await waitFor(() => expect((screen.getByRole('button', { name: 'Сохранить', exact: true }) as HTMLButtonElement).disabled).toBe(false));
    expect((screen.getByLabelText('Имя') as HTMLInputElement).value).toBe('Новое имя');
    await user.click(screen.getByRole('button', { name: 'Отменить', exact: true }));
    expect((screen.getByLabelText('Имя') as HTMLInputElement).value).toBe('Анна');
    expect(document.querySelector<HTMLInputElement>('input[name="avatar_path"]')?.value).toBe('avatars/user/photo.png');
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it('releases the profile lock after a rejected upload', async () => {
    mocks.upload.mockRejectedValue(new Error('network unavailable'));
    mocks.save.mockResolvedValue({ status: 'saved', emailChangePending: false });
    const user = await editName();
    await selectAvatar(user);
    await user.click(screen.getByRole('button', { name: 'Загрузить аватар' }));
    await screen.findByText(/Не удалось загрузить аватар/);
    await user.click(screen.getByRole('button', { name: 'Сохранить', exact: true }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });
});
