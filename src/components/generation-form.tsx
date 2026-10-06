'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { submitGeneration } from '@/actions/generation';
import { useI18n } from '@/components/locale-provider';

export function GenerationForm({ projects, requestId, enabled }: {
  projects: { id: string; name: string }[];
  requestId: string;
  enabled: boolean;
}) {
  const { t } = useI18n();
  const [state, action, pending] = useActionState(submitGeneration, {});
  if (!enabled) return <p role="status">{t('generation.disabled')}</p>;
  if (state.jobId) return <section role="status"><p>{t('generation.queuedNotice')}</p><Link className="cta" href={`/generations/${state.jobId}`}><span>{t('generation.open')}</span></Link></section>;
  if (!projects.length) return <p>{t('generation.noWritableProjects')}</p>;
  return <form className="generation-form" action={action} aria-busy={pending}>
    <label>{t('generation.project')}<select name="projectId" defaultValue="" required disabled={pending}>
      <option value="" disabled>{t('generation.selectProject')}</option>
      {projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
    </select></label>
    <label>{t('generation.prompt')}<textarea name="prompt" minLength={10} maxLength={2000} required disabled={pending} rows={5}
      placeholder={t('generation.promptPlaceholder')} /></label>
    <input type="hidden" name="requestId" value={requestId} />
    <p>{t('generation.costNotice')}</p>
    {state.error && <p role="alert">{state.error}</p>}
    <button className="cta" type="submit" disabled={pending}><span>{pending ? t('generation.submitting') : t('generation.submit')}</span></button>
  </form>;
}
