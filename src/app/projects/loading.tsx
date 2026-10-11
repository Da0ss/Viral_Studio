'use client';
import { useI18n } from '@/components/locale-provider';
export default function ProjectsLoading() { const { t } = useI18n(); return <main className="page loading-page"><div className="loading-dot"/><p>{t('loading.projects')}</p></main>; }
