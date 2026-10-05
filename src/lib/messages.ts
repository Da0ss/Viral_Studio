import 'server-only';

import { hasSupabasePublicConfig } from '@/lib/supabase/config';
import { createClient, getCurrentUser } from '@/lib/supabase/server';
import type { ChatMessage } from '@/types/messages';
import type { ProjectRole } from '@/types/projects';

export type ProjectChatData =
  | { status: 'ready'; projectName: string; role: ProjectRole; userId: string; messages: ChatMessage[] }
  | { status: 'unauthenticated' | 'forbidden' | 'error'; message: string };

export async function getProjectChat(projectId: string): Promise<ProjectChatData> {
  if (!hasSupabasePublicConfig()) return { status: 'error', message: 'Supabase не настроен.' };
  const user = await getCurrentUser();
  if (!user) return { status: 'unauthenticated', message: 'Войдите, чтобы открыть чат проекта.' };

  const supabase = await createClient();
  const { data: membership, error: membershipError } = await supabase
    .from('project_members')
    .select('role')
    .eq('project_id', projectId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (membershipError || !membership) return { status: 'forbidden', message: 'У вас нет доступа к чату этого проекта.' };

  const [{ data: project, error: projectError }, { data: messages, error: messagesError }] = await Promise.all([
    supabase.from('projects').select('name').eq('id', projectId).maybeSingle(),
    supabase.from('messages').select('id, project_id, sender_id, body, created_at').eq('project_id', projectId).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(100),
  ]);
  if (projectError || messagesError || !project) return { status: 'error', message: 'Не удалось загрузить сообщения. Попробуйте обновить страницу.' };

  return { status: 'ready', projectName: project.name, role: membership.role as ProjectRole, userId: user.id, messages: [...(messages ?? [])].reverse() as ChatMessage[] };
}
