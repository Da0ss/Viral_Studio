import { getAppUrl } from '@/lib/supabase/config';

/** Require the browser Origin to match the configured public application origin. */
export function hasTrustedOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return false;

  try {
    const expected = process.env.NEXT_PUBLIC_APP_URL
      ? getAppUrl()
      : process.env.NODE_ENV === 'production'
        ? null
        : new URL(request.url).origin;
    return expected !== null && origin === expected;
  } catch {
    return false;
  }
}
