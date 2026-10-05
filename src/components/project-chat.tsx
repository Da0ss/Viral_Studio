'use client';

import { type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { sendMessage } from '@/actions/messages';
import { createClient } from '@/lib/supabase/browser';
import type { ChatMessage } from '@/types/messages';

type Connection = 'connecting' | 'connected' | 'disconnected' | 'error';
const maxLength = 4000;
const sort = (items: ChatMessage[]) => [...items].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
const time = (value: string) => new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(new Date(value));

export function ProjectChat({ projectId, currentUserId, canSend, initialMessages }: { projectId: string; currentUserId: string; canSend: boolean; initialMessages: ChatMessage[] }) {
  const [messages, setMessages] = useState(() => sort(initialMessages));
  const [body, setBody] = useState(''); const [pending, setPending] = useState(false); const [error, setError] = useState<string | null>(null);
  const [connection, setConnection] = useState<Connection>('connecting'); const [reconnect, setReconnect] = useState(0); const [unread, setUnread] = useState(0);
  const [hasOlder, setHasOlder] = useState(initialMessages.length === 100);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const listRef = useRef<HTMLDivElement>(null); const atBottom = useRef(true); const ids = useRef(new Set(initialMessages.map((message) => message.id)));
  // Advance this checkpoint only after a complete catch-up, not on live INSERTs.
  const synchronizedThrough = useRef<ChatMessage | undefined>(sort(initialMessages).at(-1));
  const nearBottom = () => { const list = listRef.current; return !list || list.scrollHeight - list.scrollTop - list.clientHeight < 32; };
  const latest = () => { if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight; atBottom.current = true; setUnread(0); };
  const add = (message: ChatMessage, temporaryId?: string) => {
    if (ids.current.has(message.id)) { if (temporaryId) setMessages((items) => items.filter((item) => item.id !== temporaryId)); return false; }
    ids.current.add(message.id); setMessages((items) => sort([...items.filter((item) => item.id !== temporaryId), message])); return true;
  };
  useEffect(() => { if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight; atBottom.current = true; }, []);
  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    let syncing = false;
    async function catchUp() {
      if (syncing || cancelled) return;
      syncing = true;
      const wasAtBottom = nearBottom();
      let cursor = synchronizedThrough.current;
      try {
        for (;;) {
          let query = supabase.from('messages').select('id, project_id, sender_id, body, created_at').eq('project_id', projectId).order('created_at').order('id').limit(200);
          if (cursor) query = query.or(`created_at.gt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.gt.${cursor.id})`);
          const { data, error: queryError } = await query;
          if (cancelled) return;
          if (queryError) throw queryError;
          const batch = (data ?? []) as ChatMessage[];
          let otherMessages = 0;
          for (const message of batch) if (add(message) && message.sender_id !== currentUserId) otherMessages++;
          if (!wasAtBottom && otherMessages) setUnread((count) => count + otherMessages);
          if (batch.length) cursor = batch.at(-1);
          if (batch.length < 200) break;
        }
        synchronizedThrough.current = cursor;
        if (wasAtBottom) window.requestAnimationFrame(latest);
      } catch {
        if (!cancelled) { setConnection('error'); setError('Соединение восстановлено, но сообщения не синхронизированы. Повторите подключение.'); }
      } finally { syncing = false; }
    }
    const channel = supabase.channel(`project:${projectId}:messages`).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `project_id=eq.${projectId}` }, (payload) => {
      if (cancelled) return;
      const message = payload.new as ChatMessage; const wasAtBottom = nearBottom();
      if (!add(message)) return;
      if (wasAtBottom) window.requestAnimationFrame(latest); else if (message.sender_id !== currentUserId) setUnread((count) => count + 1);
    }).subscribe((status) => {
      if (cancelled) return;
      if (status === 'SUBSCRIBED') { setConnection('connected'); setError((value) => value?.startsWith('Соединение') ? null : value); void catchUp(); }
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') { setConnection('error'); setError('Соединение с чатом потеряно. Повторите подключение.'); }
      else if (status === 'CLOSED') setConnection('disconnected'); else setConnection('connecting');
    });
    return () => { cancelled = true; void supabase.removeChannel(channel); };
  }, [projectId, currentUserId, reconnect]);
  async function loadOlder() {
    if (loadingOlder) return;
    const oldest = messages.find((message) => !message.optimistic);
    if (!oldest) return;
    setLoadingOlder(true);
    const list = listRef.current;
    const previousHeight = list?.scrollHeight ?? 0;
    const previousTop = list?.scrollTop ?? 0;
    try {
      const { data, error: queryError } = await createClient().from('messages')
        .select('id, project_id, sender_id, body, created_at').eq('project_id', projectId)
        .or(`created_at.lt.${oldest.created_at},and(created_at.eq.${oldest.created_at},id.lt.${oldest.id})`)
        .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(100);
      if (queryError) throw queryError;
      const batch = (data ?? []) as ChatMessage[];
      for (const message of batch) add(message);
      setHasOlder(batch.length === 100);
      window.requestAnimationFrame(() => {
        if (list) list.scrollTop = previousTop + list.scrollHeight - previousHeight;
      });
    } catch { setError('Не удалось загрузить историю. Повторите попытку.'); }
    finally { setLoadingOlder(false); }
  }
  async function submit() {
    const text = body.trim();
    if (!canSend) { setError('У вас нет права отправлять сообщения в этот проект.'); return; }
    if (!text) { setError('Сообщение не может быть пустым.'); return; }
    if (text.length > maxLength) { setError(`Сообщение не должно превышать ${maxLength} символов.`); return; }
    if (pending) return;
    const temporaryId = `optimistic-${crypto.randomUUID()}`;
    const optimistic: ChatMessage = { id: temporaryId, project_id: projectId, sender_id: currentUserId, body: text, created_at: new Date().toISOString(), optimistic: true };
    ids.current.add(temporaryId); setMessages((items) => sort([...items, optimistic])); setBody(''); setPending(true); setError(null);
    try {
      const result = await sendMessage({ projectId, body: text });
      if (!result.ok) { ids.current.delete(temporaryId); setMessages((items) => items.filter((message) => message.id !== temporaryId)); setBody((value) => value || text); setError(result.error); return; }
      add(result.message, temporaryId); ids.current.delete(temporaryId); if (atBottom.current) window.requestAnimationFrame(latest);
    } catch {
      ids.current.delete(temporaryId); setMessages((items) => items.filter((message) => message.id !== temporaryId)); setBody((value) => value || text); setError('Не удалось отправить сообщение. Попробуйте ещё раз.');
    } finally { setPending(false); }
  }
  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void submit(); } }
  return <section className="project-chat" aria-label="Чат проекта">
    <header className="project-chat__header"><div><b>Сообщения</b><small aria-live="polite">{connection === 'connected' ? 'Онлайн' : connection === 'connecting' ? 'Подключаемся…' : 'Нет соединения'}</small></div>{connection !== 'connected' && <button className="ghost-button" type="button" onClick={() => { setError(null); setConnection('connecting'); setReconnect((value) => value + 1); }}>Переподключить</button>}</header>
    {error && <p className="project-chat__error" role="alert">{error}</p>}
    {hasOlder && <button className="ghost-button" type="button" disabled={loadingOlder} onClick={() => void loadOlder()}>{loadingOlder ? 'Загружаем…' : 'Предыдущие сообщения'}</button>}
    <div className="project-chat__messages" ref={listRef} onScroll={() => { atBottom.current = nearBottom(); if (atBottom.current) setUnread(0); }} aria-live="polite">
      {messages.length === 0 ? <div className="project-chat__empty"><b>СООБЩЕНИЙ ПОКА НЕТ</b><p>{canSend ? 'Начните разговор — первое сообщение увидят участники проекта.' : 'Новые сообщения появятся здесь.'}</p></div> : messages.map((message) => <article className={`project-chat__message ${message.sender_id === currentUserId ? 'mine' : ''} ${message.optimistic ? 'sending' : ''}`} key={message.id}><div><b>{message.sender_id === currentUserId ? 'Вы' : 'Участник проекта'}</b><time dateTime={message.created_at}>{message.optimistic ? 'Отправляем…' : time(message.created_at)}</time></div><p>{message.body}</p></article>)}
    </div>
    {unread > 0 && <button className="project-chat__unread" type="button" onClick={latest}>Новых сообщений: {unread}</button>}
    {canSend ? <div className="project-chat__composer"><label htmlFor="chat-body">Новое сообщение</label><textarea id="chat-body" value={body} onChange={(event) => setBody(event.target.value)} onKeyDown={onKeyDown} maxLength={maxLength} disabled={pending} placeholder="Введите сообщение…" rows={3} /><div><small>{body.length}/{maxLength} · Enter — отправить, Shift+Enter — новая строка</small><button className="cta" type="button" onClick={() => void submit()} disabled={pending || !body.trim()}><span>{pending ? 'Отправляем…' : 'Отправить'}</span></button></div></div> : <p className="project-chat__readonly">Вы можете читать чат, но отправка доступна ролям commenter, editor и owner.</p>}
  </section>;
}
