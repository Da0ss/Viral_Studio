// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocaleProvider } from '@/components/locale-provider';
import { TeamWorkspace } from '@/components/team-workspace';

const mocks = vi.hoisted(() => ({ roster: vi.fn() }));
vi.mock('@/actions/team', () => ({
  acceptTeamInvitation: vi.fn(), createTeamInvitation: vi.fn(), revokeTeamInvitation: vi.fn(),
  removeOrganizationMember: vi.fn(), removeProjectMember: vi.fn(), updateOrganizationMemberRole: vi.fn(), updateProjectMemberRole: vi.fn(),
  getProjectTeamMembers: mocks.roster,
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });

it('submits member access for a project invitation and restores organization access when deselected', () => {
  const { container } = render(<LocaleProvider locale="en"><TeamWorkspace organizationId="org" organizationRole="owner"
    canViewOrganizationTeam canManageOrganizationTeam projects={[{ id: 'project', name: 'Campaign' }]}
    manageableProjects={[]} roster={[]} invitations={[]} /></LocaleProvider>);
  const form = container.querySelector<HTMLFormElement>('.team-invite-form')!;
  const organizationRole = form.elements.namedItem('organizationRole') as HTMLSelectElement;
  const project = form.elements.namedItem('projectId') as HTMLSelectElement;
  fireEvent.change(organizationRole, { target: { value: 'admin' } });
  fireEvent.change(project, { target: { value: 'project' } });
  const projectRole = form.elements.namedItem('projectRole') as HTMLSelectElement;
  fireEvent.change(projectRole, { target: { value: 'editor' } });
  expect(organizationRole.disabled).toBe(true);
  const projectInvitation = new FormData(form);
  expect(projectInvitation.getAll('organizationRole')).toEqual(['member']);
  expect(projectInvitation.get('projectId')).toBe('project');
  expect(projectInvitation.get('projectRole')).toBe('editor');
  fireEvent.change(project, { target: { value: '' } });
  expect(organizationRole.disabled).toBe(false);
  const organizationInvitation = new FormData(form);
  expect(organizationInvitation.getAll('organizationRole')).toEqual(['admin']);
  expect(organizationInvitation.has('projectRole')).toBe(false);
});

it('shows a safe error and stops loading when the project roster request rejects', async () => {
  mocks.roster.mockRejectedValue(new Error('private database detail'));
  render(<LocaleProvider locale="en"><TeamWorkspace organizationId="org" organizationRole="member"
    canViewOrganizationTeam={false} canManageOrganizationTeam={false} projects={[]}
    manageableProjects={[{ id: 'project', name: 'Campaign' }]} roster={[]} invitations={[]} /></LocaleProvider>);
  await screen.findByRole('alert');
  expect(screen.getByRole('alert').textContent).not.toContain('private database detail');
  expect(screen.queryByRole('status')).toBeNull();
});

it.each([
  ['ru', 'Владелец', 'Комментарии', 'УЧАСТНИКИ ПРОЕКТА'],
  ['en', 'Owner', 'Commenter', 'PROJECT MEMBERS'],
  ['kk', 'Иесі', 'Пікір жазу', 'ЖОБА ҚАТЫСУШЫЛАРЫ'],
] as const)('localizes project roles and member controls in %s', async (locale, ownerLabel, commenterLabel, sectionLabel) => {
  mocks.roster.mockResolvedValue({ members: [
    { user_id: 'owner', name: 'Owner', email: 'owner@example.invalid', role: 'owner', joined_at: new Date().toISOString() },
    { user_id: 'member', name: 'Member', email: 'member@example.invalid', role: 'commenter', joined_at: new Date().toISOString() },
  ] });
  render(<LocaleProvider locale={locale}><TeamWorkspace
    organizationId="org" organizationRole="member" canViewOrganizationTeam={false} canManageOrganizationTeam={false}
    projects={[]} manageableProjects={[{ id: 'project', name: 'Campaign' }]} roster={[]} invitations={[]}
  /></LocaleProvider>);
  await waitFor(() => expect(screen.getByText(ownerLabel, { selector: '.team-role' })).toBeTruthy());
  expect(screen.getByText(commenterLabel, { selector: '.team-role' })).toBeTruthy();
  expect(screen.getByRole('heading', { name: sectionLabel })).toBeTruthy();
  expect(screen.getAllByRole('button', { name: locale === 'en' ? 'Save role' : locale === 'kk' ? 'Рөлді сақтау' : 'Сохранить роль' })).toHaveLength(2);
});

describe('section load errors', () => {
  const base = { organizationId: 'org', organizationRole: 'owner' as const, canViewOrganizationTeam: true, canManageOrganizationTeam: true,
    projects: [], manageableProjects: [], roster: [], invitations: [] };

  it('shows an error with retry instead of "no pending invitations" when the request failed', () => {
    render(<LocaleProvider locale="en"><TeamWorkspace {...base} loadErrors={{ invitations: true }} /></LocaleProvider>);
    expect(screen.getByRole('alert').textContent).toContain('Could not load invitations');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    expect(screen.queryByText('No active invitations.')).toBeNull();
  });

  it('distinguishes a successful empty roster from a failed roster request', () => {
    const { unmount } = render(<LocaleProvider locale="en"><TeamWorkspace {...base} /></LocaleProvider>);
    expect(screen.getByText('There are no members in this organization yet.')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    unmount();
    render(<LocaleProvider locale="en"><TeamWorkspace {...base} loadErrors={{ roster: true }} /></LocaleProvider>);
    expect(screen.getByRole('alert').textContent).toContain('Could not load the team');
  });

  it('explains to an admin without owned projects why project management is missing', () => {
    render(<LocaleProvider locale="en"><TeamWorkspace {...base} organizationRole="admin" canManageOrganizationTeam={false} /></LocaleProvider>);
    expect(screen.getByText('You do not own any projects with member management.')).toBeTruthy();
    expect(mocks.roster).not.toHaveBeenCalled();
  });

  it('surfaces a failed project request to a member instead of the member-only notice', () => {
    render(<LocaleProvider locale="en"><TeamWorkspace {...base} organizationRole="member" canViewOrganizationTeam={false} canManageOrganizationTeam={false} loadErrors={{ projects: true }} /></LocaleProvider>);
    expect(screen.getByRole('alert').textContent).toContain("Could not load the organization's projects.");
  });
});
