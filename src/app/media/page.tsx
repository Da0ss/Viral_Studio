import { redirect } from 'next/navigation';
import { getMedia, mediaPageSize, parseMediaPage } from '@/lib/media';
import { MediaDownload } from '@/components/media-download';
import { MediaUpload } from '@/components/media-upload';
import { getProjects, parseProjectFilters, pageSize as projectPageSize } from '@/lib/projects';
import { mediaNavigationUrl, singleQueryValue, type MediaSearchParams } from '@/lib/media-navigation';
import { getCurrentProfile } from '@/lib/profile';
import { translate } from '@/lib/i18n/messages';

export default async function MediaPage({ searchParams }: { searchParams: Promise<MediaSearchParams> }) {
  const params = await searchParams;
  const page = parseMediaPage(singleQueryValue(params.page));
  const projectPage = parseMediaPage(singleQueryValue(params.projectPage));
  const filters = parseProjectFilters({ q: singleQueryValue(params.projectQuery), page: String(projectPage) });
  const result = await getMedia(page);
  if (!result.authenticated) redirect('/login?next=%2Fmedia');
  const [projectList, profile] = await Promise.all([getProjects(filters), getCurrentProfile()]);
  const locale = profile?.language ?? 'ru'; const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>) => translate(locale, key, vars);
  const projectPages = Math.max(1, Math.ceil(projectList.total / projectPageSize));
  const url = (mediaPage: number, selectionPage: number) => mediaNavigationUrl(mediaPage, selectionPage, filters.search);
  const pages = Math.max(1, Math.ceil(result.total / mediaPageSize));
  return <main className="page migration-page notifications-page media-page"><h1>{t('media.title')}</h1>
    <p>{t('media.description')}</p>
    <form className="media-project-search" method="get"><input type="hidden" name="page" value={page} /><label>{t('media.searchProject')}<input name="projectQuery" defaultValue={filters.search} maxLength={80} /></label><button className="ghost-button" type="submit">{t('media.findProject')}</button></form>
    {projectList.error ? <p role="alert">{t('media.projectsError')}</p> : <><MediaUpload key={`${filters.search}:${projectPage}`} projects={projectList.projects.filter(item => item.role === 'owner' || item.role === 'editor').map(({ id, name }) => ({ id, name }))} /><nav className="project-pagination" aria-label={t('media.searchProject')}>{projectPage > 1 && <a href={url(page, projectPage - 1)}>← {t('team.project')}</a>}<span>{t('media.projectPages',{page:projectPage,pages:projectPages})}</span>{projectPage < projectPages && <a href={url(page, projectPage + 1)}>{t('team.project')} →</a>}</nav></>}
    {result.error ? <p role="alert">{result.error}</p> : <>
      {!result.items.length && <p className="media-empty">{page === 1 ? t('media.noItems') : t('media.noItemsPage')}</p>}
      <div className="notifications-list">{result.items.map(item => <article className="notification-card" key={item.id}>
        <h2>{item.name}</h2><p>{item.kind} · {item.mime_type} · {new Intl.NumberFormat(locale).format(item.size_bytes)} {t('media.bytes')}</p>
        <MediaDownload id={item.id} canDelete={item.role === 'owner' || item.role === 'editor'} />
      </article>)}</div>
      <nav className="project-pagination" aria-label={t('media.title')}>{page > 1 && <a href={url(page - 1, projectPage)}>{t('common.previous')}</a>}<span>{t('common.page',{page,pages})}</span>{page < pages && <a href={url(page + 1, projectPage)}>{t('common.next')}</a>}</nav>
    </>}
  </main>;
}
