import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ createClient: vi.fn(), transport: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: mocks.createClient }));
vi.mock('@/lib/supabase/config', () => ({ getSupabasePublicConfig: () => ({ url: 'https://storage.example.test', anonKey: 'public-key' }) }));
import { createUploadClient } from '@/lib/supabase/upload';

function capturedFetch(): typeof fetch {
  const call = mocks.createClient.mock.calls.at(-1) as unknown as [string, string, { global: { fetch: typeof fetch } }];
  return call[2].global.fetch;
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.transport.mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', mocks.transport);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('uses public configuration with a fresh client and no persisted auth session', () => {
  createUploadClient();
  createUploadClient();
  expect(mocks.createClient).toHaveBeenCalledTimes(2);
  expect(mocks.createClient).toHaveBeenCalledWith('https://storage.example.test', 'public-key', {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: { fetch: expect.any(Function) },
  });
  expect(mocks.createClient.mock.calls[0][2].global.fetch).not.toBe(capturedFetch());
});

it('passes through a caller cancellation signal', async () => {
  const timeout = new AbortController();
  vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeout.signal);
  createUploadClient();
  const caller = new AbortController();
  await capturedFetch()('https://storage.example.test/object', { signal: caller.signal });
  const signal = mocks.transport.mock.calls[0][1].signal as AbortSignal;
  expect(AbortSignal.timeout).toHaveBeenCalledWith(120_000);
  expect(signal.aborted).toBe(false);
  caller.abort();
  expect(signal.aborted).toBe(true);
});

it('honors a Request signal as well as the deadline', async () => {
  const timeout = new AbortController();
  vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeout.signal);
  createUploadClient();
  const caller = new AbortController();
  await capturedFetch()(new Request('https://storage.example.test/object', { signal: caller.signal }));
  const signal = mocks.transport.mock.calls[0][1].signal as AbortSignal;
  caller.abort();
  expect(signal.aborted).toBe(true);

  await capturedFetch()('https://storage.example.test/object');
  const deadlineSignal = mocks.transport.mock.calls[1][1].signal as AbortSignal;
  timeout.abort();
  expect(deadlineSignal.aborted).toBe(true);
});
