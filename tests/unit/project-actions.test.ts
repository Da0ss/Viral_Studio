import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteProject, updateProject, createProject } from '@/actions/projects';

const mocks = vi.hoisted(() => ({ createClient: vi.fn(), revalidatePath: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));

const projectId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
function form(fields: Record<string, string> = {}) {
  const result = new FormData();
  Object.entries({ projectId, ...fields }).forEach(([key, value]) => result.set(key, value));
  return result;
}
function setup(options: { user?: boolean; role?: string | null; data?: { id: string } | null; error?: unknown; authError?: unknown; membershipError?: unknown } = {}) {
  const query = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn() };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.maybeSingle.mockResolvedValue({ data: { role: options.role === undefined ? 'owner' : options.role }, error: options.membershipError ?? null });
  const mutation = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn() };
  mutation.select.mockReturnValue(mutation);
  mutation.eq.mockReturnValue(mutation);
  mutation.maybeSingle.mockResolvedValue({ data: options.data === undefined ? { id: projectId } : options.data, error: options.error ?? null });
  const remove = vi.fn().mockReturnValue(mutation);
  const update = vi.fn().mockReturnValue(mutation);
  const insert = vi.fn().mockResolvedValue({ error: null });
  const from = vi.fn((table: string) => table === 'projects' ? { delete: remove, update, insert } : query);
  const getUser = vi.fn().mockResolvedValue({ data: { user: options.user === false ? null : { id: 'user-id' } }, error: options.authError ?? null });
  mocks.createClient.mockResolvedValue({ auth: { getUser }, from });
  return { remove, update, insert, from, mutation, getUser };
}
beforeEach(() => vi.resetAllMocks());

describe('project action authorization and mutation results', () => {
  it('does not query the database for an invalid delete id', async () => {
    expect(await deleteProject({}, form({ projectId: '-'.repeat(36) }))).toHaveProperty('error');
    expect(mocks.createClient).not.toHaveBeenCalled();
  });
  it('rejects guests before deletion', async () => {
    const client = setup({ user: false });
    expect(await deleteProject({}, form())).toHaveProperty('error');
    expect(client.remove).not.toHaveBeenCalled();
  });
  it.each(['editor', 'commenter', 'viewer', null])('rejects deletion for role %s', async role => {
    const client = setup({ role });
    expect(await deleteProject({}, form())).toHaveProperty('error');
    expect(client.remove).not.toHaveBeenCalled();
  });
  it('reports zero-row deletion as failure without revalidation', async () => {
    setup({ data: null });
    expect(await deleteProject({}, form())).toHaveProperty('error');
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
  it('does not expose database errors', async () => {
    setup({ error: { message: 'SQL private secret stack trace' } });
    expect(JSON.stringify(await deleteProject({}, form()))).not.toMatch(/SQL|secret|stack/);
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
  it('turns rejected requests into a safe error', async () => {
    mocks.createClient.mockRejectedValue(new Error('internal stack trace'));
    const result = await deleteProject({}, form());
    expect(result).toHaveProperty('error');
    expect(JSON.stringify(result)).not.toContain('stack');
  });
  it('revalidates only an actual owner deletion', async () => {
    const client = setup();
    expect(await deleteProject({}, form())).toEqual({ success: 'Проект удалён.' });
    expect(client.mutation.eq).toHaveBeenCalledWith('id', projectId);
    expect(client.mutation.select).toHaveBeenCalledWith('id');
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/projects');
  });
  it('allows editor updates without the disabled organization field', async () => {
    const client = setup({ role: 'editor' });
    expect(await updateProject({}, form({ name: 'Updated', description: '', type: 'ai', status: 'draft', organizationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }))).toHaveProperty('success');
    expect(client.update).toHaveBeenCalledWith({ name: 'Updated', description: '', type: 'ai', status: 'draft' });
    expect(client.getUser).toHaveBeenCalledTimes(1);
    expect(mocks.createClient).toHaveBeenCalledTimes(1);
  });
  it('does not claim an update succeeded when no row changed', async () => {
    setup({ data: null });
    expect(await updateProject({}, form({ name: 'Updated', description: '', type: 'ai', status: 'draft' }))).toHaveProperty('error');
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
  it('denies project creation to an ordinary organization member', async () => {
    const client = setup({ role: 'member' });
    expect(await createProject({}, form({ name: 'New project', description: '', type: 'ai', status: 'draft', organizationId: projectId }))).toHaveProperty('error');
    expect(client.insert).not.toHaveBeenCalled();
  });
});

const validInput = { name: 'Fixture project', description: '', type: 'ai', status: 'draft', organizationId: projectId };
it.each([createProject, updateProject])('redacts client creation exceptions for create/update actions', async action => {
  mocks.createClient.mockRejectedValue(new Error('SQL private stack trace'));
  const result = await action({}, form(validInput));
  expect(result).toHaveProperty('error'); expect(JSON.stringify(result)).not.toMatch(/SQL|private|stack/);
  expect(mocks.revalidatePath).not.toHaveBeenCalled();
});
it.each([createProject, updateProject, deleteProject])('fails closed when Auth returns both user data and an error', async action => {
  const p = setup({ authError: { message: 'private auth failure' } });
  expect(await action({}, form(validInput))).toHaveProperty('error');
  expect(p.insert).not.toHaveBeenCalled(); expect(p.update).not.toHaveBeenCalled(); expect(p.remove).not.toHaveBeenCalled();
});
it.each([createProject, updateProject, deleteProject])('does not accept role data accompanying a membership error', async action => {
  const p = setup({ membershipError: { message: 'private SQL failure' } });
  expect(await action({}, form(validInput))).toHaveProperty('error');
  expect(p.insert).not.toHaveBeenCalled(); expect(p.update).not.toHaveBeenCalled(); expect(p.remove).not.toHaveBeenCalled();
});
it.each([createProject, updateProject])('returns a safe ambiguous-result message on transport failure', async action => {
  const p = setup();
  if (action === createProject) p.insert.mockRejectedValue(new Error('SQL private stack'));
  else p.mutation.maybeSingle.mockRejectedValue(new Error('SQL private stack'));
  const result = await action({}, form(validInput));
  expect(result.error).toContain('Обновите список'); expect(JSON.stringify(result)).not.toMatch(/SQL|private|stack/);
  expect(mocks.revalidatePath).not.toHaveBeenCalled();
});
it('rejects malformed update UUID before backend access', async () => {
  expect(await updateProject({}, form({ ...validInput, projectId: '-'.repeat(36) }))).toHaveProperty('error');
  expect(mocks.createClient).not.toHaveBeenCalled();
});
