import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { getSupabasePublicConfig, hasSupabasePublicConfig } from './config';

const publicPaths = new Set(['/login', '/register', '/forgot-password', '/reset-password']);

function isPublicPath(pathname: string) {
  return publicPaths.has(pathname) || pathname.startsWith('/auth/');
}

function redirectWithSession(url: URL, response: NextResponse) {
  const redirect = NextResponse.redirect(url);
  response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
  response.headers.forEach((value, key) => redirect.headers.set(key, value));
  return redirect;
}

export async function updateSession(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  let response = NextResponse.next({ request });

  // Machine-to-machine auth is enforced by this exact handler, not user cookies.
  // Never expand this to a prefix covering other internal/API routes.
  if (pathname === '/api/internal/media-cleanup') return response;

  if (!hasSupabasePublicConfig()) {
    if (pathname.startsWith('/api/')) return NextResponse.json({ error: 'Сервис временно недоступен.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
    if (!isPublicPath(pathname)) {
      const loginUrl = request.nextUrl.clone();
      loginUrl.pathname = '/login';
      loginUrl.searchParams.set('error', 'configuration');
      return redirectWithSession(loginUrl, response);
    }
    return response;
  }

  const { url, anonKey } = getSupabasePublicConfig();
  const supabase = createServerClient(
    url,
    anonKey,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
          Object.entries(headers).forEach(([name, value]) => response.headers.set(name, value));
        },
      },
    },
  );

  // Keep this immediately after client creation: it validates and refreshes the JWT.
  const { data } = await supabase.auth.getClaims();
  const user = data?.claims?.sub;

  if (!user && !isPublicPath(pathname)) {
    if (pathname.startsWith('/api/')) {
      const denied = NextResponse.json({ error: 'Войдите снова.' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
      response.cookies.getAll().forEach(cookie => denied.cookies.set(cookie));
      return denied;
    }
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = '/login';
    loginUrl.searchParams.set('next', pathname);
    return redirectWithSession(loginUrl, response);
  }

  if (user && (pathname === '/login' || pathname === '/register')) {
    const appUrl = request.nextUrl.clone();
    appUrl.pathname = '/create';
    return redirectWithSession(appUrl, response);
  }

  return response;
}
