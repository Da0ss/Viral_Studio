'use client';

import { useI18n } from '@/components/locale-provider';

export default function ChatError({ reset }: { error: Error & { digest?: string }; reset: () => void }) { const { t } = useI18n(); return <main className="page migration-page chat-page"><small>{t('chat.eyebrow')}</small><h1>{t('projects.loadError')}</h1><p className="subtitle">{t('chat.openFailed')}</p><button className="cta" type="button" onClick={reset}><span>{t('common.retry')}</span></button></main>; }
