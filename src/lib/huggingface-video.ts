import 'server-only';

import { createDeadlineFetch } from '@/lib/deadline-fetch';

// Live HF mapping verified 2026-10-06. Fixed parameters keep the price bounded;
// callers cannot select a different model, provider, resolution, or duration.
export const VIDEO_MODEL = 'Lightricks/LTX-Video-0.9.7-distilled';
export const VIDEO_PROVIDER = 'fal-ai';
export const VIDEO_COST_MICRO_USD = 50_000; // conservative reservation: $0.05
export const VIDEO_DAILY_BUDGET_MICRO_USD = 1_000_000;
const modelPath = '/fal-ai/ltx-video-13b-distilled';
const router = 'https://router.huggingface.co/fal-ai';
const maxBytes = 50 * 1024 * 1024;

export class VideoProviderError extends Error {
  constructor(public readonly code: 'unconfigured' | 'rejected' | 'uncertain' | 'invalid_result' | 'temporary') {
    super(`Video provider: ${code}`);
  }
}

function headers() {
  const token = process.env.HF_TOKEN;
  if (!token || !token.startsWith('hf_')) throw new VideoProviderError('unconfigured');
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

/** Store this path durably before polling. Never persist an arbitrary provider URL. */
export function validateVideoRequestPath(value: unknown): string {
  if (typeof value !== 'string' || !new RegExp(`^${modelPath}/requests/[A-Za-z0-9_-]{1,100}$`).test(value)) {
    throw new VideoProviderError('invalid_result');
  }
  return value;
}

async function json(response: Response, failure: 'uncertain' | 'temporary' = 'uncertain') {
  try { return await response.json(); }
  catch { throw new VideoProviderError(failure); }
}

/** A submission error may mean the provider accepted and charged the request.
 * Never automatically submit again after `uncertain`; retain the reservation. */
export async function submitVideo(prompt: string): Promise<string> {
  if (prompt.trim().length < 10 || prompt.length > 2000) throw new VideoProviderError('rejected');
  const auth = headers();
  let response: Response;
  try {
    response = await createDeadlineFetch(20_000)(`${router}${modelPath}?_subdomain=queue`, {
      method: 'POST', headers: auth, redirect: 'error',
      body: JSON.stringify({ prompt, num_frames: 81, num_inference_steps: 8, resolution: '480p', enable_safety_checker: true }),
    });
  } catch { throw new VideoProviderError('uncertain'); }
  if (!response.ok) {
    // Only explicit validation/auth rejection proves no accepted generation.
    throw new VideoProviderError([400, 401, 403, 422].includes(response.status) ? 'rejected' : 'uncertain');
  }
  const result = await json(response);
  try {
    const url = new URL(result.response_url);
    if (url.origin !== 'https://queue.fal.run' || url.search || url.hash) throw new Error('Invalid queue origin');
    const path = validateVideoRequestPath(url.pathname);
    if (path.split('/').at(-1) !== result.request_id) throw new Error('Invalid request identity');
    return path;
  } catch { throw new VideoProviderError('uncertain'); }
}

function queueUrl(path: string, suffix = '') {
  return `${router}${validateVideoRequestPath(path)}${suffix}?_subdomain=queue`;
}

export async function pollVideo(path: string): Promise<{ status: 'pending' } | { status: 'completed'; url: string }> {
  const auth = headers();
  const fetcher = createDeadlineFetch(20_000);
  let statusResponse: Response;
  try { statusResponse = await fetcher(queueUrl(path, '/status'), { headers: auth, redirect: 'error' }); }
  catch { throw new VideoProviderError('temporary'); }
  if (!statusResponse.ok) throw new VideoProviderError('temporary');
  const status = await json(statusResponse, 'temporary');
  if (status.status === 'IN_QUEUE' || status.status === 'IN_PROGRESS') return { status: 'pending' };
  if (status.status !== 'COMPLETED') throw new VideoProviderError('invalid_result');
  let response: Response;
  try { response = await fetcher(queueUrl(path), { headers: auth, redirect: 'error' }); }
  catch { throw new VideoProviderError('temporary'); }
  if (!response.ok) throw new VideoProviderError(response.status >= 500 ? 'temporary' : 'rejected');
  const result = await json(response, 'temporary');
  return { status: 'completed', url: validateVideoDownloadUrl(result?.video?.url) };
}

export function validateVideoDownloadUrl(value: unknown): string {
  if (typeof value !== 'string') throw new VideoProviderError('invalid_result');
  let url: URL;
  try { url = new URL(value); } catch { throw new VideoProviderError('invalid_result'); }
  const permitted = url.hostname === 'fal.media' || url.hostname.endsWith('.fal.media')
    || (url.hostname === 'storage.googleapis.com' && url.pathname.startsWith('/falserverless/'));
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !permitted) throw new VideoProviderError('invalid_result');
  return url.href;
}

/** Download bounded bytes for private Storage persistence; never expose the
 * provider's temporary result URL as the application's permanent output. */
export async function downloadVideo(url: string): Promise<Uint8Array> {
  const response = await createDeadlineFetch(30_000)(validateVideoDownloadUrl(url), { redirect: 'error' });
  if (!response.ok || !response.body) throw new VideoProviderError('temporary');
  const size = response.headers.get('content-length');
  if (size && (!/^\d+$/.test(size) || Number(size) > maxBytes)) throw new VideoProviderError('invalid_result');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new VideoProviderError('invalid_result');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => undefined); }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  // ISO base media signature, matching the upload validation contract.
  if (bytes.length < 12 || new TextDecoder().decode(bytes.slice(4, 8)) !== 'ftyp') throw new VideoProviderError('invalid_result');
  return bytes;
}

export async function cancelVideo(path: string): Promise<void> {
  const response = await createDeadlineFetch(20_000)(queueUrl(path, '/cancel'), {
    method: 'PUT', headers: headers(), redirect: 'error',
  });
  if (!response.ok) throw new VideoProviderError('temporary');
}
