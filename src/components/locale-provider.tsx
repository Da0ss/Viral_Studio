'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { translate, translateMessage, type Locale, type MessageKey } from '@/lib/i18n/messages';

type LocaleContextValue = { locale: Locale; setLocale: (locale: Locale) => void; t: (key: MessageKey, vars?: Record<string, string | number>) => string; tm: (message: string) => string };
const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  const [selection, setSelection] = useState({ serverLocale: locale, locale });
  // Apply a confirmed save immediately, retaining it while the old RSC props
  // are still present. A changed server locale becomes the new baseline.
  if (selection.serverLocale !== locale) setSelection({ serverLocale: locale, locale });
  const effectiveLocale = selection.serverLocale === locale ? selection.locale : locale;
  const setLocale = useCallback((next: Locale) => setSelection(previous => ({ ...previous, locale: next })), []);
  const t = useCallback((key: MessageKey, vars?: Record<string, string | number>) => translate(effectiveLocale, key, vars), [effectiveLocale]);
  const tm = useCallback((message: string) => translateMessage(effectiveLocale, message), [effectiveLocale]);
  const value = useMemo(() => ({ locale: effectiveLocale, setLocale, t, tm }), [effectiveLocale, setLocale, t, tm]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useI18n(): LocaleContextValue {
  const value = useContext(LocaleContext);
  if (!value) throw new Error('useI18n must be used inside LocaleProvider');
  return value;
}
