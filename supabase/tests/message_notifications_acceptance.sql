-- All notifications must be created atomically with an authorized message.
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
insert into public.messages(id,project_id,sender_id,body) values
('77777777-7777-4777-8777-777777777777','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',auth.uid(),'Private message content must not be copied');
do $$ begin
  if exists (select 1 from public.notifications where message_id='77777777-7777-4777-8777-777777777777') then raise exception 'sender received own notification'; end if;
end $$;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
do $$ begin
  if (select count(*) from public.notifications where message_id='77777777-7777-4777-8777-777777777777' and project_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' and kind='message' and read_at is null)<>1 then raise exception 'recipient did not receive exactly one unread message notification'; end if;
  if exists (select 1 from public.notifications where message_id='77777777-7777-4777-8777-777777777777' and body like '%Private message content%') then raise exception 'notification copied private content'; end if;
end $$;
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
do $$ begin
  if exists (select 1 from public.notifications where message_id='77777777-7777-4777-8777-777777777777') then raise exception 'outsider received or read message notification'; end if;
end $$;
rollback;
do $$ begin
  if exists (select 1 from public.notifications where message_id='77777777-7777-4777-8777-777777777777') then raise exception 'notification survived message rollback'; end if;
  if has_function_privilege('authenticated','private.notify_project_message()','EXECUTE') or has_function_privilege('anon','private.notify_project_message()','EXECUTE') then raise exception 'trigger function callable by API roles'; end if;
end $$;
