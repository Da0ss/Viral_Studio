// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { LocaleProvider } from '@/components/locale-provider';
import { NotificationReadButton } from '@/components/notification-read-button';
import { translate } from '@/lib/i18n/messages';

vi.mock('@/actions/notifications', () => ({
  markNotificationRead: async () => ({ success: 'msg.notifications.read' }),
}));
afterEach(cleanup);

it.each(['ru', 'en', 'kk'] as const)('translates the confirmed read button in %s', async locale => {
  render(<LocaleProvider locale={locale}><NotificationReadButton id="notification" /></LocaleProvider>);
  fireEvent.submit(screen.getByRole('button').closest('form')!);
  const button = await screen.findByRole('button', { name: translate(locale, 'msg.notifications.read') });
  expect((button as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByRole('status').textContent).toBe(translate(locale, 'msg.notifications.read'));
  expect(button.textContent).not.toContain('msg.');
});
