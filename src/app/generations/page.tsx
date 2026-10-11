import Link from 'next/link';
import type { Route } from 'next';
import { redirect } from 'next/navigation';
import { generationPageQuery, generationPageSize, generationStatusFilters, getGenerations, parseGenerationFilters, type GenerationListItem } from '@/lib/generations';
import { getServerTranslator } from '@/lib/i18n/server';
import { translateMessage, type MessageKey } from '@/lib/i18n/messages';

function statusKey(item: GenerationListItem): MessageKey {
  if (item.dispatch_state === 'uncertain') return 'generation.status.uncertain';
  if (item.status === 'completed') return 'generation.status.succeeded';
  return ['queued', 'running', 'failed', 'cancelled'].includes(item.status) ? `generation.status.${item.status}` as MessageKey : 'generation.statusUnknown';
}

export default async function GenerationsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const filters = parseGenerationFilters(await searchParams);
  const [result, { locale, t }] = await Promise.all([getGenerations(filters), getServerTranslator()]);
  if (!result.authenticated) redirect('/login?next=%2Fgenerations');
  const pages = Math.max(1, Math.ceil(result.total / generationPageSize));
  const date = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });
  const filtered = Boolean(filters.projectId || filters.status);
  return <main className="page migration-page notifications-page generations-page"><small>{t('generation.eyebrow')}</small><h1>{t('generation.historyTitle')}</h1>
    <p className="subtitle">{t('generation.historySubtitle')}</p>
    <form className="project-filters generation-filters" method="get" role="search" aria-label={t('generation.filters')}>
      <select name="project" aria-label={t('generation.project')} defaultValue={filters.projectId ?? ''}><option value="">{t('generation.allProjects')}</option>{result.projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select>
      <select name="status" aria-label={t('generation.statusLabel')} defaultValue={filters.status ?? ''}><option value="">{t('generation.allStatuses')}</option>{generationStatusFilters.map(status => <option key={status} value={status}>{t(status === 'completed' ? 'generation.status.succeeded' : `generation.status.${status}` as MessageKey)}</option>)}</select>
      <button className="ghost-button">{t('common.apply')}</button>
    </form>
    {result.error ? <p role="alert">{translateMessage(locale, result.error)}</p> : <>
      {!result.items.length && <p>{filtered ? t('generation.emptyFiltered') : t('generation.empty')} <Link href="/create">{t('generation.submit')}</Link></p>}
      <div className="notifications-list">{result.items.map(item => <article key={item.id} className={`notification-card generation-item generation-item--${item.dispatch_state === 'uncertain' ? 'uncertain' : item.status}`}>
        <small><span className="generation-item__status">{t(statusKey(item))}</span> · {item.projectName ?? t('generation.project')} · <time dateTime={item.created_at}>{date.format(new Date(item.created_at))}</time></small>
        <h2>{item.prompt ? (item.prompt.length > 140 ? `${item.prompt.slice(0, 140)}…` : item.prompt) : t('generation.noPrompt')}</h2>
        {item.dispatch_state === 'uncertain' && <p role="note">{t('generation.uncertainHelp')}</p>}
        <p><Link href={`/generations/${item.id}` as Route}>{item.assetId ? t('generation.openResult') : t('generation.open')}</Link></p>
      </article>)}</div>
      <nav className="project-pagination" aria-label={t('generation.historyTitle')}>{filters.page > 1 && <a href={generationPageQuery(filters, filters.page - 1)}>{t('common.previous')}</a>}<span>{t('common.page', { page: filters.page, pages })}</span>{filters.page < pages && <a href={generationPageQuery(filters, filters.page + 1)}>{t('common.next')}</a>}</nav>
    </>}
  </main>;
}
