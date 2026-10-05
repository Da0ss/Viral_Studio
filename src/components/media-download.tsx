'use client';
import { useActionState } from 'react';
import { prepareMediaDownload } from '@/actions/media';

export function MediaDownload({ id }: { id: string }) {
  const [state, action, pending] = useActionState(prepareMediaDownload, {});
  return <form action={action}>
    <input type="hidden" name="assetId" value={id} />
    <button type="submit" className="ghost-button" disabled={pending}>{pending ? 'Подготавливаем…' : state.url ? 'Обновить ссылку' : 'Подготовить скачивание'}</button>
    {!pending && state.url && <p><a href={state.url} rel="noreferrer">Скачать файл</a><small> Ссылка действует 60 секунд. Не передавайте её другим людям.</small></p>}
    {state.error && <p role="alert">{state.error}</p>}
  </form>;
}
