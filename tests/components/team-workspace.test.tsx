// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
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
