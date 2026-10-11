'use client';
import { useI18n } from '@/components/locale-provider';
export default function ProjectsError({ reset }: { error: Error; reset: () => void }) { const { t } = useI18n(); return <main className="page loading-page"><h1>{t('projects.loadError')}</h1><button className="cta" onClick={reset}><span>{t('common.retry')}</span></button></main>; }
