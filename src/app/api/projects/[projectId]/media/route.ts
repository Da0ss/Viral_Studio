import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { maxMediaBytes, validateMediaMetadata } from '@/lib/media-file';

export const runtime = 'nodejs';
export const maxDuration = 120;
const maxBodyBytes = 16 * 1024;
const reply = (error: string, status: number) => Response.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } });

export async function GET(request: Request, context: { params: Promise<{ projectId: string }> }) {
  const project = z.string().uuid().safeParse((await context.params).projectId);
  const requestKey = z.string().uuid().safeParse(request.headers.get('idempotency-key'));
  const hash = z.string().regex(/^[0-9a-f]{64}$/).safeParse(request.headers.get('x-content-sha256'));
  if (!project.success || !requestKey.success || !hash.success) return reply('Не удалось проверить загрузку.', 400);
  try {
    const supabase = await createClient({ requestTimeoutMs: 20_000 });
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return reply('Войдите снова.', 401);
    const { data, error } = await supabase.rpc('get_media_upload_status', {
      target_project: project.data, request_key: requestKey.data, content_hash: hash.data,
    });
    if (error || !Array.isArray(data) || data.length !== 1 || typeof data[0]?.outcome !== 'string') return reply('Не удалось проверить загрузку.', 502);
    const outcome = data[0].outcome;
    if (outcome === 'completed' && typeof data[0].asset_id === 'string') return Response.json({ status: 'completed', id: data[0].asset_id }, { headers: { 'Cache-Control': 'no-store' } });
    if (outcome === 'pending') return Response.json({ status: 'pending' }, { status: 202, headers: { 'Cache-Control': 'no-store', 'Retry-After': '3' } });
    if (outcome === 'expired') return Response.json({ status: 'expired' }, { status: 410, headers: { 'Cache-Control': 'no-store' } });
    if (outcome === 'conflict') return Response.json({ status: 'conflict' }, { status: 409, headers: { 'Cache-Control': 'no-store' } });
    return Response.json({ status: outcome === 'retry' ? 'retry' : 'none' }, { headers: { 'Cache-Control': 'no-store' } });
  } catch { return reply('Не удалось проверить загрузку.', 502); }
}

export async function POST(request: Request, context: { params: Promise<{ projectId: string }> }) {
  if (request.headers.get('origin') !== new URL(request.url).origin) return reply('Запрос запрещён.', 403);
  const project = z.string().uuid().safeParse((await context.params).projectId);
  if (!project.success) return reply('Некорректный проект.', 400);
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().startsWith('application/json')) return reply('Ожидаются метаданные загрузки.', 415);
  const length = Number(request.headers.get('content-length'));
  if (Number.isFinite(length) && length > maxBodyBytes) return reply('Размер запроса превышает лимит.', 413);
  const requestKey = z.string().uuid().safeParse(request.headers.get('idempotency-key'));
  if (!requestKey.success) return reply('Не удалось определить загрузку. Обновите страницу и повторите попытку.', 400);
  try {
    const reader = request.body?.getReader();
    if (!reader) return reply('Некорректные метаданные.', 400);
    const chunks: Uint8Array[] = []; let byteLength = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > maxBodyBytes) { await reader.cancel(); return reply('Размер запроса превышает лимит.', 413); }
      chunks.push(value);
    }
    reader.releaseLock();
    const raw = new Uint8Array(byteLength); let cursor = 0;
    for (const chunk of chunks) { raw.set(chunk, cursor); cursor += chunk.byteLength; }
    let input: unknown;
    try { input = JSON.parse(new TextDecoder().decode(raw)); } catch { return reply('Некорректные метаданные.', 400); }
    const payload = z.object({
      sha256: z.string().regex(/^[0-9a-f]{64}$/), mimeType: z.string(),
      fileName: z.string().min(1).max(255), size: z.number().int().positive().max(maxMediaBytes),
      targetAssetId: z.string().uuid().optional(),
    }).strict().safeParse(input);
    if (!payload.success) return reply('Некорректные метаданные.', 400);
    const invalid = validateMediaMetadata(payload.data.size, payload.data.mimeType);
    if (invalid) return reply(invalid, 400);
    const supabase = await createClient({ requestTimeoutMs: 20_000 });
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return reply('Войдите снова.', 401);
    const { data: begun, error: beginError } = payload.data.targetAssetId
      ? await supabase.rpc('begin_media_version_upload', {
        target_project: project.data, parent_asset: payload.data.targetAssetId, request_key: requestKey.data,
        content_hash: payload.data.sha256, content_type: payload.data.mimeType,
        upload_name: payload.data.fileName.trim(), upload_size: payload.data.size,
      })
      : await supabase.rpc('begin_media_upload', {
        target_project: project.data, request_key: requestKey.data, content_hash: payload.data.sha256,
        content_type: payload.data.mimeType, upload_name: payload.data.fileName.trim(), upload_size: payload.data.size,
      });
    if (beginError) return reply(beginError.code === '42501' ? 'Нет права загружать в этот проект.' : 'Не удалось начать загрузку. Повторите попытку.', beginError.code === '42501' ? 403 : 502);
    if (!Array.isArray(begun) || begun.length !== 1) return reply('Не удалось начать загрузку. Повторите попытку.', 502);
    const intent = begun[0];
    if (!intent || typeof intent !== 'object') return reply('Не удалось начать загрузку. Повторите попытку.', 502);
    if (intent.outcome === 'quota') return reply('Превышена квота хранилища проекта (1 ГиБ). Удалите лишние материалы или обратитесь к владельцу проекта.', 429);
    if (intent.outcome === 'conflict') return reply('Ключ загрузки уже связан с другим файлом. Обновите страницу и выберите файл снова.', 409);
    if (intent.outcome === 'expired') return reply('Срок этой загрузки истёк. Выберите файл заново, чтобы начать новую загрузку.', 410);
    if (intent.outcome === 'completed' && typeof intent.asset_id === 'string') {
      return Response.json({ id: intent.asset_id }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
    }
    if (intent.outcome !== 'upload' || typeof intent.intent_id !== 'string' || typeof intent.lease_token !== 'string' || typeof intent.object_path !== 'string') {
      return reply('Не удалось подтвердить состояние загрузки.', 502);
    }
    const intentId = intent.intent_id;
    const leaseToken = intent.lease_token;
    const path = intent.object_path;
    const pathParts = /^projects\/([0-9a-f-]{36})\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/[a-zA-Z0-9][a-zA-Z0-9_-]{0,100}\.[a-z0-9]{1,8}$/.exec(path);
    if (!pathParts || pathParts[1] !== project.data || pathParts[2] !== intentId) return reply('Не удалось подтвердить путь загрузки.', 502);
    const { data: leaseValid, error: leaseError } = await supabase.rpc('assert_media_upload_lease', { target_intent: intentId, token: leaseToken });
    if (leaseError) return reply('Не удалось подтвердить загрузку. Повторите попытку.', 502);
    if (leaseValid !== true) return reply('Срок этой загрузки истёк. Выберите файл заново.', 410);
    const storageAdmin = createAdminClient({ requestTimeoutMs: 20_000 });
    const { data: saved } = await storageAdmin.rpc('store_media_upload_token', { target_intent: intentId, token: leaseToken, signed_token: null });
    let tokenRow = Array.isArray(saved) ? saved[0] : null;
    if (!tokenRow?.upload_token || !tokenRow?.expires_at || Date.parse(tokenRow.expires_at) <= Date.now()) {
      const { data: signed, error: signedError } = await storageAdmin.storage.from('project-media').createSignedUploadUrl(path, { upsert: false });
      if (signedError || !signed?.token) return reply('Не удалось подготовить безопасную загрузку. Повторите попытку.', 502);
      const { data: persisted, error: persistError } = await storageAdmin.rpc('store_media_upload_token', { target_intent: intentId, token: leaseToken, signed_token: signed.token });
      tokenRow = Array.isArray(persisted) ? persisted[0] : null;
      if (persistError || !tokenRow?.upload_token || !tokenRow?.expires_at || Date.parse(tokenRow.expires_at) <= Date.now()) return reply('Срок загрузки истёк. Выберите файл заново.', 410);
      return Response.json({ intentId, leaseToken, path, token: tokenRow.upload_token, expiresAt: tokenRow.expires_at }, { headers: { 'Cache-Control': 'no-store' } });
    }
    const { data: refreshed, error: tokenError } = await storageAdmin.rpc('store_media_upload_token', { target_intent: intentId, token: leaseToken, signed_token: null });
    if (tokenError || !Array.isArray(refreshed) || !refreshed[0]?.upload_token) return reply('Не удалось проверить срок загрузки.', 502);
    return Response.json({ intentId, leaseToken, path, token: refreshed[0].upload_token, expiresAt: refreshed[0].expires_at }, { headers: { 'Cache-Control': 'no-store' } });
  } catch { return reply('Не удалось загрузить материал. Попробуйте снова.', 502); }
}
