'use server';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { projectInputSchema, type ProjectRole } from '@/types/projects';
type State = { error?: string; success?: string }; const val = (f: FormData, n: string) => String(f.get(n) ?? '');
async function auth() { const supabase = await createClient(); const { data: { user }, error } = await supabase.auth.getUser(); return { supabase, user: error ? null : user }; }
async function role(supabase: Awaited<ReturnType<typeof createClient>>, projectId: string, userId: string): Promise<ProjectRole | null> {
  const { data, error } = await supabase.from('project_members').select('role').eq('project_id', projectId).eq('user_id', userId).maybeSingle();
  return error ? null : (data?.role ?? null) as ProjectRole | null;
}
function input(form: FormData) { return projectInputSchema.safeParse({ name: val(form, 'name'), description: val(form, 'description'), type: val(form, 'type'), status: val(form, 'status'), organizationId: val(form, 'organizationId') }); }
export async function createProject(_: State, form: FormData): Promise<State> {
  const startedAt = Date.now();
  const stage = (name: string) => {
    if (process.env.E2E_NATIVE_SUPABASE_REQUIRED === '1') console.info(`[project-create] ${name}: ${Date.now() - startedAt}ms`);
  };
  const parsed = input(form);
  if (!parsed.success) return { error: 'msg.projects.checkFields' };
  try {
    const { supabase, user } = await auth();
    stage('authenticated');
    if (!user) return { error: 'msg.auth.signInAgain' };
    const { data: membership, error: membershipError } = await supabase.from('organization_members').select('role').eq('organization_id', parsed.data.organizationId).eq('user_id', user.id).maybeSingle();
    stage('membership checked');
    if (membershipError || !membership || !['owner', 'admin'].includes(membership.role)) return { error: 'msg.projects.createOwnerAdminOnly' };
    const { error } = await supabase.from('projects').insert({ name: parsed.data.name, description: parsed.data.description, type: parsed.data.type, status: parsed.data.status, organization_id: parsed.data.organizationId, created_by: user.id });
    stage('insert acknowledged');
    if (error) return { error: 'msg.projects.createUnconfirmed' };
  } catch { return { error: 'msg.projects.createUnconfirmed' }; }
  revalidatePath('/projects');
  stage('returning confirmed success');
  return { success: 'msg.projects.created' };
}
export async function updateProject(_: State, form: FormData): Promise<State> {
  const parsed = projectInputSchema.omit({ organizationId: true }).safeParse({ name: val(form, 'name'), description: val(form, 'description'), type: val(form, 'type'), status: val(form, 'status') });
  const projectId = val(form, 'projectId');
  if (!parsed.success || !projectInputSchema.shape.organizationId.safeParse(projectId).success) return { error: 'msg.projects.checkData' };
  try {
    const { supabase, user } = await auth();
    if (!user || !['owner', 'editor'].includes((await role(supabase, projectId, user.id)) ?? '')) return { error: 'msg.projects.noEditAccess' };
    // Never accept tenant reassignment from the browser.
    const { data, error } = await supabase.from('projects').update(parsed.data).eq('id', projectId).select('id').maybeSingle();
    if (error || !data) return { error: 'msg.projects.updateUnconfirmed' };
  } catch { return { error: 'msg.projects.updateUnconfirmed' }; }
  revalidatePath('/projects');
  return { success: 'msg.projects.updated' };
}
export async function deleteProject(_: State, form: FormData): Promise<State> {
  const projectId = val(form, 'projectId');
  if (!projectInputSchema.shape.organizationId.safeParse(projectId).success) return { error: 'msg.projects.checkData' };
  try {
    const { supabase, user } = await auth();
    if (!user || await role(supabase, projectId, user.id) !== 'owner') return { error: 'msg.projects.deleteOwnerOnly' };
    const { data, error } = await supabase.from('projects').delete().eq('id', projectId).select('id').maybeSingle();
    if (error || !data) return { error: 'msg.projects.deleteUnconfirmed' };
  } catch {
    return { error: 'msg.projects.deleteFailed' };
  }
  revalidatePath('/projects');
  return { success: 'msg.projects.deleted' };
}
