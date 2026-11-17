import 'server-only';

import { createDeadlineFetch } from '@/lib/deadline-fetch';
import { VideoProviderError, validateVideoDownloadUrl } from '@/lib/huggingface-video';

export type FalModelKey = 'ltx' | 'minimax' | 'kling' | 'seedance';

interface FalModel {
  endpoint: string;
  /** Path prefix of the queue `response_url`. Fal's status/result/cancel URLs use only the
   * first two segments (owner/app) of the endpoint id. Must equal private.generation_models. */
  requestPathPrefix: string;
  payload: (prompt: string) => Record<string, unknown>;
}

// Endpoints verified against fal.ai docs. Wan and Hunyuan are intentionally absent.
export const falModels: Record<FalModelKey, FalModel> = {
  ltx: {
    endpoint: 'fal-ai/ltx-video', requestPathPrefix: '/fal-ai/ltx-video',
    payload: (prompt) => ({ prompt, negative_prompt: 'low quality, blurry, deformed, distorted' }),
  },
  minimax: { endpoint: 'fal-ai/minimax/video-01', requestPathPrefix: '/fal-ai/minimax', payload: (prompt) => ({ prompt }) },
  kling: {
    endpoint: 'fal-ai/kling-video/v3/standard/text-to-video', requestPathPrefix: '/fal-ai/kling-video',
    payload: (prompt) => ({ prompt, duration: '5', aspect_ratio: '16:9' }),
  },
  seedance: {
    endpoint: 'bytedance/seedance-2.0/text-to-video', requestPathPrefix: '/bytedance/seedance-2.0',
    payload: (prompt) => ({ prompt, duration: '5', resolution: '720p', generate_audio: true }),
  },
};

const queueOrigin = 'https://queue.fal.run';
const requestTimeoutMs = 20_000;
const requestIdPattern = /^[A-Za-z0-9_-]{1,100}$/;
const requestPathPattern = /^(\/[A-Za-z0-9][A-Za-z0-9._-]*){2,4}\/requests\/[A-Za-z0-9_-]{1,100}$/;

export const falConfigured = () => Boolean(process.env.FAL_KEY?.trim());

export const isFalModelKey = (value: string): value is FalModelKey => Object.hasOwn(falModels, value);

/** Same host policy as the HF pipeline (fal.media / falserverless bucket, https only). */
export function safeFalMediaUrl(value: unknown): string | null {
  try { return validateVideoDownloadUrl(value); } catch { return null; }
}

/** Only durable, well-formed queue paths are ever fetched; optionally pinned to the model's prefix. */
export function validateFalRequestPath(value: unknown, modelKey?: FalModelKey): string {
  if (typeof value !== 'string' || !requestPathPattern.test(value)) throw new VideoProviderError('invalid_result');
  if (modelKey && !value.startsWith(`${falModels[modelKey].requestPathPrefix}/requests/`)) throw new VideoProviderError('invalid_result');
  return value;
}

function authorization(): string {
  const key = process.env.FAL_KEY?.trim();
  if (!key) throw new VideoProviderError('unconfigured');
  return `Key ${key}`;
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await response.json();
    return body && typeof body === 'object' ? body as Record<string, unknown> : {};
  } catch { return {}; }
}

/**
 * Submits to the Fal queue. After a possible acceptance every failure is `uncertain`
 * (never resubmit); only explicit 400/401/403/422 proves nothing was accepted.
 */
export async function submitFalVideo(modelKey: string, prompt: string, deadlineAt?: number, jobId?: string): Promise<{ requestPath: string; requestId: string }> {
  if (!isFalModelKey(modelKey)) throw new VideoProviderError('rejected');
  if (prompt.trim().length < 1 || prompt.length > 2000) throw new VideoProviderError('rejected');
  const auth = authorization();
  const model = falModels[modelKey];
  let response: Response;
  try {
    response = await createDeadlineFetch(requestTimeoutMs, globalThis.fetch, deadlineAt)(`${queueOrigin}/${model.endpoint}`, {
      method: 'POST', redirect: 'error',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify(model.payload(prompt)),
    });
  } catch { throw new VideoProviderError('uncertain'); }
  // 429 is a rate-limit refusal before any request is created, so it is safe to close without charge.
  if (!response.ok) throw new VideoProviderError([400, 401, 403, 422, 429].includes(response.status) ? 'rejected' : 'uncertain');
  const queued = await readJson(response);
  const requestId = queued.request_id;
  if (typeof requestId !== 'string' || !requestIdPattern.test(requestId)) throw new VideoProviderError('uncertain');
  try {
    if (typeof queued.response_url !== 'string') throw new Error('missing response_url');
    const url = new URL(queued.response_url);
    if (url.origin !== queueOrigin || url.search || url.hash || url.username || url.password) throw new Error('bad origin');
    // The provider-chosen path must be exactly <catalog prefix>/requests/<request_id>.
    if (url.pathname !== `${model.requestPathPrefix}/requests/${requestId}`) throw new Error('bad path');
    return { requestPath: validateFalRequestPath(url.pathname, modelKey), requestId };
  } catch {
    // Accepted by Fal but unverifiable: record the request id for the uncertain-generation runbook.
    console.warn(JSON.stringify({ event: 'generation.submit_unverified', jobId: jobId ?? null, model: modelKey, requestId }));
    throw new VideoProviderError('uncertain');
  }
}

export async function pollFalVideo(modelKey: string, requestPath: string, deadlineAt?: number): Promise<{ status: 'pending' } | { status: 'completed'; url: string }> {
  if (!isFalModelKey(modelKey)) throw new VideoProviderError('invalid_result');
  const path = validateFalRequestPath(requestPath, modelKey);
  const auth = authorization();
  const fetcher = createDeadlineFetch(requestTimeoutMs, globalThis.fetch, deadlineAt);
  let statusResponse: Response;
  try { statusResponse = await fetcher(`${queueOrigin}${path}/status`, { headers: { Authorization: auth }, redirect: 'error' }); }
  catch { throw new VideoProviderError('temporary'); }
  if (!statusResponse.ok) throw new VideoProviderError(statusResponse.status >= 500 || statusResponse.status === 429 ? 'temporary' : 'invalid_result');
  const status = await readJson(statusResponse);
  if (status.status === 'IN_QUEUE' || status.status === 'IN_PROGRESS') return { status: 'pending' };
  if (status.status !== 'COMPLETED') throw new VideoProviderError('invalid_result');
  let response: Response;
  try { response = await fetcher(`${queueOrigin}${path}`, { headers: { Authorization: auth }, redirect: 'error' }); }
  catch { throw new VideoProviderError('temporary'); }
  if (!response.ok) throw new VideoProviderError(response.status >= 500 || response.status === 429 ? 'temporary' : 'rejected');
  const result = await readJson(response);
  const video = result.video as { url?: unknown } | undefined;
  const videos = result.videos as { url?: unknown }[] | undefined;
  const url = safeFalMediaUrl(video?.url ?? videos?.[0]?.url);
  if (!url) throw new VideoProviderError('invalid_result');
  return { status: 'completed', url };
}

export async function cancelFalVideo(modelKey: string, requestPath: string, deadlineAt?: number): Promise<void> {
  if (!isFalModelKey(modelKey)) throw new VideoProviderError('invalid_result');
  const path = validateFalRequestPath(requestPath, modelKey);
  const auth = authorization();
  let response: Response;
  try {
    response = await createDeadlineFetch(requestTimeoutMs, globalThis.fetch, deadlineAt)(`${queueOrigin}${path}/cancel`, {
      method: 'PUT', headers: { Authorization: auth }, redirect: 'error',
    });
  } catch { throw new VideoProviderError('temporary'); }
  if (!response.ok) throw new VideoProviderError('temporary');
}
