import { redirect } from 'next/navigation';
import { getMedia, mediaPageSize, parseMediaPage } from '@/lib/media';
import { MediaDownload } from '@/components/media-download';
import { MediaUpload } from '@/components/media-upload';
import { getProjects, parseProjectFilters, pageSize as projectPageSize } from '@/lib/projects';
import { mediaNavigationUrl, singleQueryValue, type MediaSearchParams } from '@/lib/media-navigation';

export default async function MediaPage({ searchParams }: { searchParams: Promise<MediaSearchParams> }) {
  const params = await searchParams;
  const page = parseMediaPage(singleQueryValue(params.page));
  const projectPage = parseMediaPage(singleQueryValue(params.projectPage));
  const filters = parseProjectFilters({ q: singleQueryValue(params.projectQuery), page: String(projectPage) });
  const result = await getMedia(page);
  if (!result.authenticated) redirect('/login?next=%2Fmedia');
  const projectList = await getProjects(filters);
  const projectPages = Math.max(1, Math.ceil(projectList.total / projectPageSize));
  const url = (mediaPage: number, selectionPage: number) => mediaNavigationUrl(mediaPage, selectionPage, filters.search);
  const pages = Math.max(1, Math.ceil(result.total / mediaPageSize));
  return <main className="page migration-page notifications-page"><h1>МЕДИАТЕКА</h1>
    <p>Материалы проектов, к которым у вас есть доступ. Приватный предпросмотр пока недоступен.</p>
    <form method="get"><input type="hidden" name="page" value={page} /><label>Поиск проекта для загрузки<input name="projectQuery" defaultValue={filters.search} maxLength={80} /></label><button className="ghost-button" type="submit">Найти проект</button></form>
    {projectList.error ? <p role="alert">Не удалось загрузить проекты для выбора.</p> : <><MediaUpload key={`${filters.search}:${projectPage}`} projects={projectList.projects.filter(item => item.role === 'owner' || item.role === 'editor').map(({ id, name }) => ({ id, name }))} /><nav className="project-pagination" aria-label="Страницы выбора проекта">{projectPage > 1 && <a href={url(page, projectPage - 1)}>← Проекты</a>}<span>Проекты: страница {projectPage} из {projectPages}</span>{projectPage < projectPages && <a href={url(page, projectPage + 1)}>Проекты →</a>}</nav></>}
    {result.error ? <p role="alert">{result.error}</p> : <>
      {!result.items.length && <p>{page === 1 ? 'Материалов пока нет.' : 'На этой странице нет материалов.'}</p>}
      <div className="notifications-list">{result.items.map(item => <article className="notification-card" key={item.id}>
        <h2>{item.name}</h2><p>{item.kind} · {item.mime_type} · {new Intl.NumberFormat('ru').format(item.size_bytes)} байт</p>
        <MediaDownload id={item.id} />
      </article>)}</div>
      <nav className="project-pagination" aria-label="Страницы медиатеки">{page > 1 && <a href={url(page - 1, projectPage)}>← Назад</a>}<span>Страница {page} из {pages}</span>{page < pages && <a href={url(page + 1, projectPage)}>Далее →</a>}</nav>
    </>}
  </main>;
}
