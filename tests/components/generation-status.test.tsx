// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { LocaleProvider } from '@/components/locale-provider';
import { GenerationStatus } from '@/components/generation-status';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
vi.mock('@/actions/generation', () => ({ cancelGeneration: vi.fn() }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
const view = () => render(<LocaleProvider locale="en"><GenerationStatus jobId="job" status="running" dispatchState="accepted" canCancel={false} /></LocaleProvider>);

it.each(['network', 'http'])('handles %s polling failure without an unhandled rejection or refresh', async (failure) => {
  vi.stubGlobal('fetch', failure === 'network' ? vi.fn().mockRejectedValue(new Error('private detail')) : vi.fn().mockResolvedValue({ ok: false }));
  view();
  await waitFor(() => expect(screen.getByRole('alert').textContent).toBeTruthy());
  expect(screen.queryByText('private detail')).toBeNull();
  expect(refresh).not.toHaveBeenCalled();
});

it('aborts an in-flight request when unmounted', () => {
  let signal: AbortSignal | undefined;
  vi.stubGlobal('fetch', vi.fn((_url, options) => { signal = options.signal; return new Promise(() => {}); }));
  const rendered = view();
  expect(signal?.aborted).toBe(false);
  rendered.unmount();
  expect(signal?.aborted).toBe(true);
});
