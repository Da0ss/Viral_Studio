'use client';

import { useActionState, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { acceptTeamInvitation, createTeamInvitation, getProjectTeamMembers, removeOrganizationMember, removeProjectMember, revokeTeamInvitation, updateOrganizationMemberRole, updateProjectMemberRole, type ProjectTeamMember } from '@/actions/team';
import { useI18n } from '@/components/locale-provider';

type ProjectOption = { id: string; name: string };
type TeamMember = { user_id: string; name: string; email: string; role: 'owner' | 'admin' | 'member'; joined_at: string };
type PendingInvitation = { id: string; email: string; organization_role: 'admin' | 'member'; project_role: 'owner' | 'editor' | 'commenter' | 'viewer' | null; project_id: string | null; expires_at: string; created_at: string; projectName: string | null };

export function TeamWorkspace({ organizationId, organizationRole, projects, roster, invitations, canViewOrganizationTeam, canManageOrganizationTeam, manageableProjects }: {
  organizationId: string;
  organizationRole: 'owner' | 'admin' | 'member';
  projects: ProjectOption[];
  roster: TeamMember[];
  invitations: PendingInvitation[];
  canViewOrganizationTeam: boolean;
  canManageOrganizationTeam: boolean;
  manageableProjects: ProjectOption[];
}) {
  const { t } = useI18n();
  return <div className="team-workspace">
    {canViewOrganizationTeam && <><section className="team-section"><div><small>{t('team.title')}</small><h2>{t('team.access')}</h2></div>
      {roster.length ? <div className="team-roster">{roster.map((member) => <article className="team-member" key={member.user_id}>
        <span className="team-avatar" aria-hidden="true">{(member.name || member.email).slice(0, 1).toUpperCase()}</span>
        <div><strong>{member.name || t('team.noName')}</strong><small>{member.email}</small></div>
        <span className={`team-role team-role--${member.role}`}>{t(`team.${member.role}`)}</span>
        {canManageOrganizationTeam && <OrganizationMemberControls organizationId={organizationId} member={member} />}
      </article>)}</div> : <p>{t('team.rosterError')}</p>}
    </section>
    <section className="team-section"><div><small>{t('team.newInvite')}</small><h2>{t('team.addMember')}</h2></div>
      <InviteForm organizationId={organizationId} organizationRole={organizationRole} projects={projects} />
    </section>
    <section className="team-section"><div><small>{t('team.pending')}</small><h2>{t('team.invitations')}</h2></div>
      {invitations.length ? <div className="team-invitations">{invitations.map((invite) => <Invitation key={invite.id} invite={invite} />)}</div> : <p>{t('team.nonePending')}</p>}
    </section></>}
    {manageableProjects.length > 0 ? <ProjectTeamManagement projects={manageableProjects} /> : !canViewOrganizationTeam && <section className="team-notice"><h2>{t('team.memberRole')}</h2><p>{t('team.memberOnly')}</p></section>}
  </div>;
}

function MutationFeedback({ error, success }: { error?: string; success?: string }) {
  const { t } = useI18n();
  return <>{error && <p role="alert">{t(error === 'ownerInvariant' ? 'team.ownerInvariant' : 'team.memberMutationFailed')}</p>}{success && <p role="status">{t(success === 'memberRemoved' ? 'team.memberRemoved' : 'team.roleSaved')}</p>}</>;
}

function OrganizationMemberControls({ organizationId, member }: { organizationId: string; member: TeamMember }) {
  const { t } = useI18n(); const router = useRouter();
  const [roleState, roleAction, rolePending] = useActionState(updateOrganizationMemberRole, {});
  const [removeState, removeAction, removePending] = useActionState(removeOrganizationMember, {});
  useEffect(() => { if (roleState.success || removeState.success) router.refresh(); }, [roleState.success, removeState.success, router]);
  return <div className="team-member__controls"><form action={roleAction}>
    <input type="hidden" name="organizationId" value={organizationId} /><input type="hidden" name="userId" value={member.user_id} />
    <label>{t('team.orgRole')}<select name="role" defaultValue={member.role} disabled={rolePending || removePending}><option value="owner">{t('team.owner')}</option><option value="admin">{t('team.admin')}</option><option value="member">{t('team.member')}</option></select></label>
    <button className="ghost-button" disabled={rolePending || removePending}>{rolePending ? t('common.saving') : t('team.saveRole')}</button>
    <MutationFeedback error={roleState.error} success={roleState.success} />
  </form><form action={removeAction} onSubmit={event => { if (!window.confirm(t('team.removeOrgConfirm'))) event.preventDefault(); }}>
    <input type="hidden" name="organizationId" value={organizationId} /><input type="hidden" name="userId" value={member.user_id} />
    <button className="text-button danger" disabled={rolePending || removePending}>{removePending ? t('common.deleting') : t('team.removeMember')}</button>
    <MutationFeedback error={removeState.error} success={removeState.success} />
  </form></div>;
}

function ProjectTeamManagement({ projects }: { projects: ProjectOption[] }) {
  const { t } = useI18n();
  const [projectId, setProjectId] = useState(projects[0]?.id ?? '');
  const [result, setResult] = useState<{ key: string; members: ProjectTeamMember[]; error: boolean } | null>(null);
  const [revision, setRevision] = useState(0);
  const markChanged = useCallback(() => setRevision(value => value + 1), []);
  const request = useRef(0);
  const selectedProjectId = projects.some(project => project.id === projectId) ? projectId : projects[0]?.id ?? '';
  const resultKey = `${selectedProjectId}:${revision}`;
  const currentResult = result?.key === resultKey ? result : null;
  const members = currentResult?.members ?? [];
  const loading = Boolean(selectedProjectId) && !currentResult;
  const loadError = currentResult?.error ?? false;
  useEffect(() => {
    if (!selectedProjectId) return;
    const version = ++request.current; let cancelled = false;
    void getProjectTeamMembers(selectedProjectId).then(response => {
      if (cancelled || request.current !== version) return;
      setResult({ key: resultKey, members: response.members, error: Boolean(response.error) });
    }).catch(() => {
      if (cancelled || request.current !== version) return;
      setResult({ key: resultKey, members: [], error: true });
    });
    return () => { cancelled = true; };
  }, [selectedProjectId, resultKey]);
  return <section className="team-section"><div><small>{t('team.projectAccess')}</small><h2>{t('team.projectMembers')}</h2></div>
    <label>{t('team.chooseProject')}<select value={selectedProjectId} onChange={event => setProjectId(event.currentTarget.value)}>{projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
    {loading && <p role="status">{t('chat.loading')}</p>}
    {loadError && <p role="alert">{t('team.projectListError')}</p>}
    {!loading && !loadError && (members.length ? <div className="team-roster">{members.map(member => <article className="team-member" key={`${selectedProjectId}:${member.user_id}`}>
      <span className="team-avatar" aria-hidden="true">{(member.name || member.email).slice(0, 1).toUpperCase()}</span><div><strong>{member.name || t('team.noName')}</strong><small>{member.email}</small></div><span className={`team-role team-role--${member.role}`}>{t(`team.projectRole.${member.role}` as 'team.projectRole.owner' | 'team.projectRole.editor' | 'team.projectRole.commenter' | 'team.projectRole.viewer')}</span>
      <ProjectMemberControls projectId={selectedProjectId} member={member} onChange={markChanged} />
    </article>)}</div> : <p>{t('team.noProjectMembers')}</p>)}
  </section>;
}

function ProjectMemberControls({ projectId, member, onChange }: { projectId: string; member: ProjectTeamMember; onChange: () => void }) {
  const { t } = useI18n(); const router = useRouter();
  const [roleState, roleAction, rolePending] = useActionState(updateProjectMemberRole, {});
  const [removeState, removeAction, removePending] = useActionState(removeProjectMember, {});
  useEffect(() => { if (roleState.success || removeState.success) { onChange(); router.refresh(); } }, [roleState.success, removeState.success, onChange, router]);
  return <div className="team-member__controls"><form action={roleAction}>
    <input type="hidden" name="projectId" value={projectId} /><input type="hidden" name="userId" value={member.user_id} />
    <label>{t('team.projectRoleLabel')}<select name="role" defaultValue={member.role} disabled={rolePending || removePending}><option value="owner">{t('team.projectRole.owner')}</option><option value="editor">{t('team.projectRole.editor')}</option><option value="commenter">{t('team.projectRole.commenter')}</option><option value="viewer">{t('team.projectRole.viewer')}</option></select></label>
    <button className="ghost-button" disabled={rolePending || removePending}>{rolePending ? t('common.saving') : t('team.saveRole')}</button><MutationFeedback error={roleState.error} success={roleState.success} />
  </form><form action={removeAction} onSubmit={event => { if (!window.confirm(t('team.removeProjectConfirm'))) event.preventDefault(); }}>
    <input type="hidden" name="projectId" value={projectId} /><input type="hidden" name="userId" value={member.user_id} />
    <button className="text-button danger" disabled={rolePending || removePending}>{removePending ? t('common.deleting') : t('team.removeMember')}</button><MutationFeedback error={removeState.error} success={removeState.success} />
  </form></div>;
}

function InviteForm({ organizationId, organizationRole, projects }: { organizationId: string; organizationRole: 'owner' | 'admin' | 'member'; projects: ProjectOption[] }) {
  const { t } = useI18n();
  const [state, action, pending] = useActionState(createTeamInvitation, {});
  const [projectId, setProjectId] = useState('');
  const [copied, setCopied] = useState(false);
  const invitationUrl = state.invitePath && typeof window !== 'undefined' ? new URL(state.invitePath, window.location.origin).toString() : '';
  return <form className="team-invite-form" action={action}>
    <input type="hidden" name="organizationId" value={organizationId} />
    <label>{t('team.email')}<input name="email" type="email" autoComplete="email" required maxLength={320} disabled={pending || Boolean(state.invitePath)} /></label>
    <label>{t('team.accessLabel')}<select name="organizationRole" disabled={pending || Boolean(state.invitePath) || Boolean(projectId)} defaultValue="member"><option value="member">{t('team.orgMember')}</option>{organizationRole === 'owner' && <option value="admin">{t('team.orgAdmin')}</option>}</select></label>
    <label>{t('team.projectOptional')}<select name="projectId" value={projectId} disabled={pending || Boolean(state.invitePath)} onChange={(event) => setProjectId(event.currentTarget.value)}><option value="">{t('team.wholeOrg')}</option>{projects.map((project) => <option value={project.id} key={project.id}>{project.name}</option>)}</select></label>
    {projectId && <label>{t('team.project')}<select name="projectRole" defaultValue="viewer" disabled={pending || Boolean(state.invitePath)}><option value="viewer">{t('team.projectViewer')}</option><option value="commenter">{t('team.projectCommenter')}</option><option value="editor">{t('team.projectEditor')}</option></select></label>}
    {state.error && <p role="alert">{state.error}</p>}
    {state.success && <p role="status">{state.success}</p>}
    {state.invitePath ? <div className="team-invite-link"><input aria-label={t('team.invitationLink')} readOnly value={invitationUrl} onFocus={(event) => event.currentTarget.select()} /><button type="button" className="ghost-button" onClick={() => { void navigator.clipboard.writeText(invitationUrl).then(() => setCopied(true)).catch(() => setCopied(false)); }}>{copied ? t('team.copied') : t('team.copyLink')}</button></div> : <button className="cta" disabled={pending}><span>{pending ? t('team.creating') : t('team.createInvite')}</span></button>}
  </form>;
}

function Invitation({ invite }: { invite: PendingInvitation }) {
  const { locale, t } = useI18n();
  const [state, action, pending] = useActionState(revokeTeamInvitation, {});
  const projectRole = invite.project_role ? t(`team.projectRole.${invite.project_role}` as 'team.projectRole.owner' | 'team.projectRole.editor' | 'team.projectRole.commenter' | 'team.projectRole.viewer') : null;
  return <article className="team-invitation"><div><strong>{invite.email}</strong><small>{invite.projectName ? `${invite.projectName} · ${projectRole}` : invite.organization_role === 'admin' ? t('team.orgAdmin') : t('team.orgMember')} · {t('team.validUntil',{date:new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(invite.expires_at))})}</small></div>
    <form action={action}><input type="hidden" name="invitationId" value={invite.id} /><button className="text-button danger" disabled={pending}>{pending ? t('team.revoking') : t('team.revoke')}</button>{state.error && <small role="alert">{state.error}</small>}{state.success && <small role="status">{state.success}</small>}</form>
  </article>;
}

export function AcceptTeamInvitation({ token }: { token: string }) {
  const { t } = useI18n();
  const [state, action, pending] = useActionState(acceptTeamInvitation, {});
  return <form className="team-accept-card" action={action}>
    <input type="hidden" name="token" value={token} />
    <small>{t('team.inviteTitle')}</small><h1>{t('team.join')}</h1>
    <p>{t('team.joinHelp')}</p>
    {state.error && <p role="alert">{state.error}</p>}{state.success && <p role="status">{state.success}</p>}
    {state.success ? <a className="cta" href="/team"><span>{t('team.openTeam')}</span></a> : <button className="cta" disabled={pending}><span>{pending ? t('team.checking') : t('team.acceptInvite')}</span></button>}
  </form>;
}
