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
  | { status: 'uploaded'; avatarPath: string; signedUrl: string; warning?: string }
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

  const path = `avatars/${user.id}/${Date.now()}-${safeFileStem(file.name)}.${avatarExtension(file.type)}`;
  const { error: uploadError } = await supabase.storage.from('avatars').upload(path, fileBytes, { contentType: file.type, upsert: false });
  if (uploadError) return { status: 'error', message: 'Не удалось загрузить изображение. Попробуйте ещё раз.' };

  const { error: updateError } = await supabase.from('profiles').update({ avatar_path: path }).eq('id', user.id);
  if (updateError) {
    await supabase.storage.from('avatars').remove([path]);
    return { status: 'error', message: 'Не удалось сохранить аватар в профиле.' };
  }
  const { data: signed, error: signedError } = await supabase.storage.from('avatars').createSignedUrl(path, 60 * 60);
  const oldPath = profile.avatar_path;
  const { error: removeError } = oldPath && oldPath !== path ? await supabase.storage.from('avatars').remove([oldPath]) : { error: null };
  revalidatePath('/', 'layout');
  revalidatePath('/profile');
  if (signedError || !signed?.signedUrl) return { status: 'error', message: 'Аватар сохранён, но не удалось подготовить предпросмотр. Перезагрузите страницу.' };
  return { status: 'uploaded', avatarPath: path, signedUrl: signed.signedUrl, warning: removeError ? 'Новый аватар сохранён, но старый файл будет удалён позже.' : undefined };
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
