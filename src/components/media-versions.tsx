'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { listMediaVersions, type MediaVersion } from '@/actions/media';
import { MediaUpload } from '@/components/media-upload';
import { MediaVersionDownload } from '@/components/media-version-download';
import { useI18n } from '@/components/locale-provider';

type VersionsResult = { versions: MediaVersion[]; hasMore: boolean; error: boolean };

export function MediaVersions({ assetId, projectId, canUpload }: { assetId: string; projectId: string; canUpload: boolean }) {
  const { locale, t } = useI18n();
  const [open, setOpen] = useState(false);
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ key: number; value: VersionsResult } | null>(null);
  const request = useRef(0);
  const current = result?.key === revision ? result.value : null;
  const retry = useCallback(() => setRevision(value => value + 1), []);
  useEffect(() => {
    if (!open) return;
    const version = ++request.current; let cancelled = false;
    void listMediaVersions(assetId)
      .then(response => ({ versions: response.versions, hasMore: response.hasMore, error: Boolean(response.error) }))
      .catch(() => ({ versions: [], hasMore: false, error: true }))
      .then(value => { if (!cancelled && request.current === version) setResult({ key: revision, value }); });
    return () => { cancelled = true; };
  }, [open, assetId, revision]);
  const date = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });
  return <details className="media-versions" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>{t('media.versions')}</summary>
    {open && !current && <p role="status">{t('media.versionsLoading')}</p>}
    {current?.error && <div className="team-load-error" role="alert"><p>{t('msg.media.versionsFailed')}</p><button type="button" className="ghost-button" onClick={retry}>{t('common.retry')}</button></div>}
    {current && !current.error && (current.versions.length
      ? <ol className="media-versions__list">{current.versions.map(item => <li key={item.id}>
          <span><b>{t('media.version')} {item.version_number}</b> · <time dateTime={item.created_at}>{date.format(new Date(item.created_at))}</time></span>
          <MediaVersionDownload id={item.id} number={item.version_number} size={item.size_bytes} />
        </li>)}</ol>
      : <p>{t('media.noVersions')}</p>)}
    {current?.hasMore && <p><small>{t('media.versionsTruncated')}</small></p>}
    {canUpload && <MediaUpload projects={[]} versionTarget={{ assetId, projectId }} onUploaded={retry} />}
  </details>;
}
