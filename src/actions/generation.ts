'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

export type GenerationActionState = { error?: string; jobId?: string };

function safeError(message: string) {
  if (message.includes('budget exhausted')) return 'msg.generation.budgetExhausted';
  if (message.includes('Personal daily generation limit')) return 'msg.generation.personalLimit';
  if (message.includes('media quota')) return 'msg.generation.quota';
  if (message.includes('forbidden') || message.includes('42501')) return 'msg.generation.forbidden';
  if (message.includes('Idempotency key conflict')) return 'msg.generation.keyConflict';
  return 'msg.generation.queueFailed';
}

export async function submitGeneration(_: GenerationActionState, form: FormData): Promise<GenerationActionState> {
  if (process.env.GENERATION_ENABLED !== 'true') return { error: 'msg.generation.disabled' };
  if (!process.env.HF_TOKEN?.startsWith('hf_')) return { error: 'msg.generation.notConfigured' };
  const projectId = String(form.get('projectId') ?? '');
  const requestId = String(form.get('requestId') ?? '');
  const prompt = String(form.get('prompt') ?? '').trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(projectId)
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)
    || prompt.length < 10 || prompt.length > 2000) return { error: 'msg.generation.checkInput' };
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return { error: 'msg.auth.sessionExpired' };
    const { data, error } = await supabase.rpc('create_generation_job', {
      target_project: projectId, request_key: requestId, generation_prompt: prompt,
    });
    if (error) return { error: safeError(`${error.message} ${error.code ?? ''}`) };
    const job = Array.isArray(data) ? data[0] : data;
    if (!job?.job_id) return { error: 'msg.generation.queueUnconfirmed' };
    revalidatePath('/create');
    revalidatePath(`/generations/${job.job_id}`);
    return { jobId: job.job_id };
  } catch {
    return { error: 'msg.generation.queueNetworkFailed' };
  }
}

export async function cancelGeneration(_: GenerationActionState, form: FormData): Promise<GenerationActionState> {
  const jobId = String(form.get('jobId') ?? '');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(jobId)) return { error: 'msg.generation.badId' };
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return { error: 'msg.auth.sessionExpired' };
    const { data, error } = await supabase.rpc('cancel_generation_job', { target_job: jobId });
    if (error) return { error: safeError(`${error.message} ${error.code ?? ''}`) };
    if (!Array.isArray(data) || !data.length) return { error: 'msg.generation.notFound' };
    revalidatePath(`/generations/${jobId}`);
    revalidatePath('/projects');
    return { jobId };
  } catch {
    return { error: 'msg.generation.cancelFailed' };
  }
}
