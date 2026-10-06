import { type NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { safeInternalPath } from '@/lib/auth/redirect';

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');
  const next = safeInternalPath(request.nextUrl.searchParams.get('next'));
  if (code) {
    try {
      const supabase = await createClient();
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (!error) return NextResponse.redirect(new URL(next, request.url));
    } catch {
      // Network/configuration failures must not disclose callback credentials.
    }
  }
  return NextResponse.redirect(new URL('/login?error=callback', request.url));
}
