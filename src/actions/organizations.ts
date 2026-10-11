'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export async function createOrganization(_: { error?: string }, form: FormData): Promise<{ error?: string }> {
  const parsed = z.string().trim().min(2).max(120).safeParse(form.get('name'));
  if (!parsed.success) return { error: 'msg.org.nameLength' };
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return { error: 'msg.auth.sessionExpired' };
    const { error } = await supabase.from('organizations').insert({ name: parsed.data, slug: `studio-${crypto.randomUUID()}`, created_by: user.id });
    if (error) return { error: 'msg.org.failed' };
  } catch {
    return { error: 'msg.org.networkFailed' };
  }
  revalidatePath('/', 'layout');
  redirect('/projects');
}
