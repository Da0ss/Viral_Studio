import { afterEach, expect, it, vi } from 'vitest';
import { getAppUrl } from '@/lib/supabase/config';

afterEach(() => vi.unstubAllEnvs());
it('does not silently send production auth callbacks to localhost', () => {
  vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('NEXT_PUBLIC_APP_URL', undefined);
  expect(getAppUrl).toThrow('Application origin is not configured.');
});
it('retains a local development default', () => {
  vi.stubEnv('NODE_ENV', 'development'); vi.stubEnv('NEXT_PUBLIC_APP_URL', undefined);
  expect(getAppUrl()).toBe('http://localhost:3000');
});
it.each(['https://app.test', 'http://localhost:3001', 'http://127.0.0.1:3001', 'http://[::1]:3001'])('accepts the explicit origin %s', origin => {
  vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('NEXT_PUBLIC_APP_URL', `${origin}/`);
  expect(getAppUrl()).toBe(origin);
});
it.each(['http://app.test', 'javascript:alert(1)', 'https://user:password@app.test', 'https://app.test/callback', 'https://app.test?secret=test', 'https://app.test#fragment'])('rejects unsafe or ambiguous auth callback base %s', origin => {
  vi.stubEnv('NEXT_PUBLIC_APP_URL', origin);
  expect(getAppUrl).toThrow();
});
