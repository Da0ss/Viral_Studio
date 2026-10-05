// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MediaUpload } from '@/components/media-upload';
const mocks = vi.hoisted(() => ({ refresh: vi.fn(), fetch: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
const id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
beforeEach(() => { vi.resetAllMocks(); vi.stubGlobal('fetch', mocks.fetch); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
async function prepare() {
  const user = userEvent.setup();
  render(<MediaUpload projects={[{ id, name: 'Campaign' }]} />);
  await user.selectOptions(screen.getByLabelText('Проект'), id);
  await user.upload(screen.getByLabelText('Файл материала'), new File(['bytes'], 'clip.mp4', { type: 'video/mp4' }));
  return user;
}
it('refreshes the library and clears file selection after confirmed success', async () => {
  mocks.fetch.mockResolvedValue({ ok: true, status: 201, json: async () => ({ id: 'asset' }) });
  await prepare();
  // jsdom does not implement native file-input constraint validation reliably.
  // Exercise the actual submit handler; browser validation needs real E2E.
  fireEvent.submit(screen.getByRole('form', { name: 'Загрузка материала' }));
  await screen.findByText('Материал загружен.');
  expect(mocks.refresh).toHaveBeenCalledTimes(1);
  expect((screen.getByLabelText('Файл материала') as HTMLInputElement).files?.length).toBe(0);
  expect(mocks.fetch.mock.calls[0][0]).toBe(`/api/projects/${id}/media`);
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
