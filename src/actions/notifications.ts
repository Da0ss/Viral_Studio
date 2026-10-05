'use server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

type State = { error?: string; success?: string };
export async function markNotificationRead(_: State, form: FormData): Promise<State> {
  const parsed = z.string().uuid().safeParse(form.get('notificationId'));
  if (!parsed.success) return { error: 'Некорректное уведомление.' };
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return { error: 'Войдите снова.' };
    // Browser controls only the id, never user_id, body or read_at.
    const { data, error } = await supabase.from('notifications').update({ read_at: new Date().toISOString() })
      .eq('id', parsed.data).eq('user_id', user.id).is('read_at', null).select('id').maybeSingle();
    if (error) return { error: 'Не удалось отметить уведомление.' };
    if (!data) {
      const { data: existing, error: readError } = await supabase.from('notifications').select('read_at')
        .eq('id', parsed.data).eq('user_id', user.id).maybeSingle();
      if (readError || !existing?.read_at) return { error: 'Уведомление недоступно. Обновите страницу.' };
    }
  } catch { return { error: 'Не удалось отметить уведомление. Попробуйте снова.' }; }
  revalidatePath('/notifications');
  return { success: 'Прочитано.' };
}
