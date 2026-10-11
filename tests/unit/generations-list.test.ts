import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generationPageQuery, generationPageSize, getGenerations, parseGenerationFilters } from '@/lib/generations';

const mocks = vi.hoisted(() => ({ client: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.client }));
const project = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const job = { id: 'job', project_id: project, status: 'running', dispatch_state: 'uncertain', input: { prompt: 'Make a teaser' }, output: { asset_id: 'asset' }, created_at: '2026-10-10T10:00:00.000Z', completed_at: null };

function setup({ user = true, jobs = [job] as unknown[] | null, jobsError = null as unknown } = {}) {
  const jobsQuery = { select: vi.fn(), eq: vi.fn(), order: vi.fn(), range: vi.fn().mockResolvedValue({ data: jobs, count: jobs?.length ?? 0, error: jobsError }) };
  jobsQuery.select.mockReturnValue(jobsQuery); jobsQuery.eq.mockReturnValue(jobsQuery); jobsQuery.order.mockReturnValue(jobsQuery);
  const membersQuery = { select: vi.fn(), eq: vi.fn(), order: vi.fn(), limit: vi.fn().mockResolvedValue({ data: [{ projects: { id: project, name: 'Campaign' } }], error: null }) };
  membersQuery.select.mockReturnValue(membersQuery); membersQuery.eq.mockReturnValue(membersQuery); membersQuery.order.mockReturnValue(membersQuery);
  const from = vi.fn((table: string) => table === 'generation_jobs' ? jobsQuery : membersQuery);
  mocks.client.mockResolvedValue({ auth: { getUser: vi.fn().mockResolvedValue({ data: { user: user ? { id: 'user' } : null }, error: null }) }, from });
  return { from, jobsQuery };
}
beforeEach(() => vi.resetAllMocks());

describe('generation list filters', () => {
  it('accepts only known statuses, UUID projects and bounded pages', () => {
    expect(parseGenerationFilters({ page: '3', project, status: 'uncertain' })).toEqual({ page: 3, projectId: project, status: 'uncertain' });
    expect(parseGenerationFilters({ page: '-1', project: 'x; drop', status: 'paid' })).toEqual({ page: 1, projectId: null, status: null });
    expect(parseGenerationFilters({ page: '99999999' }).page).toBe(10000);
  });
  it('keeps filters in pagination links', () => {
    expect(generationPageQuery({ page: 1, projectId: project, status: 'failed' }, 2)).toBe(`?project=${project}&status=failed&page=2`);
    expect(generationPageQuery({ page: 2, projectId: null, status: null }, 1)).toBe('?');
  });
});

describe('getGenerations', () => {
  it('does not query jobs for a signed-out caller', async () => {
    const client = setup({ user: false });
    expect(await getGenerations({ page: 1, projectId: null, status: null })).toMatchObject({ authenticated: false, items: [] });
    expect(client.from).not.toHaveBeenCalled();
  });
  it('selects only client-visible columns and pages through the caller session', async () => {
    const client = setup();
    const result = await getGenerations({ page: 2, projectId: null, status: null });
    const columns = client.jobsQuery.select.mock.calls[0][0] as string;
    for (const hidden of ['charged_micro_usd', 'reservation_micro_usd', 'lease_token', 'provider_request_path', 'error_message']) expect(columns).not.toContain(hidden);
    expect(client.jobsQuery.range).toHaveBeenCalledWith(generationPageSize, generationPageSize * 2 - 1);
    expect(result.items[0]).toMatchObject({ id: 'job', projectName: 'Campaign', prompt: 'Make a teaser', assetId: 'asset', dispatch_state: 'uncertain' });
  });
  it('filters an uncertain outcome by dispatch state and other outcomes by status', async () => {
    const uncertain = setup();
    await getGenerations({ page: 1, projectId: project, status: 'uncertain' });
    expect(uncertain.jobsQuery.eq).toHaveBeenCalledWith('project_id', project);
    expect(uncertain.jobsQuery.eq).toHaveBeenCalledWith('dispatch_state', 'uncertain');
    vi.resetAllMocks();
    const failed = setup();
    await getGenerations({ page: 1, projectId: null, status: 'failed' });
    expect(failed.jobsQuery.eq).toHaveBeenCalledWith('status', 'failed');
    expect(failed.jobsQuery.eq).not.toHaveBeenCalledWith('dispatch_state', expect.anything());
  });
  it('returns an error key instead of an empty list when the query fails', async () => {
    setup({ jobs: null, jobsError: { message: 'private detail' } });
    expect(await getGenerations({ page: 1, projectId: null, status: null })).toMatchObject({ items: [], error: 'msg.generation.listFailed' });
  });
});
