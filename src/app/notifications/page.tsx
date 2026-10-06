import { redirect } from 'next/navigation';
import Link from 'next/link';
import type { Route } from 'next';
import { createClient } from '@/lib/supabase/server';
import { getCurrentProfile } from '@/lib/profile';
import { NotificationReadButton } from '@/components/notification-read-button';
import { translate } from '@/lib/i18n/messages';

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=%2Fnotifications');
  const params = await searchParams;
  const page = Math.min(10000, Math.max(1, Number.parseInt(params.page ?? '1', 10) || 1));
  const pageSize = 30;
  const [result, profile] = await Promise.all([
    supabase.from('notifications').select('id, title, body, project_id, created_at, read_at', { count: 'exact' })
      .eq('user_id', user.id).order('created_at', { ascending: false }).order('id', { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1),
    getCurrentProfile(user),
  ]);
  const date = new Intl.DateTimeFormat(profile?.language ?? 'ru', { dateStyle: 'medium', timeStyle: 'short', timeZone: profile?.timezone ?? 'Asia/Qyzylorda' });
  const locale = profile?.language ?? 'ru'; const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>) => translate(locale, key, vars);
  const pages = Math.max(1, Math.ceil((result.count ?? 0) / pageSize));
  return <main className="page migration-page notifications-page"><small>{t('notifications.eyebrow')}</small><h1>{t('notifications.title')}</h1>
    {result.error ? <p role="alert">{t('notifications.error')}</p> : <>
      {!result.data?.length && <p>{t('notifications.empty')}</p>}
      <div className="notifications-list">{result.data?.map(item => <article key={item.id} className="notification-card">
        <small>{item.read_at ? t('notifications.read') : t('notifications.new')} · <time dateTime={item.created_at}>{date.format(new Date(item.created_at))}</time></small>
        <h2>{item.title}</h2><p>{item.body}</p>{item.project_id && <p><Link href={`/projects/${item.project_id}/chat` as Route}>{t('notifications.openChat')}</Link></p>}{!item.read_at && <NotificationReadButton id={item.id} />}
      </article>)}</div>
      <nav className="project-pagination" aria-label={t('notifications.title')}>{page > 1 && <a href={`?page=${page - 1}`}>{t('common.previous')}</a>}<span>{t('common.page',{page,pages})}</span>{page < pages && <a href={`?page=${page + 1}`}>{t('common.next')}</a>}</nav>
    </>}
  </main>;
}
