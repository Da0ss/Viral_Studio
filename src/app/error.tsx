'use client';

import { useI18n } from '@/components/locale-provider';

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) { const { t } = useI18n(); return <main className="page auth-page"><section><small>{t('error.eyebrow')}</small><h1>{t('error.titleLine1')}<br />{t('error.titleLine2')}</h1><p className="subtitle">{t('error.subtitle')}</p><button className="cta" type="button" onClick={reset}><span>{t('common.retry')}</span><i className="icon ph ph-arrow-right" /></button></section></main>; }
