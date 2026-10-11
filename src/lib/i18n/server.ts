import 'server-only';
import { cache } from 'react';
import { getCurrentProfile } from '@/lib/profile';
import { translate, type Locale, type MessageKey } from '@/lib/i18n/messages';

// Guests have no saved language yet, so they get Russian until a guest language switch exists.
export const getServerLocale = cache(async (): Promise<Locale> => {
  try { return (await getCurrentProfile())?.language ?? 'ru'; } catch { return 'ru'; }
});

export async function getServerTranslator() {
  const locale = await getServerLocale();
  return { locale, t: (key: MessageKey, vars?: Record<string, string | number>) => translate(locale, key, vars) };
}
