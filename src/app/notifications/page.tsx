import { redirect } from 'next/navigation';
import Link from 'next/link';
import type { Route } from 'next';
import { createClient } from '@/lib/supabase/server';
import { getCurrentProfile } from '@/lib/profile';
import { NotificationReadButton } from '@/components/notification-read-button';

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
  const pages = Math.max(1, Math.ceil((result.count ?? 0) / pageSize));
  return <main className="page migration-page notifications-page"><small>ЛИЧНЫЙ INBOX</small><h1>УВЕДОМЛЕНИЯ</h1>
    {result.error ? <p role="alert">Не удалось загрузить уведомления. Обновите страницу.</p> : <>
      {!result.data?.length && <p>Уведомлений пока нет.</p>}
      <div className="notifications-list">{result.data?.map(item => <article key={item.id} className="notification-card">
        <small>{item.read_at ? 'Прочитано' : 'Новое'} · <time dateTime={item.created_at}>{date.format(new Date(item.created_at))}</time></small>
        <h2>{item.title}</h2><p>{item.body}</p>{item.project_id && <p><Link href={`/projects/${item.project_id}/chat` as Route}>Открыть чат проекта</Link></p>}{!item.read_at && <NotificationReadButton id={item.id} />}
      </article>)}</div>
      <nav className="project-pagination" aria-label="Страницы уведомлений">{page > 1 && <a href={`?page=${page - 1}`}>← Назад</a>}<span>Страница {page} из {pages}</span>{page < pages && <a href={`?page=${page + 1}`}>Далее →</a>}</nav>
    </>}
  </main>;
}
