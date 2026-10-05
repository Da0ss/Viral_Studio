begin;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111"}',true);
insert into public.generation_jobs(project_id,requested_by,input)
values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','11111111-1111-4111-8111-111111111111','{"prompt":"Fixture"}');
do $$ declare statement text; protected_column text; begin
  foreach protected_column in array array['id','status','output','error_message','created_at','updated_at','completed_at'] loop
    if has_column_privilege('authenticated','public.generation_jobs',protected_column,'INSERT')
      or has_column_privilege('authenticated','public.generation_jobs',protected_column,'UPDATE') then
      raise exception 'Protected job column has client privileges';
    end if;
  end loop;
  if not exists(select 1 from public.generation_jobs where input->>'prompt'='Fixture' and status='queued' and output='{}'::jsonb and completed_at is null) then
    raise exception 'Client job defaults are not worker-safe';
  end if;
  foreach statement in array array[
    'update public.generation_jobs set status=''running''',
    'update public.generation_jobs set output=''{}''',
    'update public.generation_jobs set error_message=''forged''',
    'update public.generation_jobs set requested_by=''33333333-3333-4333-8333-333333333333''',
    'update public.generation_jobs set input=''{}''',
    'delete from public.generation_jobs',
    'truncate public.generation_jobs',
    'insert into public.generation_jobs(project_id,requested_by,input,status) values (''bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'',''11111111-1111-4111-8111-111111111111'',''{}'',''running'')',
    'insert into public.generation_jobs(project_id,requested_by,input,output) values (''bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'',''11111111-1111-4111-8111-111111111111'',''{}'',''{}'')'
  ] loop
    begin
      execute statement;
      raise exception 'Client changed worker-owned job data';
    exception when insufficient_privilege then null; end;
  end loop;
  begin
    insert into public.generation_jobs(project_id,requested_by,input)
    values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','33333333-3333-4333-8333-333333333333','{}');
    raise exception 'Forged requester accepted';
  exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claims','{"sub":"33333333-3333-4333-8333-333333333333"}',true);
do $$ begin
  if exists(select 1 from public.generation_jobs where input->>'prompt'='Fixture') then raise exception 'Outsider read job'; end if;
  begin
    insert into public.generation_jobs(project_id,requested_by,input)
    values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','33333333-3333-4333-8333-333333333333','{}');
    raise exception 'Outsider submitted job';
  exception when insufficient_privilege then null; end;
end $$;
set local role service_role;
do $$ declare changed integer; begin
  update public.generation_jobs set status='completed',output='{"fixture":true}',completed_at=clock_timestamp()
  where input->>'prompt'='Fixture';
  get diagnostics changed = row_count;
  if changed<>1 then raise exception 'Worker cannot persist result'; end if;
end $$;
rollback;
