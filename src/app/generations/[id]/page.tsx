import { notFound, redirect } from 'next/navigation';
import { GenerationStatus } from '@/components/generation-status';
import { MediaDownload } from '@/components/media-download';
import { createClient } from '@/lib/supabase/server';
import { getCurrentProfile } from '@/lib/profile';
import { translate } from '@/lib/i18n/messages';

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
  const [{ data: membership }, { data: project }] = await Promise.all([
    supabase.from('project_members').select('role').eq('project_id', job.project_id).eq('user_id', user.id).maybeSingle(),
    supabase.from('projects').select('name').eq('id', job.project_id).maybeSingle(),
  ]);
  if (!membership) notFound();
  const prompt = typeof job.input?.prompt === 'string' ? job.input.prompt : '';
  const output = job.output && typeof job.output === 'object' ? job.output as { asset_id?: unknown } : null;
  const assetId = typeof output?.asset_id === 'string' ? output.asset_id : null;
  const canCancel = membership.role === 'owner' || membership.role === 'editor';
  return <main className="page migration-page">
    <small>{translate(locale, 'generation.eyebrow')}</small><h1>{translate(locale, 'generation.title')}</h1>
    <p>{project?.name ?? translate(locale, 'generation.project')} · {new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(job.created_at))}</p>
    <section className="notification-card"><h2>{translate(locale, 'generation.prompt')}</h2><p>{prompt}</p></section>
    <GenerationStatus jobId={job.id} status={job.status} dispatchState={job.dispatch_state} canCancel={canCancel} />
    {assetId && <section className="notification-card"><h2>Результат</h2><MediaDownload id={assetId} canDelete={canCancel} /></section>}
  </main>;
}
