// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectChat } from '@/components/project-chat';
import type { ChatMessage } from '@/types/messages';
import { LocaleProvider } from '@/components/locale-provider';
const mocks = vi.hoisted(() => ({ client: vi.fn(), send: vi.fn() }));
vi.mock('@/lib/supabase/browser', () => ({ createClient: mocks.client }));
vi.mock('@/actions/messages', () => ({ sendMessage: mocks.send }));
const projectId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const message = (id: string, body: string, sender = 'other'): ChatMessage => ({ id, body, project_id: projectId, sender_id: sender, created_at: '2026-09-29T12:00:00.000Z' });
function setup() {
  let receive!: (payload: { new: ChatMessage }) => void;
  let status!: (status: string) => void;
  const channel = { on: vi.fn(), subscribe: vi.fn() };
  channel.on.mockImplementation((_event, _filter, callback) => { receive = callback; return channel; });
  channel.subscribe.mockImplementation(callback => { status = callback; return channel; });
  const result = vi.fn().mockResolvedValue({ data: [], error: null });
  const query = { select: vi.fn(), eq: vi.fn(), order: vi.fn(), or: vi.fn(), limit: result };
  for (const method of ['select', 'eq', 'order', 'or'] as const) query[method].mockReturnValue(query);
  const removeChannel = vi.fn().mockResolvedValue(undefined);
  mocks.client.mockReturnValue({ channel: vi.fn(() => channel), from: vi.fn(() => query), removeChannel });
  return { receive: (value: ChatMessage) => receive({ new: value }), status: (value: string) => status(value), result, removeChannel };
}
beforeEach(() => { vi.resetAllMocks(); vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 1; }); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe('chat realtime reconciliation', () => {
  it('shows offline immediately and recreates the subscription on network recovery', async () => {
    const realtime = setup();
    const view = render(<LocaleProvider locale="ru"><ProjectChat projectId={projectId} currentUserId="me" canSend initialMessages={[]} /></LocaleProvider>);
    await act(async () => realtime.status('SUBSCRIBED'));
    expect(screen.getByText('Онлайн')).toBeTruthy();
    await act(async () => window.dispatchEvent(new Event('offline')));
    expect(screen.getByText('Нет соединения')).toBeTruthy();
    await act(async () => realtime.status('SUBSCRIBED'));
    expect(screen.queryByText('Онлайн')).toBeNull();
    await act(async () => window.dispatchEvent(new Event('online')));
    expect(realtime.removeChannel).toHaveBeenCalledTimes(1);
    await act(async () => realtime.status('SUBSCRIBED'));
    expect(screen.getByText('Онлайн')).toBeTruthy();
    view.unmount();
    await act(async () => window.dispatchEvent(new Event('online')));
    expect(realtime.removeChannel).toHaveBeenCalledTimes(2);
  });
  it('deduplicates repeated inserts and sorts equal timestamps by id', async () => {
    const realtime = setup();
    render(<LocaleProvider locale="ru"><ProjectChat projectId={projectId} currentUserId="me" canSend={false} initialMessages={[message('b', 'Second')]} /></LocaleProvider>);
    await act(async () => { realtime.receive(message('a', 'First')); realtime.receive(message('a', 'First')); });
    expect(screen.getAllByText('First')).toHaveLength(1);
    expect([...document.querySelectorAll('.project-chat__message p')].map(node => node.textContent)).toEqual(['First', 'Second']);
    expect(screen.queryByRole('button', { name: 'Отправить' })).toBeNull();
  });
  it('reconciles a realtime echo arriving before the send action resolves', async () => {
    const realtime = setup();
    let resolve!: (value: unknown) => void;
    mocks.send.mockReturnValue(new Promise(yes => { resolve = yes; }));
    render(<LocaleProvider locale="ru"><ProjectChat projectId={projectId} currentUserId="me" canSend initialMessages={[]} /></LocaleProvider>);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Новое сообщение'), 'Hello');
    await user.click(screen.getByRole('button', { name: 'Отправить' }));
    const persisted = message('server-id', 'Hello', 'me');
    await act(async () => { realtime.receive(persisted); resolve({ ok: true, message: persisted }); });
    await waitFor(() => expect(screen.getAllByText('Hello')).toHaveLength(1));
    expect(document.querySelector('.sending')).toBeNull();
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });
  it('restores the draft and removes optimistic messages after failure', async () => {
    setup();
    mocks.send.mockRejectedValue(new Error('private internal details'));
    render(<LocaleProvider locale="ru"><ProjectChat projectId={projectId} currentUserId="me" canSend initialMessages={[]} /></LocaleProvider>);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Новое сообщение'), 'Retry me');
    await user.click(screen.getByRole('button', { name: 'Отправить' }));
    await screen.findByRole('alert');
    expect((screen.getByLabelText('Новое сообщение') as HTMLTextAreaElement).value).toBe('Retry me');
    expect(document.querySelector('.project-chat__message')).toBeNull();
    expect(screen.getByRole('alert').textContent).not.toContain('private');
  });
  it('catches up on reconnect without duplicating existing live inserts', async () => {
    const realtime = setup();
    const missing = message('missing', 'Missed offline');
    realtime.result.mockResolvedValue({ data: [missing], error: null });
    const view = render(<LocaleProvider locale="ru"><ProjectChat projectId={projectId} currentUserId="me" canSend initialMessages={[]} /></LocaleProvider>);
    await act(async () => { realtime.receive(missing); realtime.status('SUBSCRIBED'); });
    await waitFor(() => expect(screen.getAllByText('Missed offline')).toHaveLength(1));
    await act(async () => { realtime.status('SUBSCRIBED'); });
    expect(screen.getAllByText('Missed offline')).toHaveLength(1);
    view.unmount();
    expect(realtime.removeChannel).toHaveBeenCalledTimes(1);
    await act(async () => realtime.receive(message('late', 'After unmount')));
  });
});
