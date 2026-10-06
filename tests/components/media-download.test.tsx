// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocaleProvider } from '@/components/locale-provider';
import { MediaDownload } from '@/components/media-download';

vi.mock('@/actions/media', () => ({ deleteMedia: vi.fn(), prepareMediaDownload: vi.fn() }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it.each([
  ['ru', 'Подготовить скачивание', 'Удалить материал', 'Удалить этот материал? Файл будет удалён после безопасной фоновой очистки.'],
  ['en', 'Prepare download', 'Delete media', 'Delete this media item? The file will be removed by safe background cleanup.'],
  ['kk', 'Жүктеуді дайындау', 'Материалды жою', 'Бұл материалды жоясыз ба? Файл қауіпсіз фондық тазалау арқылы өшіріледі.'],
] as const)('localizes media download and delete UI in %s', (locale, prepareLabel, deleteLabel, confirmText) => {
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  render(<LocaleProvider locale={locale}><MediaDownload id="asset" canDelete /></LocaleProvider>);
  expect(screen.getByRole('button', { name: prepareLabel })).toBeTruthy();
  expect(screen.getByRole('button', { name: deleteLabel })).toBeTruthy();
  fireEvent.submit(document.querySelectorAll('form')[1]!);
  expect(confirm).toHaveBeenCalledWith(confirmText);
});
