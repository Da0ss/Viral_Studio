import { type NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getAppUrl } from '@/lib/supabase/config';
import { safeInternalPath } from '@/lib/auth/redirect';

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');
  const next = safeInternalPath(request.nextUrl.searchParams.get('next'));
  // Use the configured public origin rather than request.url. Next can
  // reconstruct request.url with an internal hostname that differs from the
  // browser's host; that would strand the host-only session cookie on redirect.
  let appUrl: string;
  try { appUrl = getAppUrl(); }
  catch { return NextResponse.json({ error: 'Authentication callback unavailable.' }, { status: 503 }); }
  if (code) {
    try {
      const supabase = await createClient();
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (!error) return NextResponse.redirect(new URL(next, appUrl));
    } catch {
      // Network/configuration failures must not disclose callback credentials.
    }
  }
  return NextResponse.redirect(new URL('/login?error=callback', appUrl));
}
