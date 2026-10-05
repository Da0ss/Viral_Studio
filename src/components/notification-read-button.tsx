'use client';
import { useActionState } from 'react';
import { markNotificationRead } from '@/actions/notifications';
export function NotificationReadButton({ id }: { id: string }) {
  const [state, action, pending] = useActionState(markNotificationRead, {});
  return <form action={action}>
    <input type="hidden" name="notificationId" value={id} />
    <button className="ghost-button" type="submit" disabled={pending || Boolean(state.success)}>{pending ? 'Сохраняем…' : state.success || 'Отметить прочитанным'}</button>
    {state.error && <p role="alert">{state.error}</p>}
    {state.success && <span role="status">{state.success}</span>}
  </form>;
}
