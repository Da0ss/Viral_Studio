import { redirect } from 'next/navigation';
import { getOrganizations } from '@/lib/projects';
import { createClient } from '@/lib/supabase/server';
import CreateVideoPage from '@/components/create-video-page';

export interface CreateProject { id: string; name: string }

// Only projects the user can write to (owner/editor) can start a generation.
async function getGenerationProjects(): Promise<CreateProject[]> {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) redirect('/login?next=%2Fcreate');
  const { data, error } = await supabase.from('project_members').select('role, projects(id, name)')
    .eq('user_id', user.id).in('role', ['owner', 'editor']).order('created_at')
    // A picker with more than 200 projects is not usable anyway; the cap bounds the query.
    .limit(200);
  if (error) throw error;
  return (data ?? []).flatMap(row => {
    const project = Array.isArray(row.projects) ? row.projects[0] : row.projects;
    return project ? [{ id: project.id as string, name: project.name as string }] : [];
  });
}

export default async function CreatePage() {
  if (!(await getOrganizations()).length) redirect('/onboarding');
  return <CreateVideoPage projects={await getGenerationProjects()} />;
}
