import { afterEach, beforeEach, expect, test, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { authorizeScheduledWorker } from '@/lib/worker-authorization';
const secret = 'c'.repeat(64);
beforeEach(() => {
  vi.stubEnv('CRON_SECRET', secret);
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'different-admin-key');
  vi.stubEnv('HF_TOKEN', 'different-provider-key');
});
afterEach(() => vi.unstubAllEnvs());
const request = (authorization?: string) => new Request('https://app.test/api/internal/workers', { headers: authorization ? { authorization } : {} });
test.each([undefined, 'Bearer wrong', 'Basic ' + secret, 'x'.repeat(513)])('denies invalid scheduler authorization', header => {
  expect(authorizeScheduledWorker(request(header))).toBe(401);
});
test('accepts only the configured bearer scheduler secret', () => {
  expect(authorizeScheduledWorker(request(`Bearer ${secret}`))).toBe(200);
});
test.each(['', 'short', 'A'.repeat(64)])('fails closed on invalid scheduler configuration', value => {
  vi.stubEnv('CRON_SECRET', value);
  expect(authorizeScheduledWorker(request(`Bearer ${value}`))).toBe(503);
});
test.each(['SUPABASE_SERVICE_ROLE_KEY', 'HF_TOKEN'])('rejects privileged credential reuse', name => {
  vi.stubEnv(name, secret);
  expect(authorizeScheduledWorker(request(`Bearer ${secret}`))).toBe(503);
});
