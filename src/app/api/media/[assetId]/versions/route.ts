import { getMediaVersions } from '@/lib/media';

const cacheHeaders = { 'Cache-Control': 'private, no-store' };
const respond = (body: Record<string, unknown>, status = 200) => Response.json(body, { status, headers: cacheHeaders });
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parsePage(request: Request): number | null {
  const params = new URL(request.url).searchParams;
  for (const key of new Set(params.keys())) {
    if (key !== 'page' || params.getAll(key).length !== 1) return null;
  }
  const rawPage = params.get('page');
  if (rawPage === null) return 1;
  if (!/^[1-9]\d{0,4}$/.test(rawPage)) return null;
  const page = Number(rawPage);
  return Number.isSafeInteger(page) && page <= 10_000 ? page : null;
}

export async function GET(request: Request, { params }: { params: Promise<{ assetId: string }> }) {
  const page = parsePage(request);
  if (page === null) return respond({ error: 'Invalid query parameters' }, 400);
  try {
    const { assetId } = await params;
    if (!uuidPattern.test(assetId)) return respond({ error: 'Invalid asset ID' }, 400);
    const result = await getMediaVersions(assetId, page);
    if (result.status === 'unauthenticated') return respond({ error: 'Unauthorized' }, 401);
    if (result.status === 'error') {
      if (result.code === 'invalid_input') return respond({ error: 'Invalid asset ID or page' }, 400);
      return respond({ error: 'Temporarily unavailable' }, 503);
    }
    return respond({ items: result.items, page: result.page, pageSize: result.pageSize, total: result.total, totalPages: result.totalPages });
  } catch {
    return respond({ error: 'Temporarily unavailable' }, 503);
  }
}
