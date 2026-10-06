import 'server-only';
import { createClient } from '@/lib/supabase/server';

export const mediaPageSize = 24;
export function parseMediaPage(value?: string) {
  return /^\d+$/.test(value ?? '') ? Math.min(10000, Math.max(1, Number(value))) : 1;
}
export interface MediaItem { id: string; project_id: string; name: string; kind: string; mime_type: string; size_bytes: number; created_at: string; role: string | null; }
export async function getMedia(page: number) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return { authenticated: false, items: [] as MediaItem[], total: 0, error: null };
  try {
    // Use the caller's JWT and RLS, never a service-role client. Storage paths
    // are intentionally excluded until private preview access is implemented.
    const { data, count, error } = await supabase.from('assets')
      .select('id, project_id, name, kind, mime_type, size_bytes, created_at', { count: 'exact' })
      .order('created_at', { ascending: false }).order('id', { ascending: false })
      .range((page - 1) * mediaPageSize, page * mediaPageSize - 1);
    if (error) throw error;
    const projectIds = [...new Set((data ?? []).map(item => item.project_id))];
    const { data: memberships, error: membershipError } = projectIds.length
      ? await supabase.from('project_members').select('project_id, role').eq('user_id', user.id).in('project_id', projectIds)
      : { data: [], error: null };
    if (membershipError) throw membershipError;
    const roles = new Map((memberships ?? []).map(member => [member.project_id, member.role]));
    return { authenticated: true, items: (data ?? []).map(item => ({ ...item, role: roles.get(item.project_id) ?? null })) as MediaItem[], total: count ?? 0, error: null };
  } catch {
    return { authenticated: true, items: [] as MediaItem[], total: 0, error: 'Не удалось загрузить материалы. Обновите страницу.' };
  }
}
