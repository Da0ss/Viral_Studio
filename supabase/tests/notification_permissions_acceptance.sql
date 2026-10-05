begin;
insert into public.notifications(id,user_id,kind,title,body) values
('20202020-2020-4020-8020-202020202020','11111111-1111-4111-8111-111111111111','message','Immutable producer','Fixture');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111"}',true);
do $$ declare affected integer; statement text; protected_column text; begin
  update public.notifications set read_at=clock_timestamp() where id='20202020-2020-4020-8020-202020202020' returning 1 into affected;
  if affected<>1 or not exists(select 1 from public.notifications where id='20202020-2020-4020-8020-202020202020' and read_at is not null) then
    raise exception 'Own mark-read failed';
  end if;
  foreach protected_column in array array['id','user_id','kind','title','body','project_id','created_at','updated_at','message_id'] loop
    if has_column_privilege('authenticated','public.notifications',protected_column,'UPDATE')
      or has_column_privilege('authenticated','public.notifications',protected_column,'INSERT') then
      raise exception 'Notification producer column writable';
    end if;
  end loop;
  foreach statement in array array[
    'update public.notifications set title=''Forged''',
    'update public.notifications set body=''Forged''',
    'update public.notifications set user_id=''33333333-3333-4333-8333-333333333333''',
    'insert into public.notifications(user_id,kind,title) values (''11111111-1111-4111-8111-111111111111'',''message'',''Forged'')',
    'delete from public.notifications',
    'truncate public.notifications'
  ] loop
    begin
      execute statement;
      raise exception 'Notification content mutation allowed';
    exception when insufficient_privilege then null; end;
  end loop;
end $$;
select set_config('request.jwt.claims','{"sub":"33333333-3333-4333-8333-333333333333"}',true);
do $$ declare affected integer; begin
  update public.notifications set read_at=null where id='20202020-2020-4020-8020-202020202020';
  get diagnostics affected = row_count;
  if affected<>0 then raise exception 'Foreign mark-read allowed'; end if;
  if exists(select 1 from public.notifications where id='20202020-2020-4020-8020-202020202020') then raise exception 'Foreign notification visible'; end if;
end $$;
rollback;
