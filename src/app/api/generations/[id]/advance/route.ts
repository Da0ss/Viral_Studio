import { NextResponse } from 'next/server';
import { advanceGenerationJob } from '@/lib/generation-worker';
import { createClient } from '@/lib/supabase/server';
import { hasTrustedOrigin } from '@/lib/request-origin';

export const runtime = 'nodejs';
export const maxDuration = 120;

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!hasTrustedOrigin(request)) return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: { 'Cache-Control': 'private, no-store' } });
  const { id } = await params;
  if (!uuidPattern.test(id)) return NextResponse.json({ error: 'Not found' }, { status: 404, headers: { 'Cache-Control': 'private, no-store' } });
  try {
    const supabase = await createClient({ requestTimeoutMs: 8_000 });
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: { 'Cache-Control': 'private, no-store' } });
    const { data: job, error: jobError } = await supabase.from('generation_jobs')
      .select('id,project_id,status').eq('id', id).maybeSingle();
    if (jobError || !job) return NextResponse.json({ error: 'Not found' }, { status: 404, headers: { 'Cache-Control': 'private, no-store' } });
    const advanced = await advanceGenerationJob(id, user.id);
    return NextResponse.json({ advanced, status: job.status }, {
      status: job.status === 'queued' || job.status === 'running' ? 202 : 200,
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch {
    return NextResponse.json({ error: 'Temporarily unavailable' }, { status: 503, headers: { 'Cache-Control': 'private, no-store' } });
  }
}
