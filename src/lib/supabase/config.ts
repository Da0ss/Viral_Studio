export function hasSupabasePublicConfig() {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY));
}

export function getSupabasePublicConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !publishableKey) throw new Error('Supabase Auth не настроен. Добавьте значения из .env.example в .env.local.');
  return { url, anonKey: publishableKey };
}

export function getAppUrl() {
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  if (!configured && process.env.NODE_ENV === 'production') throw new Error('Application origin is not configured.');
  const url = new URL(configured || 'http://localhost:3000');
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && local))
    || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Application origin must be a secure origin without credentials or a path.');
  }
  return url.origin;
}
