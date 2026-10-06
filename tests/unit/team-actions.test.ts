import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { acceptTeamInvitation, createTeamInvitation, revokeTeamInvitation } from '@/actions/team';

const mocks = vi.hoisted(() => ({ client: vi.fn(), revalidate: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.client }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));

const organizationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const invitationId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
function form(values: Record<string, string>) {
  const data = new FormData();
  Object.entries(values).forEach(([key, value]) => data.set(key, value));
  return data;
}
function setup({ user = true, insertError = null, rpcData = true, rpcError = null } = {}) {
  const insert = vi.fn().mockResolvedValue({ error: insertError });
  const rpc = vi.fn().mockResolvedValue({ data: rpcData, error: rpcError });
  const getUser = vi.fn().mockResolvedValue({ data: { user: user ? { id: 'current-user', email: 'member@example.invalid' } : null }, error: null });
  mocks.client.mockResolvedValue({ auth: { getUser }, from: vi.fn(() => ({ insert })), rpc });
  return { insert, rpc, getUser };
}
beforeEach(() => vi.resetAllMocks());

describe('team invitation actions', () => {
  it('rejects malformed invitation fields before touching Supabase', async () => {
    expect(await createTeamInvitation({}, form({ organizationId: 'bad', projectId: '', email: 'invalid', organizationRole: 'owner', projectRole: '' }))).toHaveProperty('error');
    expect(mocks.client).not.toHaveBeenCalled();
  });

  it('requires authentication and does not insert for guests', async () => {
    const client = setup({ user: false });
    expect(await createTeamInvitation({}, form({ organizationId, projectId: '', email: 'person@example.invalid', organizationRole: 'member', projectRole: '' }))).toHaveProperty('error');
    expect(client.insert).not.toHaveBeenCalled();
  });

  it('stores only a SHA-256 token hash and returns the one-time raw link', async () => {
    const client = setup();
    const result = await createTeamInvitation({}, form({ organizationId, projectId: '', email: 'Person@example.invalid', organizationRole: 'member', projectRole: '' }));
    const row = client.insert.mock.calls[0][0];
    const token = new URL(`https://example.invalid${result.invitePath}`).searchParams.get('token') ?? '';
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(row).toMatchObject({ organization_id: organizationId, email: 'person@example.invalid', organization_role: 'member', project_id: null, project_role: null, invited_by: 'current-user' });
    expect(row.token_hash).toBe(createHash('sha256').update(token).digest('hex'));
    expect(JSON.stringify(row)).not.toContain(token);
    expect(mocks.revalidate).toHaveBeenCalledWith('/team');
  });

  it('does not grant organization admin through a project-scoped invite', async () => {
    setup();
    const result = await createTeamInvitation({}, form({ organizationId, projectId: invitationId, email: 'person@example.invalid', organizationRole: 'admin', projectRole: 'editor' }));
    expect(result).toHaveProperty('error');
    expect(mocks.client).not.toHaveBeenCalled();
  });

  it('returns generic errors for backend rejection and does not revalidate', async () => {
    const client = setup({ insertError: { message: 'private SQL detail' } });
    const result = await createTeamInvitation({}, form({ organizationId, projectId: '', email: 'person@example.invalid', organizationRole: 'member', projectRole: '' }));
    expect(result).toHaveProperty('error');
    expect(JSON.stringify(result)).not.toContain('private SQL detail');
    expect(mocks.revalidate).not.toHaveBeenCalled();
    expect(client.insert).toHaveBeenCalledTimes(1);
  });

  it('requires an authenticated user before accepting or revoking', async () => {
    const client = setup({ user: false });
    expect(await acceptTeamInvitation({}, form({ token: 'a'.repeat(43) }))).toHaveProperty('error');
    expect(await revokeTeamInvitation({}, form({ invitationId }))).toHaveProperty('error');
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it('passes only the token hash to the accept RPC', async () => {
    const client = setup({ rpcData: [{ organization_id: organizationId, project_id: null }] });
    const token = 'abcDEF0123456789_-'.repeat(2).concat('abcDEF0123456');
    const candidate = token.slice(0, 43);
    expect(candidate).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await acceptTeamInvitation({}, form({ token: candidate }))).toHaveProperty('success');
    expect(client.rpc).toHaveBeenCalledWith('accept_team_invitation', { target_token_hash: createHash('sha256').update(candidate).digest('hex') });
    expect(JSON.stringify(client.rpc.mock.calls)).not.toContain(candidate);
  });

  it('accepts only a successful revoke response', async () => {
    const client = setup({ rpcData: false });
    expect(await revokeTeamInvitation({}, form({ invitationId }))).toHaveProperty('error');
    expect(client.rpc).toHaveBeenCalledWith('revoke_team_invitation', { target_invitation_id: invitationId });
  });
});
