import { updatePassword } from '@/actions/auth';
import { AuthForm } from '@/components/auth-form';
import { ProfileForm } from '@/components/profile-form';
import { getCurrentProfile } from '@/lib/profile';
import { redirect } from 'next/navigation';
import { translate } from '@/lib/i18n/messages';

export default async function ProfilePage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect('/login');
  const t = (key: Parameters<typeof translate>[1]) => translate(profile.language, key);
  const { avatarUrl, ...profileValues } = profile;
  return <main className="page migration-page profile-page"><small>{t('profile.eyebrow')}</small><h1>{t('profile.title')}</h1><p className="subtitle">{t('profile.subtitle')}</p><ProfileForm initialProfile={profileValues} initialAvatarUrl={avatarUrl} /><section className="password-section"><small>{t('profile.security')}</small><h2>{t('profile.changePassword')}</h2><p>{t('profile.passwordHelp')}</p><AuthForm action={updatePassword} submitLabel={t('profile.updatePassword')} mode="reset" /></section></main>;
}
