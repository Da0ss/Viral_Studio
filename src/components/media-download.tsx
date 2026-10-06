'use client';
import { useActionState } from 'react';
import { deleteMedia, prepareMediaDownload } from '@/actions/media';
import { useI18n } from '@/components/locale-provider';

export function MediaDownload({ id, canDelete }: { id: string; canDelete: boolean }) {
  const { t } = useI18n();
  const [state, action, pending] = useActionState(prepareMediaDownload, {});
  const [deleteState, deleteAction, deletePending] = useActionState(deleteMedia, {});
  return <div>
    <form action={action}>
      <input type="hidden" name="assetId" value={id} />
      <button type="submit" className="ghost-button" disabled={pending}>{pending ? t('media.preparingDownload') : state.url ? t('media.refreshLink') : t('media.prepareDownload')}</button>
      {!pending && state.url && <p><a href={state.url} rel="noreferrer">{t('media.downloadFile')}</a><small> {t('media.linkHelp')}</small></p>}
      {state.error && <p role="alert">{state.error}</p>}
    </form>
    {canDelete && <form action={deleteAction} onSubmit={event => { if (!window.confirm(t('media.deleteConfirm'))) event.preventDefault(); }}>
      <input type="hidden" name="assetId" value={id} />
      <input type="hidden" name="confirmation" value="delete" />
      <button type="submit" className="text-button danger" disabled={deletePending}>{deletePending ? t('media.deleting') : t('media.deleteMaterial')}</button>
      {deleteState.error && <p role="alert">{deleteState.error}</p>}
      {deleteState.success && <p role="status">{deleteState.success}</p>}
    </form>}
  </div>;
}
