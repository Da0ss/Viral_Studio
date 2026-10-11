'use client';

import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { translate, translateMessage, type Locale, type MessageKey } from '@/lib/i18n/messages';

type LocaleContextValue = { locale: Locale; t: (key: MessageKey, vars?: Record<string, string | number>) => string; tm: (message: string) => string };
const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  const t = useCallback((key: MessageKey, vars?: Record<string, string | number>) => translate(locale, key, vars), [locale]);
  const tm = useCallback((message: string) => translateMessage(locale, message), [locale]);
  const value = useMemo(() => ({ locale, t, tm }), [locale, t, tm]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useI18n(): LocaleContextValue {
  const value = useContext(LocaleContext);
  if (!value) throw new Error('useI18n must be used inside LocaleProvider');
  return value;
}
