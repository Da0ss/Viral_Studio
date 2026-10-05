'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { profileSchema, type ProfileActionResult, type ProfileValues } from '@/types/profile';

const avatarMimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
const maxAvatarBytes = 5 * 1024 * 1024;

function avatarExtension(mimeType: string) { return mimeType === 'image/jpeg' ? 'jpg' : mimeType === 'image/png' ? 'png' : 'webp'; }
function safeFileStem(fileName: string) {
  const stem = fileName.normalize('NFKD').replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
  return stem.slice(0, 80) || 'avatar';
}
function isImageSignature(bytes: Uint8Array, mimeType: string) {
  if (mimeType === 'image/jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mimeType === 'image/png') return bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  return bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
}

export type AvatarUploadResult =
  | { status: 'uploaded'; avatarPath: string; signedUrl: string | null; warning?: string }
  | { status: 'error'; message: string };

export async function uploadAvatar(formData: FormData): Promise<AvatarUploadResult> {
  const file = formData.get('avatar');
  if (!(file instanceof File) || file.size === 0) return { status: 'error', message: 'Выберите изображение.' };
  if (!avatarMimeTypes.has(file.type)) return { status: 'error', message: 'Поддерживаются только JPG, PNG и WebP.' };
  if (file.size > maxAvatarBytes) return { status: 'error', message: 'Размер файла не должен превышать 5 МБ.' };
  const fileBytes = new Uint8Array(await file.arrayBuffer());
  if (!isImageSignature(fileBytes, file.type)) return { status: 'error', message: 'Содержимое файла не соответствует типу изображения.' };

  const supabase = await createClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) return { status: 'error', message: 'Сессия закончилась. Войдите снова.' };
  const { data: profile, error: profileError } = await supabase.from('profiles').select('avatar_path').eq('id', user.id).maybeSingle();
  if (profileError || !profile) return { status: 'error', message: 'Сначала сохраните основные данные профиля.' };

  const path = `avatars/${user.id}/${crypto.randomUUID()}-${safeFileStem(file.name)}.${avatarExtension(file.type)}`;
  const { error: uploadError } = await supabase.storage.from('avatars').upload(path, fileBytes, { contentType: file.type, upsert: false });
  if (uploadError) return { status: 'error', message: 'Не удалось загрузить изображение. Попробуйте ещё раз.' };

  let update = supabase.from('profiles').update({ avatar_path: path }).eq('id', user.id);
  update = profile.avatar_path === null ? update.is('avatar_path', null) : update.eq('avatar_path', profile.avatar_path);
  const { data: updated, error: updateError } = await update.select('id').maybeSingle();
  if (updateError || !updated) {
    await supabase.storage.from('avatars').remove([path]);
    return { status: 'error', message: 'Не удалось сохранить аватар. Возможно, профиль изменён в другой вкладке. Обновите страницу и попробуйте снова.' };
  }
  // Persistence has succeeded. Preview and cleanup failures must not invite a
  // duplicate upload or leave the form's saved avatar baseline stale.
  let signedUrl: string | null = null;
  const warnings: string[] = [];
  try {
    const { data: signed, error: signedError } = await supabase.storage.from('avatars').createSignedUrl(path, 60 * 60);
    if (!signedError && signed?.signedUrl) signedUrl = signed.signedUrl;
  } catch { /* Treat transport failure like a missing preview. */ }
  if (!signedUrl) warnings.push('Аватар сохранён, но предпросмотр недоступен. Перезагрузите страницу.');
  const oldPath = profile.avatar_path;
  if (oldPath && oldPath !== path) {
    try {
      const { error } = await supabase.storage.from('avatars').remove([oldPath]);
      if (error) warnings.push('Старый файл не удалось удалить. Автоматическая повторная очистка пока недоступна.');
    } catch {
      warnings.push('Старый файл не удалось удалить. Автоматическая повторная очистка пока недоступна.');
    }
  }
  revalidatePath('/', 'layout');
  revalidatePath('/profile');
  return { status: 'uploaded', avatarPath: path, signedUrl, warning: warnings.join(' ') || undefined };
}

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

  const { data: updated, error } = await supabase.from('profiles').update({
    name: values.name,
    email: user.email.toLowerCase(),
    role: values.role,
    language: values.language,
    timezone: values.timezone,
    notification_email: values.notification_email,
    notification_browser: values.notification_browser,
    notification_marketing: values.notification_marketing,
  }).eq('id', user.id).select('id').maybeSingle();

  if (error || !updated) return { status: 'error', message: 'Не удалось сохранить профиль. Попробуйте ещё раз.' };
  revalidatePath('/', 'layout');
  revalidatePath('/profile');
  return { status: 'saved', emailChangePending };
}
