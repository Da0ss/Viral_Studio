import type { User } from '@supabase/supabase-js';
import { createClient, getCurrentUser } from '@/lib/supabase/server';
import type { ProfileValues } from '@/types/profile';

const fallbackProfile = (email: string): ProfileValues => ({
  name: '',
  email,
  role: '',
  language: 'ru',
  timezone: 'Asia/Qyzylorda',
  avatar_path: '',
  notification_email: true,
  notification_browser: true,
  notification_marketing: false,
});

export async function getCurrentProfile(user?: User | null): Promise<ProfileValues | null> {
  const currentUser = user === undefined ? await getCurrentUser() : user;
  if (!currentUser?.email) return null;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('profiles')
    .select('name, email, role, language, timezone, avatar_path, notification_email, notification_browser, notification_marketing')
    .eq('id', currentUser.id)
    .maybeSingle();

  if (error || !data) return fallbackProfile(currentUser.email);
  return {
    name: data.name,
    email: data.email,
    role: data.role,
    language: data.language as ProfileValues['language'],
    timezone: data.timezone as ProfileValues['timezone'],
    avatar_path: data.avatar_path ?? '',
    notification_email: data.notification_email,
    notification_browser: data.notification_browser,
    notification_marketing: data.notification_marketing,
  };
}
