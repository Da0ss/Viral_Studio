import { z } from 'zod';
import { createHash } from 'node:crypto';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getSupabasePublicConfig } from '@/lib/supabase/config';
import { createDeadlineFetch } from '@/lib/deadline-fetch';
import { hasMediaSignature, maxMediaBytes, type MediaMime } from '@/lib/media-file';

export const runtime = 'nodejs';
export const maxDuration = 120;
const reply = (error: string, status: number) => Response.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } });

async function downloadBounded(path: string): Promise<Uint8Array | null> {
  const { url } = getSupabasePublicConfig();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) throw new Error('Storage service is not configured');
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  const response = await createDeadlineFetch(60_000)(`${url}/storage/v1/object/authenticated/project-media/${encodedPath}`, {
    redirect: 'error',
    headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}` },
  });
  if (!response.ok || !response.body) return null;
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxMediaBytes) { await response.body.cancel(); return null; }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = []; let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxMediaBytes) { await reader.cancel(); return null; }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

export async function POST(request: Request, context: { params: Promise<{ projectId: string }> }) {
  if (request.headers.get('origin') !== new URL(request.url).origin) return reply('Запрос запрещён.', 403);
  const project = z.string().uuid().safeParse((await context.params).projectId);
  if (!project.success || Number(request.headers.get('content-length') ?? 0) > 16 * 1024) return reply('Некорректный запрос.', 400);
  try {
    const reader = request.body?.getReader();
    if (!reader) return reply('Некорректный запрос.', 400);
    const chunks: Uint8Array[] = []; let length = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 16 * 1024) { await reader.cancel(); return reply('Некорректный запрос.', 400); }
      chunks.push(value);
    }
    reader.releaseLock();
    const bodyBytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bodyBytes.set(chunk, offset); offset += chunk.byteLength; }
    const body = JSON.parse(new TextDecoder().decode(bodyBytes));
    const input = z.object({ intentId: z.string().uuid(), leaseToken: z.string().uuid() }).strict().safeParse(body);
    if (!input.success) return reply('Некорректный запрос.', 400);
    const supabase = await createClient({ requestTimeoutMs: 20_000 });
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return reply('Войдите снова.', 401);
    const { data: allowed, error: leaseError } = await supabase.rpc('assert_media_upload_lease', {
      target_intent: input.data.intentId, token: input.data.leaseToken,
    });
    if (leaseError || allowed !== true) return reply('Срок этой загрузки истёк.', 410);
    const admin = createAdminClient({ requestTimeoutMs: 60_000 });
    // The worker-facing service RPC constrains the intent/path; do not accept
    // a client-selected path or metadata at finalization time.
    const { data: metadata, error: metadataError } = await admin.rpc('get_media_upload_verification', {
      target_intent: input.data.intentId, token: input.data.leaseToken, target_project: project.data,
    });
    if (metadataError || !Array.isArray(metadata) || metadata.length !== 1) return reply('Не удалось проверить загрузку.', 502);
    const intent = metadata[0];
    if (typeof intent.object_path !== 'string' || typeof intent.mime_type !== 'string' || typeof intent.content_sha256 !== 'string' || !Number.isSafeInteger(Number(intent.size_bytes)) || Number(intent.size_bytes) < 1 || Number(intent.size_bytes) > maxMediaBytes) return reply('Не удалось проверить загрузку.', 502);
    const bytes = await downloadBounded(intent.object_path);
    if (!bytes || bytes.byteLength !== Number(intent.size_bytes) || bytes.byteLength > maxMediaBytes) return reply('Загруженный файл не совпадает с исходным файлом.', 422);
    const hash = createHash('sha256').update(bytes).digest('hex');
    if (hash !== intent.content_sha256 || !hasMediaSignature(bytes, intent.mime_type as MediaMime)) return reply('Содержимое файла не прошло проверку формата.', 422);
    const { data: assetId, error: finishError } = await admin.rpc('finish_media_upload', {
      target_intent: input.data.intentId, token: input.data.leaseToken, actual_hash: hash, actual_size: bytes.byteLength,
    });
    if (finishError || typeof assetId !== 'string') return Response.json({ status: 'pending' }, { status: 202, headers: { 'Cache-Control': 'no-store', 'Retry-After': '3' } });
    return Response.json({ id: assetId }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch { return reply('Не удалось подтвердить загрузку. Повторите попытку.', 502); }
}
