import 'server-only';

import { createClient } from '@supabase/supabase-js';
import { getSupabasePublicConfig } from './config';
import { createDeadlineFetch } from '@/lib/deadline-fetch';

/** Server-only privileged client. Never import this module from a Client Component. */
export function createAdminClient(options: { requestTimeoutMs?: number } = {}) {
  const { url } = getSupabasePublicConfig();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY не настроен на сервере.');
  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    ...(options.requestTimeoutMs !== undefined ? { global: { fetch: createDeadlineFetch(options.requestTimeoutMs) } } : {}),
  });
}
