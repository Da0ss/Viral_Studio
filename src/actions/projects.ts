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
  const parsed = input(form);
  if (!parsed.success) return { error: 'Проверьте поля проекта.' };
  try {
    const { supabase, user } = await auth();
    if (!user) return { error: 'Войдите снова.' };
    const { data: membership, error: membershipError } = await supabase.from('organization_members').select('role').eq('organization_id', parsed.data.organizationId).eq('user_id', user.id).maybeSingle();
    if (membershipError || !membership || !['owner', 'admin'].includes(membership.role)) return { error: 'Создавать проекты могут только owner или admin организации.' };
    const { error } = await supabase.from('projects').insert({ name: parsed.data.name, description: parsed.data.description, type: parsed.data.type, status: parsed.data.status, organization_id: parsed.data.organizationId, created_by: user.id });
    if (error) return { error: 'Не удалось подтвердить создание проекта. Обновите список перед повтором.' };
  } catch { return { error: 'Не удалось подтвердить создание проекта. Обновите список перед повтором.' }; }
  revalidatePath('/projects');
  return { success: 'Проект создан.' };
}
export async function updateProject(_: State, form: FormData): Promise<State> {
  const parsed = projectInputSchema.omit({ organizationId: true }).safeParse({ name: val(form, 'name'), description: val(form, 'description'), type: val(form, 'type'), status: val(form, 'status') });
  const projectId = val(form, 'projectId');
  if (!parsed.success || !projectInputSchema.shape.organizationId.safeParse(projectId).success) return { error: 'Проверьте данные проекта.' };
  try {
    const { supabase, user } = await auth();
    if (!user || !['owner', 'editor'].includes((await role(supabase, projectId, user.id)) ?? '')) return { error: 'У вас нет прав на изменение проекта.' };
    // Never accept tenant reassignment from the browser.
    const { data, error } = await supabase.from('projects').update(parsed.data).eq('id', projectId).select('id').maybeSingle();
    if (error || !data) return { error: 'Не удалось подтвердить обновление проекта. Обновите список.' };
  } catch { return { error: 'Не удалось подтвердить обновление проекта. Обновите список.' }; }
  revalidatePath('/projects');
  return { success: 'Проект обновлён.' };
}
export async function deleteProject(_: State, form: FormData): Promise<State> {
  const projectId = val(form, 'projectId');
  if (!projectInputSchema.shape.organizationId.safeParse(projectId).success) return { error: 'Проверьте данные проекта.' };
  try {
    const { supabase, user } = await auth();
    if (!user || await role(supabase, projectId, user.id) !== 'owner') return { error: 'Удалять проект может только owner.' };
    const { data, error } = await supabase.from('projects').delete().eq('id', projectId).select('id').maybeSingle();
    if (error || !data) return { error: 'Не удалось удалить проект. Обновите список и попробуйте снова.' };
  } catch {
    return { error: 'Не удалось удалить проект. Попробуйте снова.' };
  }
  revalidatePath('/projects');
  return { success: 'Проект удалён.' };
}
