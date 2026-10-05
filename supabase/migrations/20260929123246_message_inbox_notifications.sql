-- In-app delivery only. Recipients come from authorized project membership,
-- never from browser-submitted notification payloads.
alter table public.notifications add column message_id uuid references public.messages(id) on delete cascade;
create unique index notifications_message_recipient_unique_idx
on public.notifications(message_id, user_id) where message_id is not null;

create function private.notify_project_message()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.notifications(user_id,kind,title,body,project_id,message_id)
  select m.user_id, 'message', 'Новое сообщение в проекте',
    'Откройте чат проекта, чтобы прочитать сообщение.', new.project_id, new.id
  from public.project_members m
  join public.projects p on p.id=m.project_id
  join public.organization_members om on om.organization_id=p.organization_id and om.user_id=m.user_id
  where m.project_id=new.project_id and m.user_id<>new.sender_id
  on conflict (message_id,user_id) where message_id is not null do nothing;
  return new;
end;
$$;
revoke all on function private.notify_project_message() from public, anon, authenticated;
create trigger messages_notify_participants after insert on public.messages
for each row execute function private.notify_project_message();
