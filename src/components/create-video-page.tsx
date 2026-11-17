'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Route } from 'next';
import { useI18n } from '@/components/locale-provider';
import { isMessageKey } from '@/lib/i18n/messages';
import { videoModels, videoPromptLimits, type VideoModelId } from '@/lib/video-models';

interface EnqueueResponse { jobId?: unknown; error?: unknown }

const pricedModels = videoModels.filter(model => model.priced);
const fieldStyle = { width: '100%', boxSizing: 'border-box', border: '1px solid var(--line)', background: 'transparent', color: 'var(--ink)', font: 'inherit', padding: 11 } as const;

export default function CreateVideoPage({ projects }: { projects: { id: string; name: string }[] }) {
  const { t, tm } = useI18n();
  const router = useRouter();
  const [model, setModel] = useState<VideoModelId | ''>(pricedModels[0]?.id ?? '');
  const [projectId, setProjectId] = useState<string>(projects[0]?.id ?? '');
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One idempotency key per (prompt, model, project); a retry of the same request reuses it.
  const request = useRef<{ signature: string; id: string } | null>(null);

  if (!projects.length) return <main className="page migration-page"><small>{t('generation.eyebrow')}</small><h1>{t('generation.createTitle')}</h1><p role="status">{tm('msg.generation.noProject')}</p></main>;
  if (!pricedModels.length) return <main className="page migration-page"><small>{t('generation.eyebrow')}</small><h1>{t('generation.createTitle')}</h1><p role="status">{t('generation.noModels')}</p></main>;

  async function handleGenerate(event: React.FormEvent) {
    event.preventDefault();
    if (loading) return;
    const text = prompt.trim();
    if (!model || !projectId || text.length < videoPromptLimits.min || text.length > videoPromptLimits.max) {
      setError(tm('msg.generation.checkInput'));
      return;
    }
    const signature = JSON.stringify([text, model, projectId]);
    if (request.current?.signature !== signature) request.current = { signature, id: crypto.randomUUID() };

    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/generate-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: text, model, projectId, requestId: request.current.id }),
      });
      const data: EnqueueResponse = await res.json().catch(() => ({}));
      if (res.status === 202 && typeof data.jobId === 'string') {
        router.push(`/generations/${data.jobId}` as Route);
        return;
      }
      // The server only returns msg.* keys; anything else falls back to a generic message.
      setError(tm(typeof data.error === 'string' && isMessageKey(data.error) ? data.error : 'msg.generation.queueFailed'));
    } catch {
      setError(tm('msg.generation.queueNetworkFailed'));
    }
    setLoading(false);
  }

  return <main className="page migration-page">
    <small>{t('generation.eyebrow')}</small>
    <h1>{t('generation.createTitle')}</h1>
    <p className="subtitle">{t('generation.createSubtitle')}</p>
    <form onSubmit={handleGenerate} aria-busy={loading} style={{ display: 'grid', gap: 20, maxWidth: 760, marginTop: 28 }}>
      <label className="profile-field">{t('generation.project')}
        <select style={fieldStyle} value={projectId} onChange={event => setProjectId(event.target.value)} disabled={loading}>
          {projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
        </select>
      </label>
      <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: 10 }}>
        <legend style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 10 }}>{t('generation.modelPicker')}</legend>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          {pricedModels.map(item => <button key={item.id} type="button" className="ghost-button" aria-pressed={model === item.id} disabled={loading}
            onClick={() => setModel(item.id)}
            style={{ minHeight: 44, display: 'flex', gap: 8, alignItems: 'center', ...(model === item.id ? { background: 'var(--lime)', boxShadow: '2px 2px 0 var(--ink)' } : {}) }}>
            <span>{item.name}</span><small>{item.badge}</small><small style={{ color: 'var(--muted)' }}>{item.cost}</small>
          </button>)}
        </div>
      </fieldset>
      <label className="profile-field">{t('generation.prompt')}
        <textarea aria-describedby="create-prompt-count" rows={5} maxLength={videoPromptLimits.max} value={prompt} disabled={loading} style={{ ...fieldStyle, resize: 'vertical' }}
          onChange={event => setPrompt(event.target.value)} placeholder={t('generation.promptPlaceholder')} />
      </label>
      <small id="create-prompt-count" style={{ color: 'var(--muted)', marginTop: -14 }}>{t('generation.promptCount', { count: prompt.trim().length, max: videoPromptLimits.max })}</small>
      <p>{t('generation.costNotice')}</p>
      {error && <p className="auth-message error" role="alert">{error}</p>}
      <button className="cta" type="submit" disabled={loading || !prompt.trim()}><span>{loading ? t('generation.submitting') : t('generation.submit')}</span></button>
    </form>
  </main>;
}
