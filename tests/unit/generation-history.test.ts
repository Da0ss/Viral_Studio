import { beforeEach, expect, it, vi } from 'vitest';
import { getGenerationHistory, generationHistoryPageSize, maxGenerationHistoryPage } from '@/lib/generations';

const mocks = vi.hoisted(() => ({ client: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.client }));

const projectId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const job = {
  id: 'aeaeaeae-aeae-4eae-8eae-aeaeaeaeaeae', project_id: projectId,
  requested_by: '11111111-1111-4111-8111-111111111111', status: 'queued', dispatch_state: 'queued',
  input: { prompt: 'Fixture prompt' }, output: {}, error_message: null,
  created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z', completed_at: null,
};

beforeEach(() => vi.resetAllMocks());

function setup({ user = true, rows = [job], count = rows.length, error = null, authError = null } = {}) {
  const query = {
    select: vi.fn(), eq: vi.fn(), order: vi.fn(), range: vi.fn().mockResolvedValue({ data: rows, count, error }),
  };
  query.select.mockReturnValue(query); query.eq.mockReturnValue(query); query.order.mockReturnValue(query);
  const from = vi.fn().mockReturnValue(query);
  mocks.client.mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: user ? { id: '11111111-1111-4111-8111-111111111111' } : null }, error: authError }) },
    from,
  });
  return { from, query };
}

it('rejects malformed scope and excessive page bounds before querying', async () => {
  expect((await getGenerationHistory({ projectId: 'bad' })).status).toBe('error');
  expect((await getGenerationHistory({ status: 'worker-secret' as never })).status).toBe('error');
  expect((await getGenerationHistory({}, maxGenerationHistoryPage + 1)).status).toBe('error');
  expect(mocks.client).not.toHaveBeenCalled();
});

it('does not query generation history for a guest', async () => {
  const client = setup({ user: false });
  expect(await getGenerationHistory()).toMatchObject({ status: 'unauthenticated', authenticated: false });
  expect(client.from).not.toHaveBeenCalled();
});

it('applies validated project/status filters and stable bounded pagination', async () => {
  const { query } = setup({ count: 25 });
  const result = await getGenerationHistory({ projectId: projectId.toUpperCase(), status: 'queued' }, 2);
  expect(result).toMatchObject({ status: 'success', total: 25, page: 2, pageSize: generationHistoryPageSize, filters: { projectId, status: 'queued' }, items: [job] });
  expect(query.select).toHaveBeenCalledWith('id, project_id, requested_by, status, dispatch_state, input, output, error_message, created_at, updated_at, completed_at', { count: 'exact' });
  expect(query.eq.mock.calls).toEqual([[ 'project_id', projectId ], [ 'status', 'queued' ]]);
  expect(query.order.mock.calls).toEqual([[ 'created_at', { ascending: false } ], [ 'id', { ascending: false } ]]);
  expect(query.range).toHaveBeenCalledWith(24, 47);
  const columns = query.select.mock.calls[0][0] as string;
  expect(columns).not.toMatch(/lease|reservation|charged|provider_request|storage_path/i);
});

it('returns honest empty/auth/query outcomes without exposing database details', async () => {
  setup({ rows: [], count: 0 });
  expect(await getGenerationHistory({ status: 'failed' })).toMatchObject({ status: 'empty', total: 0, items: [] });
  setup({ authError: { message: 'expired auth token' } });
  expect(await getGenerationHistory()).toMatchObject({ status: 'error', authenticated: null, code: 'auth_error' });
  setup({ error: { message: 'private SQL detail' }, count: null });
  const result = await getGenerationHistory();
  expect(result).toMatchObject({ status: 'error', authenticated: true, code: 'query_error', items: [] });
  expect(JSON.stringify(result)).not.toContain('private SQL detail');
});
