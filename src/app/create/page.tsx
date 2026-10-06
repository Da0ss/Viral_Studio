import { redirect } from 'next/navigation';
import { getGenerationProjects, getOrganizations } from '@/lib/projects';
import { GenerationForm } from '@/components/generation-form';
import { randomUUID } from 'node:crypto';
import { getCurrentProfile } from '@/lib/profile';
import { translate } from '@/lib/i18n/messages';

export default async function CreatePage() {
  if (!(await getOrganizations()).length) redirect('/onboarding');
  const [projects, profile] = await Promise.all([getGenerationProjects(), getCurrentProfile()]);
  const locale = profile?.language ?? 'ru';
  return <main className="page migration-page create-page"><small>{translate(locale, 'generation.eyebrow')}</small><h1>{translate(locale, 'generation.title')}</h1>
    <p className="subtitle">{translate(locale, 'generation.subtitle')}</p>
    <GenerationForm projects={projects} requestId={randomUUID()} enabled={process.env.GENERATION_ENABLED === 'true'} />
  </main>;
}
