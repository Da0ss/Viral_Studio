// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MediaUpload } from '@/components/media-upload';
import { LocaleProvider } from '@/components/locale-provider';
const mocks = vi.hoisted(() => ({ refresh: vi.fn(), fetch: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
const storage = vi.hoisted(() => ({ upload: vi.fn() }));
vi.mock('@/lib/supabase/browser', () => ({ createClient: () => ({ storage: { from: () => ({ uploadToSignedUrl: storage.upload }) } }) }));
const id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
beforeEach(() => { vi.resetAllMocks(); vi.stubGlobal('fetch', mocks.fetch); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
async function prepare() {
  const user = userEvent.setup();
  render(<LocaleProvider locale="ru"><MediaUpload projects={[{ id, name: 'Campaign' }]} /></LocaleProvider>);
  await user.selectOptions(screen.getByLabelText('Проект'), id);
  await user.upload(screen.getByLabelText('Файл материала'), new File(['bytes'], 'clip.mp4', { type: 'video/mp4' }));
  return user;
}
it.each([
  ['ru', 'Загрузка материала', 'Проект', 'Файл материала', 'Формат файла не поддерживается.'],
  ['en', 'Media upload', 'Project', 'Media file', 'File format is not supported.'],
  ['kk', 'Медиа жүктеу', 'Жоба', 'Медиа файлы', 'Файл пішіміне қолдау көрсетілмейді.'],
] as const)('localizes upload labels and metadata validation in %s', async (locale, formLabel, projectLabel, fileLabel, errorText) => {
  const user = userEvent.setup();
  render(<LocaleProvider locale={locale}><MediaUpload projects={[{ id, name: 'Campaign' }]} /></LocaleProvider>);
  expect(screen.getByRole('form', { name: formLabel })).toBeTruthy();
  await user.selectOptions(screen.getByLabelText(projectLabel), id);
  const file = new File(['plain text'], 'notes.txt', { type: 'text/plain' });
  fireEvent.change(screen.getByLabelText(fileLabel), { target: { files: [file] } });
  fireEvent.submit(screen.getByRole('form', { name: formLabel }));
  expect((await screen.findByRole('alert')).textContent).toBe(errorText);
});
it('refreshes the library and clears file selection after confirmed success', async () => {
  mocks.fetch
    .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ intentId: '12121212-1212-4212-8212-121212121212', leaseToken: '13131313-1313-4313-8313-131313131313', path: `projects/${id}/12121212-1212-4212-8212-121212121212/video.mp4`, token: 'signed' }) })
    .mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ id: 'asset' }) });
  storage.upload.mockResolvedValue({ data: {}, error: null });
  await prepare();
  // jsdom does not implement native file-input constraint validation reliably.
  // Exercise the actual submit handler; browser validation needs real E2E.
  fireEvent.submit(screen.getByRole('form', { name: 'Загрузка материала' }));
  await screen.findByText('Файл успешно загружен.');
  expect(mocks.refresh).toHaveBeenCalledTimes(1);
  expect((screen.getByLabelText('Файл материала') as HTMLInputElement).files?.length).toBe(0);
  expect(mocks.fetch).toHaveBeenCalledTimes(2);
  expect(mocks.fetch.mock.calls[0][0]).toBe(`/api/projects/${id}/media`);
  expect(storage.upload).toHaveBeenCalledTimes(1);
});
it('retains file selection and redacts unsuccessful response details', async () => {
  mocks.fetch.mockResolvedValue({ ok: false, status: 502, json: async () => ({ error: 'SQL secret stack' }) });
  await prepare();
  fireEvent.submit(screen.getByRole('form', { name: 'Загрузка материала' }));
  await screen.findByRole('alert');
  expect(screen.getByRole('alert').textContent).not.toContain('SQL');
  expect((screen.getByLabelText('Файл материала') as HTMLInputElement).files?.length).toBe(1);
  await waitFor(() => expect((screen.getByRole('button', { name: 'Загрузить материал' }) as HTMLButtonElement).disabled).toBe(false));
  expect(mocks.refresh).not.toHaveBeenCalled();
});
