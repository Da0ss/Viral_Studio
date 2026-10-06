'use client';

import { useEffect, useRef, useState } from 'react';
import { uploadAvatar } from '@/actions/profile';
import { useI18n } from '@/components/locale-provider';

const maxAvatarBytes = 5 * 1024 * 1024;
const acceptedTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);

interface AvatarUploadProps { initialUrl: string | null; disabled?: boolean; acquireUpload?: () => boolean; releaseUpload?: () => void; onUploaded: (avatarPath: string, signedUrl: string | null) => void; }

export function AvatarUpload({ initialUrl, disabled = false, acquireUpload, releaseUpload, onUploaded }: AvatarUploadProps) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(initialUrl);
  const [file, setFile] = useState<File | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isUploading, setUploading] = useState(false);
  useEffect(() => () => { if (previewUrl?.startsWith('blob:')) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  const chooseFile = (selected: File | null) => {
    setMessage(null);
    if (disabled || isUploading) return;
    if (!selected) return;
    if (!acceptedTypes.has(selected.type)) { setMessage(t('avatar.typeError')); return; }
    if (selected.size > maxAvatarBytes) { setMessage(t('avatar.sizeError')); return; }
    if (previewUrl?.startsWith('blob:')) URL.revokeObjectURL(previewUrl);
    setFile(selected); setPreviewUrl(URL.createObjectURL(selected));
  };
  const clearSelection = () => { if (previewUrl?.startsWith('blob:')) URL.revokeObjectURL(previewUrl); setFile(null); setPreviewUrl(initialUrl); setMessage(null); if (inputRef.current) inputRef.current.value = ''; };
  const saveAvatar = async () => {
    if (!file || disabled || isUploading) return;
    if (acquireUpload && !acquireUpload()) return;
    setUploading(true); setMessage(null);
    const data = new FormData(); data.set('avatar', file);
    try {
    const result = await uploadAvatar(data);
    if (result.status === 'error') { setMessage(result.message); return; }
    if (previewUrl?.startsWith('blob:')) URL.revokeObjectURL(previewUrl);
    setFile(null); setPreviewUrl(result.signedUrl); onUploaded(result.avatarPath, result.signedUrl); setMessage(result.warning ?? t('avatar.saved'));
    if (inputRef.current) inputRef.current.value = '';
    } catch {
      setMessage(t('avatar.uploadError'));
    } finally {
      setUploading(false);
      releaseUpload?.();
    }
  };
  return <section className="avatar-upload" aria-label={t('avatar.label')} aria-busy={isUploading}><div className="avatar-upload__preview">{previewUrl ? <AvatarImage url={previewUrl} alt={t('avatar.preview')} /> : <i className="icon ph ph-user" />}</div><div className="avatar-upload__controls"><b>{t('avatar.label')}</b><p>{t('avatar.help')}</p><input ref={inputRef} type="file" aria-label={t('avatar.choose')} accept="image/jpeg,image/png,image/webp" onChange={(event) => chooseFile(event.target.files?.[0] ?? null)} disabled={disabled || isUploading} /><div>{file && <button type="button" className="ghost-button" onClick={clearSelection} disabled={disabled || isUploading}>{t('avatar.cancel')}</button>}{file && <button type="button" className="avatar-upload__save" onClick={saveAvatar} disabled={disabled || isUploading}>{isUploading ? t('avatar.uploading') : t('avatar.upload')}</button>}</div>{message && <small role="status">{message}</small>}</div></section>;
}

function AvatarImage({ url, alt }: { url: string; alt: string }) {
  // Signed and blob URLs are intentionally not routed through next/image.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt={alt} />;
}
