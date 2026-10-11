import { redirect } from 'next/navigation';
import { OrganizationForm } from '@/components/organization-form';
import { getCurrentUser } from '@/lib/supabase/server';
import { getOrganizations } from '@/lib/projects';
import { getServerTranslator } from '@/lib/i18n/server';

export default async function OnboardingPage() {
  if (!await getCurrentUser()) redirect('/login?next=/onboarding');
  if ((await getOrganizations()).length) redirect('/projects');
  const { t } = await getServerTranslator();
  return <main className="page auth-page"><section><small>{t('onboarding.eyebrow')}</small><h1>{t('onboarding.titleLine1')}<br />{t('onboarding.titleLine2')}</h1><p className="subtitle">{t('onboarding.subtitle')}</p><OrganizationForm /></section></main>;
}
