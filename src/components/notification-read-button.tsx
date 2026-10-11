'use client';
import { useActionState } from 'react';
import { markNotificationRead } from '@/actions/notifications';
import { useI18n } from '@/components/locale-provider';
export function NotificationReadButton({ id }: { id: string }) {
  const { t, tm } = useI18n();
  const [state, action, pending] = useActionState(markNotificationRead, {});
  return <form action={action}>
    <input type="hidden" name="notificationId" value={id} />
    <button className="ghost-button" type="submit" disabled={pending || Boolean(state.success)}>{pending ? t('common.saving') : state.success || t('notifications.markRead')}</button>
    {state.error && <p role="alert">{tm(state.error)}</p>}
    {state.success && <span role="status">{tm(state.success)}</span>}
  </form>;
}
