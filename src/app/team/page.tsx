import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getOrganizations } from '@/lib/projects';
import { TeamWorkspace } from '@/components/team-workspace';
import { getCurrentProfile } from '@/lib/profile';
import { translate } from '@/lib/i18n/messages';

export default async function TeamPage({ searchParams }: { searchParams: Promise<{ organization?: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=%2Fteam');
  const profile = await getCurrentProfile(user); const locale = profile?.language ?? 'ru'; const t = (key: Parameters<typeof translate>[1]) => translate(locale, key);

  const organizations = await getOrganizations();
  const params = await searchParams;
  const selected = organizations.find((organization) => organization.id === params.organization) ?? organizations[0];
  if (!selected) return <main className="page migration-page team-page"><small>{t('team.eyebrow')}</small><h1>{t('team.title')}</h1><p>{t('team.createOrganization')}</p><a className="cta" href="/onboarding"><span>{t('team.createOrganizationButton')}</span></a></main>;

  const managers = selected.role === 'owner' || selected.role === 'admin';
  const [rosterResult, inviteResult, projectResult, projectOwnerResult] = await Promise.all([
    managers ? supabase.rpc('list_team_members', { target_organization_id: selected.id }) : Promise.resolve({ data: null, error: null }),
    managers ? supabase.from('team_invitations').select('id,email,organization_role,project_role,project_id,expires_at,created_at').eq('organization_id', selected.id).is('accepted_at', null).is('revoked_at', null).gt('expires_at', new Date().toISOString()).order('created_at', { ascending: false }) : Promise.resolve({ data: null, error: null }),
    supabase.from('projects').select('id,name').eq('organization_id', selected.id).order('name'),
    supabase.from('project_members').select('project_id').eq('user_id', user.id).eq('role', 'owner'),
  ]);
  const projectIds = (inviteResult.data ?? []).flatMap((invite) => invite.project_id ? [invite.project_id] : []);
  const projects = projectIds.length ? await supabase.from('projects').select('id,name').in('id', [...new Set(projectIds)]) : { data: [] };
  const projectNames = new Map((projects.data ?? []).map((project) => [project.id, project.name]));
  const ownedProjectIds = new Set((projectOwnerResult.data ?? []).map((membership) => membership.project_id));
  const manageableProjects = (projectResult.data ?? []).filter((project) => ownedProjectIds.has(project.id));

  return <main className="page migration-page team-page">
    <small>{t('team.organization')} · {selected.role.toUpperCase()}</small><h1>{t('team.eyebrow')}</h1>
    <p className="subtitle">{t('team.subtitle')}</p>
    {organizations.length > 1 && <nav className="team-org-switcher" aria-label={t('team.organizations')}>{organizations.map((organization) => <a key={organization.id} aria-current={organization.id === selected.id ? 'page' : undefined} href={`/team?organization=${organization.id}`}>{organization.name}</a>)}</nav>}
    <TeamWorkspace organizationId={selected.id} organizationRole={selected.role} canViewOrganizationTeam={managers} canManageOrganizationTeam={selected.role === 'owner'} projects={projectResult.data ?? []} manageableProjects={manageableProjects} roster={rosterResult.data ?? []} invitations={(inviteResult.data ?? []).map((invite) => ({ ...invite, projectName: invite.project_id ? projectNames.get(invite.project_id) ?? t('team.project') : null }))} />
  </main>;
}
