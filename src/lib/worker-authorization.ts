import 'server-only';
import { createHash, timingSafeEqual } from 'node:crypto';

/** Separate scheduler credentials must never reuse an application's admin key. */
export function authorizeScheduledWorker(request: Request): 200 | 401 | 503 {
  const secret = process.env.CRON_SECRET;
  if (!secret || !/^[0-9a-f]{64}$/.test(secret) || secret === process.env.SUPABASE_SERVICE_ROLE_KEY || secret === process.env.HF_TOKEN) return 503;
  const authorization = request.headers.get('authorization') ?? '';
  if (authorization.length > 512) return 401;
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(authorization), digest(`Bearer ${secret}`)) ? 200 : 401;
}
