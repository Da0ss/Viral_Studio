import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { GenerationStatus } from '@/components/generation-status';
import { MediaDownload } from '@/components/media-download';
import { createClient } from '@/lib/supabase/server';
import { getCurrentProfile } from '@/lib/profile';
import { translate } from '@/lib/i18n/messages';
import { videoModels } from '@/lib/video-models';

const legacyLtxModel = 'Lightricks/LTX-Video-0.9.7-distilled';
// Same shape as the media path check in src/actions/media.ts (a 'use server' file cannot export it).
const mediaPath = /^projects\/([0-9a-f-]{36})\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[a-zA-Z0-9][a-zA-Z0-9_-]{0,100}\.[a-z0-9]{1,8}$/;

export default async function GenerationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) notFound();
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) redirect(`/login?next=${encodeURIComponent(`/generations/${id}`)}`);
  const profile = await getCurrentProfile(user);
  const locale = profile?.language ?? 'ru';
  const { data: job, error } = await supabase.from('generation_jobs')
    .select('id,project_id,requested_by,status,dispatch_state,input,output,created_at,completed_at')
    .eq('id', id).maybeSingle();
  if (error || !job) notFound();
  // `model` may not be readable before the multi-model migration is applied; a failure only drops the label.
  const { data: modelRow } = await supabase.from('generation_jobs').select('model').eq('id', id).maybeSingle();
  const jobModel: unknown = modelRow?.model;
  const [{ data: membership }, { data: project }] = await Promise.all([
    supabase.from('project_members').select('role').eq('project_id', job.project_id).eq('user_id', user.id).maybeSingle(),
    supabase.from('projects').select('name').eq('id', job.project_id).maybeSingle(),
  ]);
  if (!membership) notFound();
  const prompt = typeof job.input?.prompt === 'string' ? job.input.prompt : '';
  const output = job.output && typeof job.output === 'object' ? job.output as { asset_id?: unknown } : null;
  const assetId = typeof output?.asset_id === 'string' ? output.asset_id : null;
  const modelId = jobModel === legacyLtxModel ? 'ltx' : jobModel;
  const modelName = typeof jobModel === 'string' ? (videoModels.find(item => item.id === modelId)?.name ?? jobModel) : null;
  let videoUrl: string | null = null;
  if (assetId && job.status === 'completed') {
    const { data: asset, error: assetError } = await supabase.from('assets').select('project_id, storage_path').eq('id', assetId).maybeSingle();
    if (assetError) console.error('[generation-page] asset lookup failed', { jobId: job.id });
    if (asset && asset.project_id === job.project_id && mediaPath.exec(asset.storage_path)?.[1] === asset.project_id) {
      const { data: signed, error: signError } = await supabase.storage.from('project-media').createSignedUrl(asset.storage_path, 600);
      if (signError) console.error('[generation-page] signing failed', { jobId: job.id });
      videoUrl = signed?.signedUrl ?? null;
    }
  }
  const canCancel = membership.role === 'owner' || membership.role === 'editor';
  return <main className="page migration-page">
    <p><Link href="/generations">← {translate(locale, 'generation.history')}</Link></p>
    <small>{translate(locale, 'generation.eyebrow')}</small><h1>{translate(locale, 'generation.title')}</h1>
    <p>{project?.name ?? translate(locale, 'generation.project')} · {new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(job.created_at))}{modelName && <> · {translate(locale, 'generation.model')}: {modelName}</>}</p>
    <section className="notification-card"><h2>{translate(locale, 'generation.prompt')}</h2><p>{prompt}</p></section>
    <GenerationStatus jobId={job.id} status={job.status} dispatchState={job.dispatch_state} canCancel={canCancel} />
    {assetId && <section className="notification-card"><h2>{translate(locale, 'generation.result')}</h2>{job.status === 'completed' && (videoUrl
      ? <video src={videoUrl} controls playsInline preload="metadata" aria-label={translate(locale, 'generation.videoLabel')} style={{ width: '100%', maxWidth: 760, aspectRatio: '16 / 9', background: '#000' }} />
      : <p role="status">{translate(locale, 'generation.videoUnavailable')}</p>)}
      <MediaDownload id={assetId} canDelete={canCancel} /></section>}
  </main>;
}
