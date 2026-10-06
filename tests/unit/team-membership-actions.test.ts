import { beforeEach, describe, expect, it, vi } from 'vitest';
import { removeOrganizationMember, removeProjectMember, updateOrganizationMemberRole, updateProjectMemberRole } from '@/actions/team';

const mocks = vi.hoisted(() => ({ client: vi.fn(), revalidate: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.client }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));

const organizationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const projectId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const userId = '22222222-2222-4222-8222-222222222222';
function form(values: Record<string, string>) { const data = new FormData(); Object.entries(values).forEach(([key, value]) => data.set(key, value)); return data; }
function setup({ user = true, data = { user_id: userId }, error = null }: { user?: boolean; data?: { user_id: string } | null; error?: { code?: string; message?: string } | null } = {}) {
  const query = { eq: vi.fn(), select: vi.fn(), maybeSingle: vi.fn() };
  query.eq.mockReturnValue(query); query.select.mockReturnValue(query); query.maybeSingle.mockResolvedValue({ data, error });
  const update = vi.fn(() => query); const remove = vi.fn(() => query);
  const client = { auth: { getUser: vi.fn().mockResolvedValue({ data: { user: user ? { id: 'current-user' } : null }, error: null }) }, from: vi.fn(() => ({ update, delete: remove })) };
  mocks.client.mockResolvedValue(client);
  return { client, update, remove, query };
}
beforeEach(() => vi.resetAllMocks());

describe('team membership actions', () => {
  it('rejects malformed roles and identifiers before creating a database client', async () => {
    await expect(updateOrganizationMemberRole({}, form({ organizationId, userId, role: 'superadmin' }))).resolves.toEqual({ error: 'invalid' });
    await expect(removeProjectMember({}, form({ projectId: 'bad', userId }))).resolves.toEqual({ error: 'invalid' });
    expect(mocks.client).not.toHaveBeenCalled();
  });

  it('requires a current authenticated user for membership changes', async () => {
    const client = setup({ user: false });
    await expect(updateProjectMemberRole({}, form({ projectId, userId, role: 'editor' }))).resolves.toEqual({ error: 'auth' });
    expect(client.update).not.toHaveBeenCalled();
  });

  it('uses caller-session RLS for role updates and revalidates on a returned row', async () => {
    const client = setup();
    await expect(updateOrganizationMemberRole({}, form({ organizationId, userId, role: 'admin' }))).resolves.toEqual({ success: 'roleSaved' });
    expect(client.client.from).toHaveBeenCalledWith('organization_members');
    expect(client.update).toHaveBeenCalledWith({ role: 'admin' });
    expect(client.query.eq).toHaveBeenNthCalledWith(1, 'organization_id', organizationId);
    expect(client.query.eq).toHaveBeenNthCalledWith(2, 'user_id', userId);
    expect(mocks.revalidate).toHaveBeenCalledWith('/team');
  });

  it('maps the database last-owner invariant to a generic actionable status', async () => {
    const client = setup({ error: { code: '23514', message: 'private trigger details' } });
    const result = await removeOrganizationMember({}, form({ organizationId, userId }));
    expect(result).toEqual({ error: 'ownerInvariant' });
    expect(JSON.stringify(result)).not.toContain('private trigger details');
    expect(client.remove).toHaveBeenCalledOnce();
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });

  it('fails closed on RLS zero-row and other database errors for removals', async () => {
    setup({ data: null });
    expect(await removeProjectMember({}, form({ projectId, userId }))).toEqual({ error: 'failed' });
    setup({ error: { code: '42501', message: 'private RLS details' } });
    const result = await updateProjectMemberRole({}, form({ projectId, userId, role: 'viewer' }));
    expect(result).toEqual({ error: 'failed' });
    expect(JSON.stringify(result)).not.toContain('private RLS details');
  });
});
