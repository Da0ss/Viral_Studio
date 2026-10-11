import 'server-only';
import { createClient } from '@/lib/supabase/server';

export const mediaPageSize = 24;
export function parseMediaPage(value?: string) {
  return /^\d+$/.test(value ?? '') ? Math.min(10000, Math.max(1, Number(value))) : 1;
}
export interface MediaItem { id: string; project_id: string; name: string; kind: string; mime_type: string; size_bytes: number; created_at: string; role: string | null; }

/** Public, authenticated columns only. In particular, storage_path is never selected. */
export interface MediaVersion {
  id: string;
  asset_id: string;
  version_number: number;
  mime_type: string;
  size_bytes: number;
  created_by: string;
  created_at: string;
}

export const mediaVersionPageSize = 24;
export const maxMediaVersionPage = 10_000;
export type MediaVersionReaderResult =
  | { status: 'success'; authenticated: true; items: MediaVersion[]; page: number; pageSize: number; total: number; totalPages: number }
  | { status: 'empty'; authenticated: true; items: []; page: number; pageSize: number; total: number; totalPages: number }
  | { status: 'unauthenticated'; authenticated: false; items: []; page: number; pageSize: number; total: 0; totalPages: 0 }
  | { status: 'error'; authenticated: boolean | null; code: 'invalid_input' | 'auth_error' | 'query_error'; items: []; page: number; pageSize: number; total: 0; totalPages: 0 };

const canonicalUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Reads one asset's versions through the request user's JWT and the existing RLS policy. */
export async function getMediaVersions(assetId: string, page = 1): Promise<MediaVersionReaderResult> {
  if (typeof assetId !== 'string' || !canonicalUuid.test(assetId)
    || !Number.isSafeInteger(page) || page < 1 || page > maxMediaVersionPage) {
    return { status: 'error', authenticated: null, code: 'invalid_input', items: [], page: 1, pageSize: mediaVersionPageSize, total: 0, totalPages: 0 };
  }
  const normalizedAssetId = assetId.toLowerCase();
  let authenticated: boolean | null = null;
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError) return { status: 'error', authenticated: null, code: 'auth_error', items: [], page, pageSize: mediaVersionPageSize, total: 0, totalPages: 0 };
    if (!user) {
      authenticated = false;
      return { status: 'unauthenticated', authenticated: false, items: [], page, pageSize: mediaVersionPageSize, total: 0, totalPages: 0 };
    }
    authenticated = true;

    const offset = (page - 1) * mediaVersionPageSize;
    const { data, count, error } = await supabase.from('asset_versions')
      .select('id, asset_id, version_number, mime_type, size_bytes, created_by, created_at', { count: 'exact' })
      .eq('asset_id', normalizedAssetId)
      .order('version_number', { ascending: false }).order('id', { ascending: false })
      .range(offset, offset + mediaVersionPageSize - 1);
    if (error || count === null) return { status: 'error', authenticated: true, code: 'query_error', items: [], page, pageSize: mediaVersionPageSize, total: 0, totalPages: 0 };
    const items = (data ?? []) as MediaVersion[];
    const totalPages = Math.ceil(count / mediaVersionPageSize);
    if (items.length === 0) return { status: 'empty', authenticated: true, items: [], page, pageSize: mediaVersionPageSize, total: count, totalPages };
    return { status: 'success', authenticated: true, items, page, pageSize: mediaVersionPageSize, total: count, totalPages };
  } catch {
    return { status: 'error', authenticated, code: 'query_error', items: [], page, pageSize: mediaVersionPageSize, total: 0, totalPages: 0 };
  }
}

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
