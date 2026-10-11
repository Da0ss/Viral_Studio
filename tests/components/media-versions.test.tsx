// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { LocaleProvider } from '@/components/locale-provider';
import { MediaVersions } from '@/components/media-versions';

const mocks = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock('@/actions/media', () => ({ listMediaVersions: mocks.list, prepareMediaVersionDownload: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/lib/supabase/browser', () => ({ createClient: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });

function open(canUpload = false) {
  const view = render(<LocaleProvider locale="en"><MediaVersions assetId="asset" projectId="project" canUpload={canUpload} /></LocaleProvider>);
  const details = view.container.querySelector('details')!;
  details.open = true; fireEvent(details, new Event('toggle'));
  return view;
}

it('loads versions only when the history is opened', async () => {
  mocks.list.mockResolvedValue({ versions: [{ id: 'v2', version_number: 2, mime_type: 'image/png', size_bytes: 2048, created_at: '2026-10-02T10:00:00.000Z' }], hasMore: false });
  render(<LocaleProvider locale="en"><MediaVersions assetId="asset" projectId="project" canUpload={false} /></LocaleProvider>);
  expect(mocks.list).not.toHaveBeenCalled();
  cleanup();
  open();
  expect(screen.getByRole('status').textContent).toBe('Loading versions…');
  expect(await screen.findByText('Version 2', { exact: false, selector: 'b' })).toBeTruthy();
  expect(screen.getByRole('button', { name: /Version 2 · 2,048 bytes/ })).toBeTruthy();
  expect(mocks.list).toHaveBeenCalledWith('asset');
});

it('distinguishes an empty history from a failed request and can retry', async () => {
  mocks.list.mockResolvedValueOnce({ versions: [], hasMore: false, error: 'msg.media.versionsFailed' }).mockResolvedValueOnce({ versions: [], hasMore: false });
  open();
  expect((await screen.findByRole('alert')).textContent).toContain('Could not load versions');
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByText(/No new versions yet/)).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
});

it('offers a new version upload only to roles that may upload', async () => {
  mocks.list.mockResolvedValue({ versions: [], hasMore: false });
  open(false);
  await screen.findByText(/No new versions yet/);
  expect(screen.queryByRole('form', { name: 'Upload a new version' })).toBeNull();
  cleanup();
  open(true);
  await screen.findByText(/No new versions yet/);
  expect(screen.getByRole('form', { name: 'Upload a new version' })).toBeTruthy();
});
