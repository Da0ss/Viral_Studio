import 'server-only';
import { createClient } from '@/lib/supabase/server';

export const generationHistoryPageSize = 24;
export const maxGenerationHistoryPage = 10_000;

export const generationStatuses = ['queued', 'running', 'completed', 'failed', 'cancelled'] as const;
export type GenerationStatus = typeof generationStatuses[number];
export type GenerationJson = null | boolean | number | string | GenerationJson[] | { [key: string]: GenerationJson | undefined };

/** The fields authenticated users can select in the current generation_jobs grant. */
export interface GenerationHistoryItem {
  id: string;
  project_id: string;
  requested_by: string;
  status: GenerationStatus;
  dispatch_state: 'queued' | 'submitting' | 'submitted' | 'polling' | 'cancelling' | 'uncertain' | 'finalized';
  input: GenerationJson;
  output: GenerationJson;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface GenerationHistoryFilters {
  projectId?: string;
  status?: GenerationStatus;
}

export type GenerationHistoryReaderResult =
  | { status: 'success'; authenticated: true; items: GenerationHistoryItem[]; page: number; pageSize: number; total: number; totalPages: number; filters: GenerationHistoryFilters }
  | { status: 'empty'; authenticated: true; items: []; page: number; pageSize: number; total: number; totalPages: number; filters: GenerationHistoryFilters }
  | { status: 'unauthenticated'; authenticated: false; items: []; page: number; pageSize: number; total: 0; totalPages: 0; filters: GenerationHistoryFilters }
  | { status: 'error'; authenticated: boolean | null; code: 'invalid_input' | 'auth_error' | 'query_error'; items: []; page: number; pageSize: number; total: 0; totalPages: 0; filters: GenerationHistoryFilters };

const canonicalUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isGenerationStatus = (value: unknown): value is GenerationStatus => typeof value === 'string'
  && (generationStatuses as readonly string[]).includes(value);

/**
 * Validates the requested scope, then lists only authenticated-selectable job columns.
 * RLS remains the authority for active project membership and revoked access.
 */
export async function getGenerationHistory(filters: GenerationHistoryFilters = {}, page = 1): Promise<GenerationHistoryReaderResult> {
  const projectId = filters.projectId?.toLowerCase();
  const normalizedFilters: GenerationHistoryFilters = {
    ...(projectId ? { projectId } : {}),
    ...(filters.status ? { status: filters.status } : {}),
  };
  const validFilters = (filters.projectId === undefined || (typeof filters.projectId === 'string' && canonicalUuid.test(filters.projectId)))
    && (filters.status === undefined || isGenerationStatus(filters.status));
  if (!validFilters || !Number.isSafeInteger(page) || page < 1 || page > maxGenerationHistoryPage) {
    return { status: 'error', authenticated: null, code: 'invalid_input', items: [], page: 1, pageSize: generationHistoryPageSize, total: 0, totalPages: 0, filters: normalizedFilters };
  }

  let authenticated: boolean | null = null;
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError) return { status: 'error', authenticated: null, code: 'auth_error', items: [], page, pageSize: generationHistoryPageSize, total: 0, totalPages: 0, filters: normalizedFilters };
    if (!user) {
      authenticated = false;
      return { status: 'unauthenticated', authenticated: false, items: [], page, pageSize: generationHistoryPageSize, total: 0, totalPages: 0, filters: normalizedFilters };
    }
    authenticated = true;

    let query = supabase.from('generation_jobs')
      .select('id, project_id, requested_by, status, dispatch_state, input, output, error_message, created_at, updated_at, completed_at', { count: 'exact' });
    if (normalizedFilters.projectId) query = query.eq('project_id', normalizedFilters.projectId);
    if (normalizedFilters.status) query = query.eq('status', normalizedFilters.status);
    const offset = (page - 1) * generationHistoryPageSize;
    const { data, count, error } = await query
      .order('created_at', { ascending: false }).order('id', { ascending: false })
      .range(offset, offset + generationHistoryPageSize - 1);
    if (error || count === null) return { status: 'error', authenticated: true, code: 'query_error', items: [], page, pageSize: generationHistoryPageSize, total: 0, totalPages: 0, filters: normalizedFilters };
    const items = (data ?? []) as GenerationHistoryItem[];
    const totalPages = Math.ceil(count / generationHistoryPageSize);
    if (items.length === 0) return { status: 'empty', authenticated: true, items: [], page, pageSize: generationHistoryPageSize, total: count, totalPages, filters: normalizedFilters };
    return { status: 'success', authenticated: true, items, page, pageSize: generationHistoryPageSize, total: count, totalPages, filters: normalizedFilters };
  } catch {
    return { status: 'error', authenticated, code: 'query_error', items: [], page, pageSize: generationHistoryPageSize, total: 0, totalPages: 0, filters: normalizedFilters };
  }
}
