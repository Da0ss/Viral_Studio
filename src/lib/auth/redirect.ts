/** Accept only a path on this application; never pass user input to a redirect. */
export function safeInternalPath(value: FormDataEntryValue | string | null | undefined, fallback = '/create') {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return fallback;
  try {
    const base = new URL('http://viral-studio.local');
    const target = new URL(value, base);
    return target.origin === base.origin ? `${target.pathname}${target.search}${target.hash}` : fallback;
  } catch {
    return fallback;
  }
}
