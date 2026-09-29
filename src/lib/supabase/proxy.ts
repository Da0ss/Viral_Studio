import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { hasSupabasePublicConfig } from './config';

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

  if (!hasSupabasePublicConfig()) {
    if (!isPublicPath(pathname)) {
      const loginUrl = request.nextUrl.clone();
      loginUrl.pathname = '/login';
      loginUrl.searchParams.set('error', 'configuration');
      return redirectWithSession(loginUrl, response);
    }
    return response;
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
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
  const { data: { user } } = await supabase.auth.getUser();

  if (!user && !isPublicPath(pathname)) {
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
