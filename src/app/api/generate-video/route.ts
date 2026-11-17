import { NextResponse, after } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getOrganizationsResult } from '@/lib/projects';
import { hasTrustedOrigin } from '@/lib/request-origin';
import { advanceGenerationJob } from '@/lib/generation-worker';
import { safeError } from '@/lib/generation-errors';
import { videoModelIds, videoModels, videoPromptLimits } from '@/lib/video-models';

export const runtime = 'nodejs';
export const maxDuration = 120;

// Enqueue endpoint: creates a durable generation job (budget reservation + idempotency are enforced
// by the create_generation_job RPC under the caller's JWT) and returns immediately. The first worker
// step runs after the response; the status page / cron workers continue the job.
const headers = { 'Cache-Control': 'private, no-store' };
const fail = (error: string, status: number) => NextResponse.json({ error }, { status, headers });
const bodySchema = z.strictObject({
  prompt: z.string().trim().min(videoPromptLimits.min).max(videoPromptLimits.max),
  model: z.enum(videoModelIds),
  projectId: z.string().uuid(),
  requestId: z.string().uuid(),
});
const maxBodyChars = 8_000;

function statusFor(code: string) {
  if (code === 'msg.generation.budgetExhausted' || code === 'msg.generation.personalLimit' || code === 'msg.generation.quota') return 429;
  if (code === 'msg.generation.forbidden') return 403;
  if (code === 'msg.generation.keyConflict') return 409;
  if (code === 'msg.generation.modelUnavailable') return 400;
  return 502;
}

export async function POST(request: Request) {
  // Fail closed: both the shared generation flag and the multi-model flag must be on.
  if (process.env.GENERATION_ENABLED !== 'true' || process.env.GENERATION_MULTIMODEL_ENABLED !== 'true') {
    return fail('msg.generation.disabled', 503);
  }
  if (!hasTrustedOrigin(request)) return fail('msg.generation.forbidden', 403);

  try {
    const supabase = await createClient({ requestTimeoutMs: 8_000 });
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return fail('msg.auth.sessionExpired', 401);

    let raw: unknown;
    try {
      const text = await request.text();
      if (text.length > maxBodyChars) return fail('msg.generation.checkInput', 400);
      raw = JSON.parse(text);
    } catch { return fail('msg.generation.checkInput', 400); }
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) return fail('msg.generation.checkInput', 400);
    const { prompt, model, projectId, requestId } = parsed.data;

    const organizations = await getOrganizationsResult(user.id);
    if (organizations.error === 'unavailable') return fail('msg.generation.queueFailed', 503);
    if (organizations.error || !organizations.organizations.length) return fail('msg.generation.forbidden', 403);

    // The `priced` flag intentionally duplicates the DB catalog and fails closed: enabling a model via
    // set_generation_model_price also requires flipping `priced` in video-models.ts.
    if (!videoModels.find((entry) => entry.id === model)?.priced) return fail('msg.generation.modelUnavailable', 400);

    const { data, error } = await supabase.rpc('create_generation_job', {
      target_project: projectId, request_key: requestId, generation_prompt: prompt, model_key: model,
    });
    if (error) {
      const code = safeError(`${error.message} ${error.code ?? ''}`);
      console.error('[generate-video] enqueue failed', { model, code });
      return fail(code, statusFor(code));
    }
    const job = Array.isArray(data) ? data[0] : data;
    if (!job?.job_id) return fail('msg.generation.queueUnconfirmed', 502);
    const jobId = String(job.job_id);

    after(async () => {
      try {
        await advanceGenerationJob(jobId, user.id);
      } catch {
        console.error('[generate-video] background advance failed', { jobId, model });
      }
    });

    return NextResponse.json({
      jobId,
      status: typeof job.job_status === 'string' ? job.job_status : 'queued',
      reused: job.was_reused === true,
    }, { status: 202, headers });
  } catch {
    console.error('[generate-video] unexpected failure');
    return fail('msg.generation.queueFailed', 503);
  }
}
