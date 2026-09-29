'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { Route } from 'next';
import { createClient } from '@/lib/supabase/server';
import { getAppUrl } from '@/lib/supabase/config';
import type { AuthState } from '@/lib/auth/types';

const configurationMessage = 'Supabase Auth не настроен. Добавьте ключи в .env.local.';

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
  if (!/^\S+@\S+\.\S+$/.test(email)) return { error: 'Введите корректный email.' };
  if (password.length < 8) return { error: 'Пароль должен содержать не менее 8 символов.' };
  return { email, password };
}

function nextPath(formData: FormData): Route {
  const next = String(formData.get('next') || '/create');
  return (next.startsWith('/') && !next.startsWith('//') ? next : '/create') as Route;
}

export async function login(_: AuthState, formData: FormData): Promise<AuthState> {
  const input = credentials(formData);
  if ('error' in input) return input;
  const supabase = await getAuthClient();
  if (!supabase) return { error: configurationMessage };
  const { error } = await supabase.auth.signInWithPassword(input);
  if (error) return { error: 'Email или пароль указаны неверно.' };
  revalidatePath('/', 'layout');
  redirect(nextPath(formData));
}

export async function register(_: AuthState, formData: FormData): Promise<AuthState> {
  const input = credentials(formData);
  if ('error' in input) return input;
  const supabase = await getAuthClient();
  if (!supabase) return { error: configurationMessage };
  const { data, error } = await supabase.auth.signUp({
    ...input,
    options: { emailRedirectTo: `${getAppUrl()}/auth/callback?next=/create` },
  });
  if (error) return { error: 'Не удалось зарегистрироваться. Проверьте данные и попробуйте снова.' };
  if (!data.session) return { success: 'Проверьте почту и подтвердите адрес, чтобы войти.' };
  revalidatePath('/', 'layout');
  redirect('/create');
}

export async function requestPasswordReset(_: AuthState, formData: FormData): Promise<AuthState> {
  const email = String(formData.get('email') || '').trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) return { error: 'Введите корректный email.' };
  const supabase = await getAuthClient();
  if (!supabase) return { error: configurationMessage };
  await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${getAppUrl()}/auth/callback?next=/reset-password` });
  return { success: 'Если аккаунт существует, письмо для восстановления уже отправлено.' };
}

export async function updatePassword(_: AuthState, formData: FormData): Promise<AuthState> {
  const password = String(formData.get('password') || '');
  if (password.length < 8) return { error: 'Пароль должен содержать не менее 8 символов.' };
  const supabase = await getAuthClient();
  if (!supabase) return { error: configurationMessage };
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: 'Не удалось обновить пароль. Откройте ссылку из письма ещё раз.' };
  return { success: 'Пароль обновлён. Теперь можно продолжить работу.' };
}

export async function logout() {
  const supabase = await getAuthClient();
  if (supabase) await supabase.auth.signOut();
  revalidatePath('/', 'layout');
  redirect('/login');
}
