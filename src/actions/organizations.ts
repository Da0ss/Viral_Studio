'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export async function createOrganization(_: { error?: string }, form: FormData): Promise<{ error?: string }> {
  const parsed = z.string().trim().min(2).max(120).safeParse(form.get('name'));
  if (!parsed.success) return { error: 'Введите название от 2 до 120 символов.' };
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return { error: 'Сессия закончилась. Войдите снова.' };
    const { error } = await supabase.from('organizations').insert({ name: parsed.data, slug: `studio-${crypto.randomUUID()}`, created_by: user.id });
    if (error) return { error: 'Не удалось создать организацию. Попробуйте ещё раз.' };
  } catch {
    return { error: 'Не удалось создать организацию. Проверьте соединение.' };
  }
  revalidatePath('/', 'layout');
  redirect('/projects');
}
