import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { hasMediaSignature, maxMediaBytes, mediaFormats, safeMediaFilename, validateMediaMetadata, type MediaMime } from '@/lib/media-file';

export const runtime = 'nodejs';
const maxBodyBytes = maxMediaBytes + 1024 * 1024;
const reply = (error: string, status: number) => Response.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } });

export async function POST(request: Request, context: { params: Promise<{ projectId: string }> }) {
  if (request.headers.get('origin') !== new URL(request.url).origin) return reply('Запрос запрещён.', 403);
  const project = z.string().uuid().safeParse((await context.params).projectId);
  if (!project.success) return reply('Некорректный проект.', 400);
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.startsWith('multipart/form-data;')) return reply('Ожидается файл.', 415);
  const length = Number(request.headers.get('content-length'));
  if (length > maxBodyBytes) return reply('Размер запроса превышает лимит.', 413);
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return reply('Войдите снова.', 401);
    const { data: member, error: memberError } = await supabase.from('project_members').select('role')
      .eq('project_id', project.data).eq('user_id', user.id).maybeSingle();
    if (memberError || !member || !['owner', 'editor'].includes(member.role)) return reply('Нет права загружать материалы.', 403);

    // Bound actual streamed bytes even for missing/forged Content-Length.
    const reader = request.body?.getReader();
    if (!reader) return reply('Выберите файл.', 400);
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBodyBytes) { await reader.cancel(); return reply('Размер запроса превышает лимит.', 413); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const body = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
    let form: FormData;
    try { form = await new Response(body, { headers: { 'content-type': contentType } }).formData(); }
    catch { return reply('Некорректный файл.', 400); }
    const file = form.get('file');
    if (!(file instanceof File)) return reply('Выберите файл.', 400);
    const invalid = validateMediaMetadata(file.size, file.type);
    if (invalid) return reply(invalid, 400);
    const mime = file.type as MediaMime;
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!hasMediaSignature(bytes, mime)) return reply('Содержимое не соответствует формату файла.', 400);
    const id = crypto.randomUUID();
    const path = `projects/${project.data}/${id}/${safeMediaFilename(file.name, mime)}`;
    const bucket = supabase.storage.from('project-media');
    const { error: uploadError } = await bucket.upload(path, bytes, { contentType: mime, upsert: false });
    if (uploadError) return reply('Не удалось загрузить файл.', 502);
    // Storage and Postgres are not one transaction. Cleanup is best effort;
    // transport ambiguity and process termination still require reconciliation.
    const { data: asset, error: insertError } = await supabase.from('assets').insert({ id, project_id: project.data,
      kind: mediaFormats[mime].kind, name: file.name.trim().slice(0, 255) || safeMediaFilename(file.name, mime),
      storage_path: path, mime_type: mime, size_bytes: file.size, created_by: user.id }).select('id').maybeSingle();
    if (insertError || !asset) {
      try { await bucket.remove([path]); } catch { /* Durable reconciliation remains required. */ }
      return reply('Не удалось сохранить материал.', 502);
    }
    return Response.json({ id: asset.id }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch { return reply('Не удалось загрузить материал. Попробуйте снова.', 502); }
}
