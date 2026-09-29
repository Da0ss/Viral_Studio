import { updatePassword } from '@/actions/auth';
import { AuthForm } from '@/components/auth-form';
import { ProfileForm } from '@/components/profile-form';
import { getCurrentProfile } from '@/lib/profile';
import { redirect } from 'next/navigation';

export default async function ProfilePage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect('/login');
  return <main className="page migration-page profile-page"><small>АККАУНТ</small><h1>ПРОФИЛЬ</h1><p className="subtitle">Личные данные и настройки уведомлений.</p><ProfileForm initialProfile={profile} /><section className="password-section"><small>БЕЗОПАСНОСТЬ</small><h2>СМЕНИТЬ ПАРОЛЬ</h2><p>Не менее восьми символов. Пароль обрабатывает Supabase Auth и не сохраняется в профиле.</p><AuthForm action={updatePassword} submitLabel="Обновить пароль" mode="reset" /></section></main>;
}
