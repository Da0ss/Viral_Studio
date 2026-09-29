'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { profileSchema, type ProfileActionResult, type ProfileValues } from '@/types/profile';

export async function updateProfile(input: ProfileValues): Promise<ProfileActionResult> {
  const parsed = profileSchema.safeParse(input);
  if (!parsed.success) {
    return { status: 'error', message: 'Проверьте поля формы.', fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const supabase = await createClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user?.email) return { status: 'error', message: 'Сессия закончилась. Войдите снова.' };

  const values = parsed.data;
  let emailChangePending = false;
  if (values.email !== user.email.toLowerCase()) {
    const { error } = await supabase.auth.updateUser({ email: values.email });
    if (error) return { status: 'error', message: 'Не удалось обновить email. Проверьте адрес и попробуйте снова.' };
    emailChangePending = true;
  }

  const { error } = await supabase.from('profiles').upsert({
    id: user.id,
    name: values.name,
    email: user.email.toLowerCase(),
    role: values.role,
    language: values.language,
    timezone: values.timezone,
    avatar_path: values.avatar_path || null,
    notification_email: values.notification_email,
    notification_browser: values.notification_browser,
    notification_marketing: values.notification_marketing,
  }, { onConflict: 'id' });

  if (error) return { status: 'error', message: 'Не удалось сохранить профиль. Попробуйте ещё раз.' };
  revalidatePath('/', 'layout');
  revalidatePath('/profile');
  return { status: 'saved', emailChangePending };
}
