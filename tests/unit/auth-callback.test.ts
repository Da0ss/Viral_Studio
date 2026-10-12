import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { createClient, exchange } = vi.hoisted(() => ({ createClient: vi.fn(), exchange: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient }));
import { GET } from '@/app/auth/callback/route';

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.test');
  createClient.mockResolvedValue({ auth: { exchangeCodeForSession: exchange } });
  exchange.mockResolvedValue({ error: null });
});
afterEach(() => vi.unstubAllEnvs());

test('callback keeps a safe internal destination', async () => {
  const result = await GET(new NextRequest('https://app.test/auth/callback?code=temporary&next=%2Fprojects%3Fstatus%3Dactive'));
  expect(result.headers.get('location')).toBe('https://app.test/projects?status=active');
});

test('callback preserves the team invitation token after email confirmation', async () => {
  const next = '/team/accept?token=abcdefghijklmnopqrstuvwxyzABCDEFG_0123456789';
  const result = await GET(new NextRequest(`https://app.test/auth/callback?code=temporary&${new URLSearchParams({ next })}`));
  expect(result.headers.get('location')).toBe(`https://app.test${next}`);
});

test('recovery callback redirects to the configured origin so its session cookie remains in scope', async () => {
  const result = await GET(new NextRequest('http://localhost:3001/auth/callback?code=temporary&next=%2Freset-password'));
  expect(result.headers.get('location')).toBe('https://app.test/reset-password');
});

test('callback rejects an external destination', async () => {
  const result = await GET(new NextRequest('https://app.test/auth/callback?code=temporary&next=https://evil.test'));
  expect(new URL(result.headers.get('location')!).origin).toBe('https://app.test');
});

test.each(['configuration', 'network'])('callback safely redirects after %s failure', async kind => {
  if (kind === 'configuration') createClient.mockRejectedValue(new Error('sensitive configuration'));
  else exchange.mockRejectedValue(new Error('sensitive provider response'));
  const result = await GET(new NextRequest('https://app.test/auth/callback?code=temporary'));
  expect(result.headers.get('location')).toBe('https://app.test/login?error=callback');
});

test('callback fails closed when the production public origin is missing', async () => {
  vi.stubEnv('NEXT_PUBLIC_APP_URL', undefined);
  const result = await GET(new NextRequest('http://attacker.test/auth/callback?code=temporary'));
  expect(result.status).toBe(503);
  expect(result.headers.get('location')).toBeNull();
});
