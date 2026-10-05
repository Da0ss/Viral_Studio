import { redirect } from 'next/navigation';
import { OrganizationForm } from '@/components/organization-form';
import { getCurrentUser } from '@/lib/supabase/server';
import { getOrganizations } from '@/lib/projects';

export default async function OnboardingPage() {
  if (!await getCurrentUser()) redirect('/login?next=/onboarding');
  if ((await getOrganizations()).length) redirect('/projects');
  return <main className="page auth-page"><section><small>НАЧАЛО РАБОТЫ</small><h1>ВАША<br />КОМАНДА</h1><p className="subtitle">Создайте организацию, чтобы управлять проектами и работать вместе. Вы станете её владельцем.</p><OrganizationForm /></section></main>;
}
