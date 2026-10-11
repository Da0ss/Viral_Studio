import { beforeEach, describe, expect, it, vi } from 'vitest';
import TeamPage from '@/app/team/page';
import { getOrganizations } from '@/lib/projects';

const mocks = vi.hoisted(() => ({
  client: vi.fn(),
  currentUser: vi.fn(),
  profile: vi.fn(),
  redirect: vi.fn((path: string) => { throw new Error(`NEXT_REDIRECT:${path}`); }),
  workspace: vi.fn(() => null),
}));

vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.client, getCurrentUser: mocks.currentUser }));
vi.mock('@/lib/profile', () => ({ getCurrentProfile: mocks.profile }));
vi.mock('@/components/team-workspace', () => ({ TeamWorkspace: mocks.workspace }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));

type QueryResult = { data: unknown[] | null; error: { code?: string } | null };

function query(result: QueryResult) {
  const chain: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'is', 'gt', 'order', 'in']) chain[method] = vi.fn(() => chain);
  chain.then = (resolve: (value: QueryResult) => unknown) => Promise.resolve(result).then(resolve);
  return chain;
}

function setup(options: {
  authError?: boolean;
  organizations?: QueryResult;
  roster?: QueryResult;
  invitations?: QueryResult;
  projects?: QueryResult;
  ownedProjects?: QueryResult;
} = {}) {
  const results = {
    organizations: query(options.organizations ?? { data: [{ organization_id: 'org-1', role: 'owner', organizations: { name: 'Studio' } }], error: null }),
    invitations: query(options.invitations ?? { data: [], error: null }),
    projects: query(options.projects ?? { data: [{ id: 'project-1', name: 'Campaign' }], error: null }),
    ownedProjects: query(options.ownedProjects ?? { data: [{ project_id: 'project-1' }], error: null }),
  };
  const client = {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: options.authError ? null : { id: 'user-1' } }, error: options.authError ? { message: 'private auth details' } : null }) },
    rpc: vi.fn().mockResolvedValue(options.roster ?? { data: [], error: null }),
    from: vi.fn((table: string) => {
      if (table === 'organization_members') return results.organizations;
      if (table === 'team_invitations') return results.invitations;
      if (table === 'projects') return results.projects;
      if (table === 'project_members') return results.ownedProjects;
      throw new Error(`Unexpected table: ${table}`);
    }),
  };
  mocks.client.mockResolvedValue(client);
  return { client };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.currentUser.mockResolvedValue({ id: 'user-1' });
  mocks.profile.mockResolvedValue({ language: 'ru' });
});

describe('team server loader', () => {
  it('routes an Auth lookup failure through the server error boundary', async () => {
    const { client } = setup({ authError: true });
    await expect(TeamPage({ searchParams: Promise.resolve({}) })).rejects.toThrow('Team authentication lookup failed');
    expect(client.from).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it('does not turn an organization membership query failure into onboarding', async () => {
    const { client } = setup({ organizations: { data: null, error: { code: 'PGRST205' } } });
    await expect(TeamPage({ searchParams: Promise.resolve({}) })).rejects.toThrow('Team organization lookup failed');
    expect(client.rpc).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it('throws loudly when the team roster RPC schema is unavailable', async () => {
    setup({ roster: { data: null, error: { code: 'PGRST202' } } });
    await expect(TeamPage({ searchParams: Promise.resolve({}) })).rejects.toThrow('Team workspace lookup failed');
    expect(mocks.workspace).not.toHaveBeenCalled();
  });

  it('preserves a real empty roster as a successful empty result', async () => {
    setup();
    const page = await TeamPage({ searchParams: Promise.resolve({}) });
    const children = Array.isArray(page.props.children) ? page.props.children : [page.props.children];
    const workspace = children.find((child: { type?: unknown }) => child?.type === mocks.workspace) as { props: { roster: unknown; projects: unknown } } | undefined;
    expect(workspace).toBeTruthy();
    expect(workspace.props.roster).toEqual([]);
    expect(workspace.props.projects).toEqual([{ id: 'project-1', name: 'Campaign' }]);
  });

  it('keeps existing getOrganizations callers fail-closed on backend errors', async () => {
    setup({ organizations: { data: null, error: { code: 'PGRST205' } } });
    await expect(getOrganizations()).rejects.toThrow('Organization membership lookup failed');
  });
});
