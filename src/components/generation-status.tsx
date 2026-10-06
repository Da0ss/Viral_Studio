'use client';

import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { cancelGeneration } from '@/actions/generation';
import { useI18n } from '@/components/locale-provider';

export function GenerationStatus({ jobId, status, dispatchState, canCancel }: {
  jobId: string;
  status: string;
  dispatchState: string;
  canCancel: boolean;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [state, action, pending] = useActionState(cancelGeneration, {});
  const [connectionError, setConnectionError] = useState(false);
  useEffect(() => {
    if (status !== 'queued' && status !== 'running') return;
    let stopped = false;
    let inFlight = false;
    let controller: AbortController | undefined;
    const advance = async () => {
      if (stopped || inFlight) return;
      inFlight = true;
      controller = new AbortController();
      const timeout = window.setTimeout(() => controller?.abort(), 30_000);
      try {
        const response = await fetch(`/api/generations/${jobId}/advance`, { method: 'POST', cache: 'no-store', signal: controller.signal });
        if (!stopped) {
          setConnectionError(!response.ok);
          if (response.ok) router.refresh();
        }
      } catch {
        if (!stopped) setConnectionError(true);
      } finally { window.clearTimeout(timeout); inFlight = false; }
    };
    void advance();
    const timer = window.setInterval(() => { void advance(); }, 15_000);
    return () => { stopped = true; controller?.abort(); window.clearInterval(timer); };
  }, [jobId, router, status]);

  const isActive = status === 'queued' || status === 'running';
  const uncertain = dispatchState === 'uncertain';
  const statusKey = status === 'completed' ? 'succeeded' : status;
  const label = ['queued', 'running', 'succeeded', 'failed', 'cancelled'].includes(statusKey)
    ? t(`generation.status.${statusKey}` as 'generation.status.queued') : t('generation.statusUnknown');
  return <section className="generation-status" aria-live="polite">
    <p><strong>{label}</strong></p>
    {connectionError && isActive && <p role="alert">{t('generation.error')}</p>}
    {uncertain && <p role="alert">{t('generation.uncertainNotice')}</p>}
    {status === 'failed' && <p role="alert">{t('generation.status.unknownError')}</p>}
    {status === 'running' && !uncertain && <p>{t('generation.runningNotice')}</p>}
    {canCancel && isActive && !uncertain && <form action={action}>
      <input type="hidden" name="jobId" value={jobId} />
      <button className="ghost-button" type="submit" disabled={pending}>{pending ? t('generation.submitting') : t('generation.cancel')}</button>
      {state.error && <p role="alert">{state.error}</p>}
      {state.jobId && <p role="status">{t('generation.cancelRequestedNotice')}</p>}
    </form>}
  </section>;
}
