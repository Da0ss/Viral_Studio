import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ client: vi.fn(), getUser: vi.fn(), lookup: vi.fn(), advance: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.client }));
vi.mock('@/lib/generation-worker', () => ({ advanceGenerationJob: mocks.advance }));
import { POST } from '@/app/api/generations/[id]/advance/route';

const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const userId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const request = (origin: string | null = 'https://app.test') => new Request(`https://app.test/api/generations/${id}/advance`, {
  method: 'POST', headers: origin ? { Origin: origin } : {},
});
const call = (input = request(), target = id) => POST(input, { params: Promise.resolve({ id: target }) });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getUser.mockResolvedValue({ data: { user: { id: userId } }, error: null });
  mocks.lookup.mockResolvedValue({ data: { id, project_id: 'project', status: 'queued' }, error: null });
  mocks.advance.mockResolvedValue(true);
  mocks.client.mockResolvedValue({ auth: { getUser: mocks.getUser }, from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mocks.lookup }) }) }) });
});

it.each([null, 'https://attacker.test', 'null', 'invalid'])('rejects origin %s before creating an authenticated client', async (origin) => {
  const response = await call(request(origin));
  expect(response.status).toBe(403);
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(mocks.client).not.toHaveBeenCalled();
  expect(mocks.advance).not.toHaveBeenCalled();
});

it('does not trust forwarded headers to authorize a cross-origin request', async () => {
  const input = request('https://attacker.test');
  input.headers.set('x-forwarded-host', 'attacker.test');
  input.headers.set('x-forwarded-proto', 'https');
  expect((await call(input)).status).toBe(403);
  expect(mocks.advance).not.toHaveBeenCalled();
});

it('rejects malformed identifiers before authentication', async () => {
  expect((await call(request(), '../private')).status).toBe(404);
  expect(mocks.client).not.toHaveBeenCalled();
});

it('requires a verified Auth user before RLS lookup', async () => {
  mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
  expect((await call()).status).toBe(401);
  expect(mocks.lookup).not.toHaveBeenCalled();
  expect(mocks.advance).not.toHaveBeenCalled();
});

it.each([{ data: null, error: null }, { data: null, error: new Error('private policy details') }])('hides nonexistent and RLS-denied jobs identically', async (result) => {
  mocks.lookup.mockResolvedValue(result);
  const response = await call();
  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ error: 'Not found' });
  expect(mocks.advance).not.toHaveBeenCalled();
});

it('passes the server-authenticated identity, never request body claims, to the fenced worker', async () => {
  const response = await call(new Request(`https://app.test/api/generations/${id}/advance`, {
    method: 'POST', headers: { Origin: 'https://app.test', 'Content-Type': 'application/json' },
    body: JSON.stringify({ viewerId: 'attacker', status: 'completed' }),
  }));
  expect(response.status).toBe(202);
  expect(mocks.advance).toHaveBeenCalledWith(id, userId);
  expect(response.headers.get('cache-control')).toBe('private, no-store');
});

it('redacts worker failures and does not cache error responses', async () => {
  mocks.advance.mockRejectedValue(new Error('secret credential'));
  const response = await call();
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: 'Temporarily unavailable' });
  expect(response.headers.get('cache-control')).toBe('private, no-store');
});
