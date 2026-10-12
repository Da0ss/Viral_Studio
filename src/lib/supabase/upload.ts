'use client';

import { createClient } from '@supabase/supabase-js';
import { getSupabasePublicConfig } from './config';

const uploadTimeoutMs = 120_000;

/** A scoped client for signed uploads; it does not read or persist the user's session. */
export function createUploadClient() {
  const { url, anonKey } = getSupabasePublicConfig();
  const boundedFetch: typeof fetch = (input, init) => {
    const signals = [AbortSignal.timeout(uploadTimeoutMs)];
    if (input instanceof Request) signals.push(input.signal);
    if (init?.signal) signals.push(init.signal);
    return globalThis.fetch(input, { ...init, signal: AbortSignal.any(signals) });
  };
  return createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: { fetch: boundedFetch },
  });
}
