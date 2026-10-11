import { afterEach, expect, it, vi } from 'vitest';
import { hasTrustedOrigin } from '@/lib/request-origin';

afterEach(() => vi.unstubAllEnvs());

function request(origin?: string, url = 'http://localhost:3000/api/media') {
  return new Request(url, { method: 'POST', headers: origin === undefined ? {} : { Origin: origin } });
}

it('accepts the public HTTPS origin even when Next reconstructs an internal HTTP request URL', () => {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.example.test');
  expect(hasTrustedOrigin(request('https://app.example.test'))).toBe(true);
  expect(hasTrustedOrigin(request('http://localhost:3000'))).toBe(false);
});

it.each([undefined, 'null', 'invalid', 'https://attacker.example.test', 'https://app.example.test/'])(
  'rejects missing, opaque, malformed and cross-site Origin %s', origin => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.example.test');
    expect(hasTrustedOrigin(request(origin))).toBe(false);
  },
);

it('does not trust forwarded headers to change the expected origin', () => {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.example.test');
  const input = request('https://attacker.example.test');
  input.headers.set('x-forwarded-host', 'attacker.example.test');
  input.headers.set('x-forwarded-proto', 'https');
  expect(hasTrustedOrigin(input)).toBe(false);
});

it.each([undefined, 'http://app.example.test', 'https://app.example.test/path'])(
  'fails closed in production when the app origin is absent or invalid: %s', configured => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', configured);
    expect(hasTrustedOrigin(request('https://app.example.test'))).toBe(false);
  },
);

it('uses the request URL only when no app origin is configured outside production', () => {
  vi.stubEnv('NODE_ENV', 'development');
  vi.stubEnv('NEXT_PUBLIC_APP_URL', undefined);
  expect(hasTrustedOrigin(request('http://localhost:3000'))).toBe(true);
  expect(hasTrustedOrigin(request('https://app.example.test'))).toBe(false);
});
