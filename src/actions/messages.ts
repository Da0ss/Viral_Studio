'use server';

import { revalidatePath } from 'next/cache';
import { hasSupabasePublicConfig } from '@/lib/supabase/config';
import { createClient } from '@/lib/supabase/server';
import { messageInputSchema, type ChatMessage } from '@/types/messages';

export type SendMessageResult =
  | { ok: true; message: ChatMessage }
  | { ok: false; error: string };

const writableRoles = new Set(['owner', 'editor', 'commenter']);

export async function sendMessage(input: { projectId: string; body: string }): Promise<SendMessageResult> {
  const parsed = messageInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Проверьте текст сообщения.' };
  if (!hasSupabasePublicConfig()) return { ok: false, error: 'Чат недоступен: Supabase не настроен.' };

  const supabase = await createClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) return { ok: false, error: 'Сессия закончилась. Войдите снова.' };

  // This check gives a clear application error; RLS remains the authority that
  // prevents a forged Server Action request from inserting a row.
  const { data: membership, error: membershipError } = await supabase
    .from('project_members')
    .select('role')
    .eq('project_id', parsed.data.projectId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (membershipError || !membership || !writableRoles.has(membership.role)) {
    return { ok: false, error: 'У вас нет права отправлять сообщения в этот проект.' };
  }

  const { data, error } = await supabase
    .from('messages')
    .insert({ project_id: parsed.data.projectId, sender_id: user.id, body: parsed.data.body })
    .select('id, project_id, sender_id, body, created_at')
    .single();
  if (error || !data) return { ok: false, error: 'Не удалось отправить сообщение. Попробуйте ещё раз.' };

  revalidatePath(`/projects/${parsed.data.projectId}/chat`);
  return { ok: true, message: data as ChatMessage };
}
