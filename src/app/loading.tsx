'use client';
import { useI18n } from '@/components/locale-provider';
export default function Loading() { const { t } = useI18n(); return <main className="page loading-page" aria-live="polite"><span className="loading-dot" /><p>{t('loading.app')}</p></main>; }
