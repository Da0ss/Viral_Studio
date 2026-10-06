import Link from 'next/link';
import { ProjectChat } from '@/components/project-chat';
import { getProjectChat } from '@/lib/messages';
import { getCurrentProfile } from '@/lib/profile';
import { translate } from '@/lib/i18n/messages';

export default async function ProjectChatPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const [chat, profile] = await Promise.all([getProjectChat(projectId), getCurrentProfile()]);
  const locale = profile?.language ?? 'ru'; const t = (key: Parameters<typeof translate>[1]) => translate(locale, key);
  if (chat.status !== 'ready') {
    return <main className="page migration-page chat-page"><small>{t('chat.eyebrow')}</small><h1>{chat.status === 'forbidden' ? t('chat.accessDenied') : t('chat.unavailable')}</h1><p className="subtitle">{chat.message}</p><Link className="ghost-button chat-back" href={chat.status === 'unauthenticated' ? `/login?next=/projects/${projectId}/chat` : '/projects'}>{t('common.back')}</Link></main>;
  }
  return <main className="page migration-page chat-page"><small>{t('chat.eyebrow')}</small><h1>{chat.projectName}</h1><ProjectChat projectId={projectId} currentUserId={chat.userId} canSend={['owner', 'editor', 'commenter'].includes(chat.role)} initialMessages={chat.messages} /></main>;
}
