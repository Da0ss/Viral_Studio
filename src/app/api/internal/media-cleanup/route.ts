import { createHash, timingSafeEqual } from 'node:crypto';
import { runOneMediaCleanup } from '@/lib/media-cleanup-adapter';

export const runtime = 'nodejs';
export const maxDuration = 120;
const reply = (body: Record<string, string>, status: number) => Response.json(body, {
  status, headers: { 'Cache-Control': 'no-store' },
});
const digest = (value: string) => createHash('sha256').update(value).digest();

/** Disabled by default. Scheduler credentials are distinct from Supabase keys. */
export async function POST(request: Request) {
  const secret = process.env.MEDIA_CLEANUP_SECRET;
  if (!secret || !/^[0-9a-f]{64}$/.test(secret) || secret === process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return reply({ error: 'Worker unavailable' }, 503);
  }
  const authorization = request.headers.get('authorization') ?? '';
  if (authorization.length > 512 || !timingSafeEqual(digest(authorization), digest(`Bearer ${secret}`))) {
    return reply({ error: 'Unauthorized' }, 401);
  }
  if (process.env.MEDIA_CLEANUP_ENABLED !== 'true') return reply({ error: 'Worker disabled' }, 503);
  try {
    const outcome = await runOneMediaCleanup();
    if (outcome === 'invalid' || outcome === 'unconfirmed') return reply({ error: 'Cleanup not confirmed' }, 503);
    return reply({ outcome }, 200);
  } catch { return reply({ error: 'Cleanup not confirmed' }, 503); }
}
