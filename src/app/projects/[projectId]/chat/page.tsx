import Link from 'next/link';
import { ProjectChat } from '@/components/project-chat';
import { getProjectChat } from '@/lib/messages';

export default async function ProjectChatPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const chat = await getProjectChat(projectId);
  if (chat.status !== 'ready') {
    return <main className="page migration-page chat-page"><small>ЧАТ ПРОЕКТА</small><h1>{chat.status === 'forbidden' ? 'ДОСТУП ЗАКРЫТ' : 'ЧАТ НЕДОСТУПЕН'}</h1><p className="subtitle">{chat.message}</p><Link className="ghost-button chat-back" href={chat.status === 'unauthenticated' ? `/login?next=/projects/${projectId}/chat` : '/projects'}>Вернуться</Link></main>;
  }
  return <main className="page migration-page chat-page"><small>ЧАТ ПРОЕКТА</small><h1>{chat.projectName}</h1><ProjectChat projectId={projectId} currentUserId={chat.userId} canSend={['owner', 'editor', 'commenter'].includes(chat.role)} initialMessages={chat.messages} /></main>;
}
