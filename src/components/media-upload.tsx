'use client';
import { useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { mediaFormats, validateMediaMetadata, type MediaMetadataError } from '@/lib/media-file';
import { createClient } from '@/lib/supabase/browser';
import { useI18n } from '@/components/locale-provider';

const metadataErrors: Record<MediaMetadataError, 'media.emptyFile' | 'media.tooLarge' | 'media.unsupportedFormat'> = {
  empty: 'media.emptyFile', tooLarge: 'media.tooLarge', unsupportedFormat: 'media.unsupportedFormat',
};

export function MediaUpload({ projects, versionTarget }: { projects: { id: string; name: string }[]; versionTarget?: { assetId: string; projectId: string } }) {
  const { t } = useI18n();
  const router = useRouter();
  const busy = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  function clearRetryKey(key: string) {
    try { sessionStorage.removeItem(key); sessionStorage.removeItem(`${key}:pending`); } catch { /* Storage is optional. */ }
  }
  function completeUpload(form: HTMLFormElement, key: string) {
    clearRetryKey(key); form.reset();
    if (fileInput.current) fileInput.current.value = '';
    setMessage(t('media.success')); router.refresh();
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current) return;
    const element = event.currentTarget;
    const data = new FormData(element);
    const file = fileInput.current?.files?.[0];
    const project = String(data.get('project') ?? '');
    setError(''); setMessage('');
    if (!versionTarget && !projects.some(item => item.id === project)) { setError(t('media.selectProject')); return; }
    if (!(file instanceof File)) { setError(t('media.chooseFile')); return; }
    const invalid = validateMediaMetadata(file.size, file.type);
    if (invalid) { setError(t(metadataErrors[invalid])); return; }
    let fingerprint: string;
    try {
      const fileHash = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
      fingerprint = Array.from(new Uint8Array(fileHash), byte => byte.toString(16).padStart(2, '0')).join('');
    } catch { setError(t('media.readError')); return; }
    const retryKey = `media-upload:${project}:${versionTarget?.assetId ?? 'asset'}:${file.type}:${file.size}:${encodeURIComponent(file.name)}:${fingerprint}`;
    let idempotencyKey: string;
    try {
      idempotencyKey = sessionStorage.getItem(retryKey) ?? crypto.randomUUID();
      sessionStorage.setItem(retryKey, idempotencyKey);
    } catch { idempotencyKey = crypto.randomUUID(); }
    busy.current = true; setPending(true);
    try {
      let unresolved = false;
      try { unresolved = sessionStorage.getItem(`${retryKey}:pending`) === 'true'; } catch { /* Storage is optional. */ }
      if (unresolved) {
        const status = await fetch(`/api/projects/${project}/media`, { method: 'GET', headers: { 'Idempotency-Key': idempotencyKey, 'X-Content-SHA256': fingerprint } });
        if (status.status === 202) {
          // Safely replay the same signed capability and ask the finalizer to
          // resolve an upload whose earlier acknowledgement may have been lost.
          setMessage(t('media.checkingPrevious'));
        }
        if (status.status === 410 || status.status === 409) {
          clearRetryKey(retryKey);
          setError(status.status === 410 ? t('media.uploadExpired') : t('media.keyMismatch'));
          return;
        }
        if (!status.ok) { setError(t('media.checkStateError')); return; }
        const outcome = await status.json();
        if (outcome.status === 'completed') { completeUpload(element, retryKey); return; }
        try { sessionStorage.removeItem(`${retryKey}:pending`); } catch { /* Storage is optional. */ }
      }
      const response = await fetch(`/api/projects/${project}/media`, {
        method: 'POST', headers: { 'Idempotency-Key': idempotencyKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ sha256: fingerprint, mimeType: file.type, fileName: file.name.slice(0, 255), size: file.size, ...(versionTarget ? { targetAssetId: versionTarget.assetId } : {}) }),
      });
      if (response.status === 202) {
        try { sessionStorage.setItem(`${retryKey}:pending`, 'true'); } catch { /* Storage is optional. */ }
        setError(t('media.processing'));
        return;
      }
      if (!response.ok) {
        // Do not display arbitrary proxy/hosting errors or HTML responses.
        if ([409, 410].includes(response.status)) {
          clearRetryKey(retryKey);
        }
        setError(response.status === 401 ? t('media.loginAgain') : response.status === 403 ? t('media.forbidden') : response.status === 413 ? t('media.serverLimit') : response.status === 429 ? `${t('media.quota')} ${t('media.quotaDetails')}` : response.status === 410 ? t('media.uploadExpired') : t('media.uploadFailed'));
        return;
      }
      const intent = await response.json();
      if (response.status === 201 && typeof intent.id === 'string') { completeUpload(element, retryKey); return; }
      if (response.status !== 200 || typeof intent.intentId !== 'string' || typeof intent.path !== 'string' || typeof intent.token !== 'string' || typeof intent.leaseToken !== 'string') throw new Error('Unexpected response');
      setMessage(t('media.uploading'));
      try { await createClient().storage.from('project-media').uploadToSignedUrl(intent.path, intent.token, file, { contentType: file.type }); }
      catch { /* A lost/duplicate acknowledgement is resolved by server verification below. */ }
      const finalized = await fetch(`/api/projects/${project}/media/finalize`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intentId: intent.intentId, leaseToken: intent.leaseToken }),
      });
      if (finalized.status === 422) {
        clearRetryKey(retryKey); setError(t('media.verificationFailed')); return;
      }
      if (finalized.status === 202) {
        try { sessionStorage.setItem(`${retryKey}:pending`, 'true'); } catch { /* Storage is optional. */ }
        setMessage(t('media.received'));
        setError(t('media.retryCheck')); return;
      }
      const result = await finalized.json();
      if (finalized.status !== 201 || typeof result.id !== 'string') throw new Error('Unexpected finalization response');
      completeUpload(element, retryKey);
    } catch { setError(t('media.confirmError')); }
    finally { busy.current = false; setPending(false); }
  }
  if (!versionTarget && !projects.length) return <p>{t('media.noneAvailable')}</p>;
  return <form className="media-upload" onSubmit={submit} aria-label={t('media.formLabel')} aria-busy={pending}>
    <fieldset disabled={pending}><legend>{t('media.uploadTitle')}</legend>
      {versionTarget ? <input type="hidden" name="project" value={versionTarget.projectId} /> : <label>{t('media.projectLabel')}<select name="project" required defaultValue=""><option value="" disabled>{t('media.chooseProject')}</option>{projects.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>}
      <label>{t('media.fileLabel')}<input ref={fileInput} type="file" name="file" required accept={Object.keys(mediaFormats).join(',')} /></label>
      <p>{t('media.rules')}</p>
      <button type="submit" className="media-upload-submit" disabled={pending}>{pending ? t('media.uploadingLabel') : t('media.uploadTitle')}</button>
    </fieldset>
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
  </form>;
}
