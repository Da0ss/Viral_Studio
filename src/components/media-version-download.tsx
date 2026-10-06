'use client';
import { useActionState } from 'react';
import { prepareMediaVersionDownload } from '@/actions/media';
import { useI18n } from '@/components/locale-provider';

export function MediaVersionDownload({ id, number, size }: { id: string; number: number; size: number }) {
  const { t, locale } = useI18n();
  const [state, action, pending] = useActionState(prepareMediaVersionDownload, {});
  return <div>
    <form action={action}>
      <input type="hidden" name="versionId" value={id} />
      <button type="submit" className="ghost-button" disabled={pending}>{pending ? t('media.preparingDownload') : `${t('media.version')} ${number} · ${new Intl.NumberFormat(locale).format(size)} ${t('media.bytes')}`}</button>
      {!pending && state.url && <p><a href={state.url} rel="noreferrer">{t('media.downloadFile')}</a><small> {t('media.linkHelp')}</small></p>}
      {state.error && <p role="alert">{state.error}</p>}
    </form>
  </div>;
}
