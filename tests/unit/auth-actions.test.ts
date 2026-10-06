import { beforeEach, describe, expect, it, vi } from 'vitest';
import { login, register, requestPasswordReset, updatePassword } from '@/actions/auth';

const mocks = vi.hoisted(() => ({ client: vi.fn(), signUp: vi.fn(), signIn: vi.fn(), reset: vi.fn(), getUser: vi.fn(), update: vi.fn(), revalidate: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.client }));
vi.mock('@/lib/supabase/config', () => ({ getAppUrl: () => 'https://app.example.invalid' }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
vi.mock('next/navigation', () => ({ redirect: (path: string) => { throw new Error(`NEXT_REDIRECT:${path}`); } }));

function form(next: string) {
  const data = new FormData();
  data.set('email', 'invitee@example.invalid');
  data.set('password', 'safe-pass-123');
  data.set('next', next);
  return data;
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.client.mockResolvedValue({ auth: { signUp: mocks.signUp, signInWithPassword: mocks.signIn, resetPasswordForEmail: mocks.reset, getUser: mocks.getUser, updateUser: mocks.update } });
  mocks.signUp.mockResolvedValue({ data: { session: null }, error: null });
  mocks.signIn.mockResolvedValue({ error: null });
  mocks.reset.mockResolvedValue({ error: null });
  mocks.getUser.mockResolvedValue({ data: { user: { id: 'user' } }, error: null });
  mocks.update.mockResolvedValue({ error: null });
});

describe('Auth transport failures', () => {
  it.each([
    [login, 'signIn'], [register, 'signUp'], [updatePassword, 'getUser'], [updatePassword, 'update'],
  ] as const)('returns a safe error from %s when %s rejects', async (action, method) => {
    mocks[method].mockRejectedValue(new Error('private provider credential'));
    const result = await action({}, form('/projects'));
    expect(result.error).toBeTruthy();
    expect(JSON.stringify(result)).not.toContain('private provider credential');
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
  it('returns the same non-enumerating recovery response for a network failure', async () => {
    const success = await requestPasswordReset({}, form('/projects'));
    mocks.reset.mockRejectedValue(new Error('private transport detail'));
    expect(await requestPasswordReset({}, form('/projects'))).toEqual(success);
  });
  it('keeps successful login redirect outside error handling', async () => {
    await expect(login({}, form('/projects'))).rejects.toThrow('NEXT_REDIRECT:/projects');
    expect(mocks.revalidate).toHaveBeenCalledWith('/', 'layout');
  });
});

describe('registration destination', () => {
  it('preserves a safe invitation query through the email confirmation callback', async () => {
    const next = '/team/accept?token=abcdefghijklmnopqrstuvwxyzABCDEFG_0123456789';
    const result = await register({}, form(next));
    expect(result).toHaveProperty('success');
    const payload = mocks.signUp.mock.calls[0][0];
    const callback = new URL(payload.options.emailRedirectTo);
    expect(callback.pathname).toBe('/auth/callback');
    expect(callback.searchParams.get('next')).toBe(next);
  });

  it('uses the safe default when registration receives an external destination', async () => {
    await register({}, form('https://evil.example'));
    const callback = new URL(mocks.signUp.mock.calls[0][0].options.emailRedirectTo);
    expect(callback.searchParams.get('next')).toBe('/create');
  });

  it('redirects immediately to the preserved destination when signup returns a session', async () => {
    mocks.signUp.mockResolvedValue({ data: { session: { access_token: 'test' } }, error: null });
    await expect(register({}, form('/team/accept?token=abc'))).rejects.toThrow('NEXT_REDIRECT:/team/accept?token=abc');
  });
});
