begin;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111"}',true);
select * from public.create_generation_job(
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  '12121212-1212-4121-8121-121212121212',
  'Fixture prompt for acceptance'
);
select * from public.create_generation_job(
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  '12121212-1212-4121-8121-121212121212',
  '  Fixture prompt for acceptance  '
);
do $$ declare statement text; protected_column text; conflict_seen boolean := false; begin
  foreach protected_column in array array['id','status','dispatch_state','output','error_message','created_at','updated_at','completed_at','client_request_id','reservation_micro_usd'] loop
    if has_column_privilege('authenticated','public.generation_jobs',protected_column,'INSERT')
      or has_column_privilege('authenticated','public.generation_jobs',protected_column,'UPDATE') then
      raise exception 'Protected job column has client privileges';
    end if;
  end loop;
  if not exists(select 1 from public.generation_jobs where input->>'prompt'='Fixture prompt for acceptance' and status='queued' and output='{}'::jsonb and completed_at is null) then
    raise exception 'Client job defaults are not worker-safe';
  end if;
  begin
    perform * from public.create_generation_job('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','12121212-1212-4121-8121-121212121212','Different fixture prompt');
  exception when unique_violation then conflict_seen := true; end;
  if not conflict_seen then raise exception 'Conflicting idempotency key accepted'; end if;
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
  if exists(select 1 from public.generation_jobs where input->>'prompt'='Fixture prompt for acceptance') then raise exception 'Outsider read job'; end if;
  begin
    perform * from public.create_generation_job('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','14141414-1414-4141-8141-141414141414','Outsider fixture prompt');
    raise exception 'Outsider submitted job';
  exception when insufficient_privilege then null; end;
end $$;
set local role service_role;
do $$ declare fixture_job_id uuid; lease_id uuid; job_status text; job_uuid uuid; begin
  select id into job_uuid from public.generation_jobs where requested_by='11111111-1111-4111-8111-111111111111'
    and client_request_id='12121212-1212-4121-8121-121212121212';
  if (select count(*) from public.generation_jobs where requested_by='11111111-1111-4111-8111-111111111111'
    and client_request_id='12121212-1212-4121-8121-121212121212')<>1 then raise exception 'Idempotent retry created duplicate'; end if;
  if not exists(select 1 from public.generation_jobs where id=job_uuid and dispatch_state='queued' and reservation_micro_usd=50000) then raise exception 'Job was not durably queued and budget-reserved'; end if;
  if not exists(select 1 from private.generation_output_reservations where job_id=job_uuid and reserved_bytes=52428800) then raise exception 'Output quota reservation missing'; end if;
  select j.job_id,j.lease_token into fixture_job_id,lease_id
  from public.claim_generation_jobs(1) j;
  if fixture_job_id is null or lease_id is null then raise exception 'Worker did not claim queued fixture'; end if;
  if not public.authorize_generation_dispatch(fixture_job_id,lease_id) then raise exception 'Current owner/editor dispatch authorization rejected'; end if;
  if not public.record_generation_submission(fixture_job_id,lease_id,'/fal-ai/ltx-video-13b-distilled/requests/acceptance123') then raise exception 'Worker failed to persist provider path'; end if;
  select status into job_status from public.generation_jobs where id=fixture_job_id;
  if job_status <> 'running' then raise exception 'Submitted job status was not persisted'; end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111"}',true);
select * from public.cancel_generation_job((select id from public.generation_jobs where input->>'prompt'='Fixture prompt for acceptance'));
set local role service_role;
do $$ declare fixture_job_id uuid; lease_id uuid; begin
  select j.job_id,j.lease_token into fixture_job_id,lease_id from public.claim_generation_jobs(1) j;
  if fixture_job_id is null or not public.finish_generation_cancel(fixture_job_id,lease_id) then raise exception 'Worker could not finish authorized cancellation'; end if;
  if not exists(select 1 from public.generation_jobs where id=fixture_job_id and status='cancelled' and charged_micro_usd=50000 and reservation_micro_usd=0) then
    raise exception 'Cancellation did not retain conservative provider charge'; end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111"}',true);
select * from public.create_generation_job('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','16161616-1616-4161-8161-161616161616','Ambiguous submit acceptance prompt');
set local role service_role;
do $$ declare fixture_job_id uuid; stale_lease_id uuid; begin
  select j.job_id,j.lease_token into fixture_job_id,stale_lease_id from public.claim_generation_jobs(1) j;
  if fixture_job_id is null then raise exception 'Worker did not claim ambiguous-submit fixture'; end if;
  update public.generation_jobs set lease_until=clock_timestamp()-interval '1 second' where id=fixture_job_id and lease_token=stale_lease_id;
  perform * from public.claim_generation_jobs(1);
  if not exists(select 1 from public.generation_jobs where id=fixture_job_id and status='running' and dispatch_state='uncertain'
    and reservation_micro_usd=50000 and provider_request_path is null) then raise exception 'Lost submit acknowledgement was automatically retried or refunded'; end if;
  if public.record_generation_submission(fixture_job_id,stale_lease_id,'/fal-ai/ltx-video-13b-distilled/requests/stale123') then
    raise exception 'Expired submitting lease was allowed to attach a provider path'; end if;
  if not public.reconcile_generation_submission(fixture_job_id,false,null) then raise exception 'Manual rejected reconciliation failed'; end if;
  if not exists(select 1 from public.generation_jobs where id=fixture_job_id and status='failed' and reservation_micro_usd=0 and charged_micro_usd=0) then
    raise exception 'Rejected reconciliation did not release reservation'; end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111"}',true);
select * from public.create_generation_job('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','17171717-1717-4171-8171-171717171717','Revoke access before submission prompt');
reset role;
update public.organization_members set role='owner' where organization_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  and user_id='22222222-2222-4222-8222-222222222222';
update public.project_members set role='owner' where project_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  and user_id='22222222-2222-4222-8222-222222222222';
delete from public.project_members where project_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  and user_id='11111111-1111-4111-8111-111111111111';
set local role service_role;
do $$ declare fixture_job_id uuid; begin
  select id into fixture_job_id from public.generation_jobs where client_request_id='17171717-1717-4171-8171-171717171717';
  perform * from public.claim_generation_jobs(1);
  if not exists(select 1 from public.generation_jobs where id=fixture_job_id and status='cancelled' and last_error_code='requester_access_revoked') then
    raise exception 'Revoked queued request was not cancelled before paid dispatch'; end if;
  if exists(select 1 from private.generation_output_reservations where job_id=fixture_job_id) then raise exception 'Revoked request retained media quota reservation'; end if;
  if (select reserved_micro_usd from private.generation_budget_daily where bucket_user='11111111-1111-4111-8111-111111111111' and usage_day=(clock_timestamp() at time zone 'UTC')::date)<>0 then
    raise exception 'Revoked request retained generation budget reservation'; end if;
end $$;
rollback;
