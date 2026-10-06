'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

export type GenerationActionState = { error?: string; jobId?: string };

function safeError(message: string) {
  if (message.includes('budget exhausted')) return 'Достигнут дневной лимит генераций. Попробуйте завтра.';
  if (message.includes('Personal daily generation limit')) return 'Вы достигли личного дневного лимита генераций.';
  if (message.includes('media quota')) return 'В проекте недостаточно места для результата. Освободите место в медиатеке.';
  if (message.includes('forbidden') || message.includes('42501')) return 'Для генерации нужна роль owner или editor в проекте.';
  if (message.includes('Idempotency key conflict')) return 'Ключ этой заявки уже использован. Обновите страницу и повторите запрос.';
  return 'Не удалось поставить генерацию в очередь. Попробуйте ещё раз.';
}

export async function submitGeneration(_: GenerationActionState, form: FormData): Promise<GenerationActionState> {
  if (process.env.GENERATION_ENABLED !== 'true') return { error: 'Генерация сейчас отключена.' };
  if (!process.env.HF_TOKEN?.startsWith('hf_')) return { error: 'Сервис генерации не настроен.' };
  const projectId = String(form.get('projectId') ?? '');
  const requestId = String(form.get('requestId') ?? '');
  const prompt = String(form.get('prompt') ?? '').trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(projectId)
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)
    || prompt.length < 10 || prompt.length > 2000) return { error: 'Проверьте проект и описание (от 10 до 2000 символов).' };
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return { error: 'Сессия закончилась. Войдите снова.' };
    const { data, error } = await supabase.rpc('create_generation_job', {
      target_project: projectId, request_key: requestId, generation_prompt: prompt,
    });
    if (error) return { error: safeError(`${error.message} ${error.code ?? ''}`) };
    const job = Array.isArray(data) ? data[0] : data;
    if (!job?.job_id) return { error: 'Не удалось подтвердить постановку генерации в очередь.' };
    revalidatePath('/create');
    revalidatePath(`/generations/${job.job_id}`);
    return { jobId: job.job_id };
  } catch {
    return { error: 'Не удалось поставить генерацию в очередь. Проверьте соединение.' };
  }
}

export async function cancelGeneration(_: GenerationActionState, form: FormData): Promise<GenerationActionState> {
  const jobId = String(form.get('jobId') ?? '');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(jobId)) return { error: 'Некорректный номер генерации.' };
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return { error: 'Сессия закончилась. Войдите снова.' };
    const { data, error } = await supabase.rpc('cancel_generation_job', { target_job: jobId });
    if (error) return { error: safeError(`${error.message} ${error.code ?? ''}`) };
    if (!Array.isArray(data) || !data.length) return { error: 'Генерация не найдена или недоступна.' };
    revalidatePath(`/generations/${jobId}`);
    revalidatePath('/projects');
    return { jobId };
  } catch {
    return { error: 'Не удалось отправить запрос на остановку. Обновите страницу.' };
  }
}
