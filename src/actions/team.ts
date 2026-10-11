'use server';

import { createHash, randomBytes } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

type TeamActionState = { error?: string; success?: string; invitePath?: string };
export type TeamMutationState = { error?: 'invalid' | 'auth' | 'ownerInvariant' | 'failed'; success?: 'roleSaved' | 'memberRemoved' };
export type ProjectTeamMember = { user_id: string; name: string; email: string; role: 'owner' | 'editor' | 'commenter' | 'viewer'; joined_at: string };

const invitationSchema = z.object({
  organizationId: z.string().uuid(),
  projectId: z.union([z.literal(''), z.string().uuid()]),
  email: z.string().trim().toLowerCase().email().max(320),
  organizationRole: z.enum(['member', 'admin']),
  projectRole: z.enum(['viewer', 'commenter', 'editor', '']).optional(),
});

function value(form: FormData, name: string) {
  const field = form.get(name);
  return typeof field === 'string' ? field : '';
}

const organizationMemberSchema = z.object({ organizationId: z.string().uuid(), userId: z.string().uuid(), role: z.enum(['owner', 'admin', 'member']) });
const projectMemberSchema = z.object({ projectId: z.string().uuid(), userId: z.string().uuid(), role: z.enum(['owner', 'editor', 'commenter', 'viewer']) });
const teamMemberTargetSchema = z.object({ organizationId: z.string().uuid(), userId: z.string().uuid() });
const projectMemberTargetSchema = z.object({ projectId: z.string().uuid(), userId: z.string().uuid() });

function isLastOwnerViolation(code?: string) { return code === '23514'; }

export async function updateOrganizationMemberRole(_: TeamMutationState, form: FormData): Promise<TeamMutationState> {
  const input = organizationMemberSchema.safeParse({ organizationId: value(form, 'organizationId'), userId: value(form, 'userId'), role: value(form, 'role') });
  if (!input.success) return { error: 'invalid' };
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return { error: 'auth' };
    const { data, error } = await supabase.from('organization_members').update({ role: input.data.role })
      .eq('organization_id', input.data.organizationId).eq('user_id', input.data.userId).select('user_id').maybeSingle();
    if (error) return { error: isLastOwnerViolation(error.code) ? 'ownerInvariant' : 'failed' };
    if (!data) return { error: 'failed' };
    revalidatePath('/team'); revalidatePath('/projects');
    return { success: 'roleSaved' };
  } catch (error) {
    const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : undefined;
    return { error: isLastOwnerViolation(code) ? 'ownerInvariant' : 'failed' };
  }
}

export async function removeOrganizationMember(_: TeamMutationState, form: FormData): Promise<TeamMutationState> {
  const input = teamMemberTargetSchema.safeParse({ organizationId: value(form, 'organizationId'), userId: value(form, 'userId') });
  if (!input.success) return { error: 'invalid' };
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return { error: 'auth' };
    const { data, error } = await supabase.from('organization_members').delete()
      .eq('organization_id', input.data.organizationId).eq('user_id', input.data.userId).select('user_id').maybeSingle();
    if (error) return { error: isLastOwnerViolation(error.code) ? 'ownerInvariant' : 'failed' };
    if (!data) return { error: 'failed' };
    revalidatePath('/team'); revalidatePath('/projects');
    return { success: 'memberRemoved' };
  } catch (error) {
    const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : undefined;
    return { error: isLastOwnerViolation(code) ? 'ownerInvariant' : 'failed' };
  }
}

export async function updateProjectMemberRole(_: TeamMutationState, form: FormData): Promise<TeamMutationState> {
  const input = projectMemberSchema.safeParse({ projectId: value(form, 'projectId'), userId: value(form, 'userId'), role: value(form, 'role') });
  if (!input.success) return { error: 'invalid' };
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return { error: 'auth' };
    const { data, error } = await supabase.from('project_members').update({ role: input.data.role })
      .eq('project_id', input.data.projectId).eq('user_id', input.data.userId).select('user_id').maybeSingle();
    if (error) return { error: isLastOwnerViolation(error.code) ? 'ownerInvariant' : 'failed' };
    if (!data) return { error: 'failed' };
    revalidatePath('/team'); revalidatePath(`/projects/${input.data.projectId}/chat`);
    return { success: 'roleSaved' };
  } catch (error) {
    const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : undefined;
    return { error: isLastOwnerViolation(code) ? 'ownerInvariant' : 'failed' };
  }
}

export async function removeProjectMember(_: TeamMutationState, form: FormData): Promise<TeamMutationState> {
  const input = projectMemberTargetSchema.safeParse({ projectId: value(form, 'projectId'), userId: value(form, 'userId') });
  if (!input.success) return { error: 'invalid' };
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return { error: 'auth' };
    const { data, error } = await supabase.from('project_members').delete()
      .eq('project_id', input.data.projectId).eq('user_id', input.data.userId).select('user_id').maybeSingle();
    if (error) return { error: isLastOwnerViolation(error.code) ? 'ownerInvariant' : 'failed' };
    if (!data) return { error: 'failed' };
    revalidatePath('/team'); revalidatePath(`/projects/${input.data.projectId}/chat`);
    return { success: 'memberRemoved' };
  } catch (error) {
    const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : undefined;
    return { error: isLastOwnerViolation(code) ? 'ownerInvariant' : 'failed' };
  }
}

export async function getProjectTeamMembers(projectId: string): Promise<{ members: ProjectTeamMember[]; error?: 'invalid' | 'auth' | 'failed' }> {
  const parsedId = z.string().uuid().safeParse(projectId);
  if (!parsedId.success) return { members: [], error: 'invalid' };
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return { members: [], error: 'auth' };
    const { data, error } = await supabase.rpc('list_project_team_members', { target_project_id: parsedId.data });
    if (error || !data?.length) return { members: [], error: 'failed' };
    return { members: data as ProjectTeamMember[] };
  } catch {
    return { members: [], error: 'failed' };
  }
}

export async function createTeamInvitation(_: TeamActionState, form: FormData): Promise<TeamActionState> {
  const parsed = invitationSchema.safeParse({
    organizationId: value(form, 'organizationId'),
    projectId: value(form, 'projectId'),
    email: value(form, 'email'),
    organizationRole: value(form, 'organizationRole'),
    projectRole: value(form, 'projectRole'),
  });
  if (!parsed.success) return { error: 'msg.team.checkInvite' };
  if (parsed.data.projectId && (!parsed.data.projectRole || parsed.data.organizationRole !== 'member')) {
    return { error: 'msg.team.projectInviteRoles' };
  }
  if (!parsed.data.projectId && parsed.data.projectRole) return { error: 'msg.team.projectRoleOnlyForProject' };

  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return { error: 'msg.auth.signInAgain' };

    const token = randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const { error } = await supabase.from('team_invitations').insert({
      organization_id: parsed.data.organizationId,
      project_id: parsed.data.projectId || null,
      email: parsed.data.email,
      organization_role: parsed.data.projectId ? 'member' : parsed.data.organizationRole,
      project_role: parsed.data.projectId ? parsed.data.projectRole : null,
      token_hash: tokenHash,
      invited_by: user.id,
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    });
    if (error) return { error: 'msg.team.inviteFailed' };
    revalidatePath('/team');
    return { success: 'msg.team.inviteCreated', invitePath: `/team/accept?token=${encodeURIComponent(token)}` };
  } catch {
    return { error: 'msg.team.inviteNetworkFailed' };
  }
}

export async function revokeTeamInvitation(_: TeamActionState, form: FormData): Promise<TeamActionState> {
  const invitationId = z.string().uuid().safeParse(value(form, 'invitationId'));
  if (!invitationId.success) return { error: 'msg.team.badInvite' };
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return { error: 'msg.auth.signInAgain' };
    const { data, error } = await supabase.rpc('revoke_team_invitation', { target_invitation_id: invitationId.data });
    if (error || data !== true) return { error: 'msg.team.revokeFailed' };
    revalidatePath('/team');
    return { success: 'msg.team.inviteRevoked' };
  } catch {
    return { error: 'msg.team.revokeNetworkFailed' };
  }
}

export async function acceptTeamInvitation(_: TeamActionState, form: FormData): Promise<TeamActionState> {
  const token = z.string().regex(/^[A-Za-z0-9_-]{43}$/).safeParse(value(form, 'token'));
  if (!token.success) return { error: 'msg.team.badInviteLink' };
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return { error: 'msg.team.acceptSignIn' };
    const tokenHash = createHash('sha256').update(token.data).digest('hex');
    const { data, error } = await supabase.rpc('accept_team_invitation', { target_token_hash: tokenHash });
    if (error || !data?.length) return { error: 'msg.team.inviteInvalid' };
    revalidatePath('/', 'layout');
    revalidatePath('/team');
    revalidatePath('/projects');
    return { success: 'msg.team.joined' };
  } catch {
    return { error: 'msg.team.acceptFailed' };
  }
}
