'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { Route } from 'next';
import { createClient } from '@/lib/supabase/server';
import { getAppUrl } from '@/lib/supabase/config';
import { safeInternalPath } from '@/lib/auth/redirect';
import type { AuthState } from '@/lib/auth/types';

const configurationMessage = 'msg.auth.notConfigured';

async function getAuthClient() {
  try {
    return await createClient();
  } catch {
    return null;
  }
}

function credentials(formData: FormData) {
  const email = String(formData.get('email') || '').trim().toLowerCase();
  const password = String(formData.get('password') || '');
  if (!/^\S+@\S+\.\S+$/.test(email)) return { error: 'msg.auth.invalidEmail' };
  if (password.length < 8) return { error: 'msg.auth.passwordTooShort' };
  return { email, password };
}

function nextPath(formData: FormData): Route {
  return safeInternalPath(formData.get('next')) as Route;
}

export async function login(_: AuthState, formData: FormData): Promise<AuthState> {
  const input = credentials(formData);
  if ('error' in input) return input;
  const supabase = await getAuthClient();
  if (!supabase) return { error: configurationMessage };
  try {
    const { error } = await supabase.auth.signInWithPassword(input);
    if (error) return { error: 'msg.auth.invalidCredentials' };
  } catch { return { error: 'msg.auth.loginNetworkFailed' }; }
  revalidatePath('/', 'layout');
  redirect(nextPath(formData));
}

export async function register(_: AuthState, formData: FormData): Promise<AuthState> {
  const input = credentials(formData);
  if ('error' in input) return input;
  const next = nextPath(formData);
  const supabase = await getAuthClient();
  if (!supabase) return { error: configurationMessage };
  try {
    const callbackUrl = new URL('/auth/callback', getAppUrl());
    callbackUrl.searchParams.set('next', next);
    const { data, error } = await supabase.auth.signUp({
      ...input,
      options: { emailRedirectTo: callbackUrl.toString() },
    });
    if (error) return { error: 'msg.auth.registerFailed' };
    if (!data.session) return { success: 'msg.auth.confirmEmail' };
  } catch { return { error: 'msg.auth.registerNetworkFailed' }; }
  revalidatePath('/', 'layout');
  redirect(next);
}

export async function requestPasswordReset(_: AuthState, formData: FormData): Promise<AuthState> {
  const email = String(formData.get('email') || '').trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) return { error: 'msg.auth.invalidEmail' };
  const supabase = await getAuthClient();
  if (!supabase) return { error: configurationMessage };
  try {
    await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${getAppUrl()}/auth/callback?next=/reset-password` });
  } catch { /* Preserve the same non-enumerating response for transport failures. */ }
  return { success: 'msg.auth.resetSent' };
}

export async function updatePassword(_: AuthState, formData: FormData): Promise<AuthState> {
  const password = String(formData.get('password') || '');
  if (password.length < 8) return { error: 'msg.auth.passwordTooShort' };
  const supabase = await getAuthClient();
  if (!supabase) return { error: configurationMessage };
  try {
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return { error: 'msg.auth.resetSessionExpired' };
    const { error } = await supabase.auth.updateUser({ password });
    if (error) return { error: 'msg.auth.passwordFailed' };
    return { success: 'msg.auth.passwordUpdated' };
  } catch { return { error: 'msg.auth.passwordNetworkFailed' }; }
}

export async function logout() {
  const supabase = await getAuthClient();
  if (supabase) await supabase.auth.signOut();
  revalidatePath('/', 'layout');
  redirect('/login');
}
