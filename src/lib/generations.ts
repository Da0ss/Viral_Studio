import 'server-only';
import { createClient } from '@/lib/supabase/server';

export const generationPageSize = 20;
export const generationStatusFilters = ['queued', 'running', 'completed', 'failed', 'cancelled', 'uncertain'] as const;
export type GenerationStatusFilter = (typeof generationStatusFilters)[number];
export type GenerationFilters = { page: number; projectId: string | null; status: GenerationStatusFilter | null };
export interface GenerationListItem {
  id: string; project_id: string; projectName: string | null; status: string; dispatch_state: string;
  prompt: string; assetId: string | null; created_at: string; completed_at: string | null;
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;

export function parseGenerationFilters(params: Record<string, string | string[] | undefined>): GenerationFilters {
  const page = first(params.page); const project = first(params.project); const status = first(params.status);
  return {
    page: /^\d+$/.test(page ?? '') ? Math.min(10000, Math.max(1, Number(page))) : 1,
    projectId: project && uuid.test(project) ? project : null,
    status: generationStatusFilters.includes(status as GenerationStatusFilter) ? status as GenerationStatusFilter : null,
  };
}

export function generationPageQuery(filters: GenerationFilters, page: number) {
  const query = new URLSearchParams();
  if (filters.projectId) query.set('project', filters.projectId);
  if (filters.status) query.set('status', filters.status);
  if (page > 1) query.set('page', String(page));
  const text = query.toString();
  return text ? `?${text}` : '?';
}

// Read-only list through the caller's JWT. generation_jobs RLS limits rows to project
// participants and column grants hide billing, lease and provider fields.
export async function getGenerations(filters: GenerationFilters) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return { authenticated: false as const, items: [] as GenerationListItem[], total: 0, projects: [] as { id: string; name: string }[], error: null };
  try {
    let query = supabase.from('generation_jobs')
      .select('id, project_id, status, dispatch_state, input, output, created_at, completed_at', { count: 'exact' });
    if (filters.projectId) query = query.eq('project_id', filters.projectId);
    // "Uncertain" is a dispatch state of a running job, so it is filtered separately from status.
    if (filters.status === 'uncertain') query = query.eq('dispatch_state', 'uncertain');
    else if (filters.status) query = query.eq('status', filters.status);
    const [jobs, projects] = await Promise.all([
      query.order('created_at', { ascending: false }).order('id', { ascending: false })
        .range((filters.page - 1) * generationPageSize, filters.page * generationPageSize - 1),
      supabase.from('project_members').select('projects(id, name)').eq('user_id', user.id).order('created_at').limit(200),
    ]);
    if (jobs.error) throw jobs.error;
    const projectOptions = projects.error ? [] : (projects.data ?? []).flatMap(row => {
      const project = Array.isArray(row.projects) ? row.projects[0] : row.projects;
      return project ? [{ id: project.id as string, name: project.name as string }] : [];
    });
    const names = new Map(projectOptions.map(project => [project.id, project.name]));
    const items = (jobs.data ?? []).map(job => {
      const input = job.input && typeof job.input === 'object' ? job.input as { prompt?: unknown } : {};
      const output = job.output && typeof job.output === 'object' ? job.output as { asset_id?: unknown } : {};
      return {
        id: job.id, project_id: job.project_id, projectName: names.get(job.project_id) ?? null, status: job.status, dispatch_state: job.dispatch_state,
        prompt: typeof input.prompt === 'string' ? input.prompt : '', assetId: typeof output.asset_id === 'string' ? output.asset_id : null,
        created_at: job.created_at, completed_at: job.completed_at,
      } satisfies GenerationListItem;
    });
    return { authenticated: true as const, items, total: jobs.count ?? 0, projects: projectOptions, error: null };
  } catch {
    return { authenticated: true as const, items: [] as GenerationListItem[], total: 0, projects: [] as { id: string; name: string }[], error: 'msg.generation.listFailed' };
  }
}

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
