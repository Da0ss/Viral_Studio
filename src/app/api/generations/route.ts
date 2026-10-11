import { getGenerationHistory, generationStatuses, type GenerationStatus } from '@/lib/generations';

const cacheHeaders = { 'Cache-Control': 'private, no-store' };
const respond = (body: Record<string, unknown>, status = 200) => Response.json(body, { status, headers: cacheHeaders });
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const allowedKeys = new Set(['page', 'projectId', 'status']);

function parseQuery(request: Request): { page: number; projectId?: string; status?: GenerationStatus } | null {
  const params = new URL(request.url).searchParams;
  for (const key of new Set(params.keys())) {
    if (!allowedKeys.has(key) || params.getAll(key).length !== 1) return null;
  }
  const rawPage = params.get('page');
  let page = 1;
  if (rawPage !== null) {
    if (!/^[1-9]\d{0,4}$/.test(rawPage)) return null;
    page = Number(rawPage);
    if (!Number.isSafeInteger(page) || page > 10_000) return null;
  }
  const projectId = params.get('projectId') ?? undefined;
  if (projectId !== undefined && !uuidPattern.test(projectId)) return null;
  const status = params.get('status') ?? undefined;
  if (status !== undefined && !(generationStatuses as readonly string[]).includes(status)) return null;
  return { page, ...(projectId ? { projectId } : {}), ...(status ? { status: status as GenerationStatus } : {}) };
}

export async function GET(request: Request) {
  const filters = parseQuery(request);
  if (!filters) return respond({ error: 'Invalid query parameters' }, 400);
  try {
    const result = await getGenerationHistory({ projectId: filters.projectId, status: filters.status }, filters.page);
    if (result.status === 'unauthenticated') return respond({ error: 'Unauthorized' }, 401);
    if (result.status === 'error') return respond({ error: 'Temporarily unavailable' }, 503);
    return respond({ items: result.items, page: result.page, pageSize: result.pageSize, total: result.total, totalPages: result.totalPages });
  } catch {
    return respond({ error: 'Temporarily unavailable' }, 503);
  }
}
