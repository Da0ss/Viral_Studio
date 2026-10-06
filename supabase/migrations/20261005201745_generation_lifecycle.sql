-- Paid requests are persisted and budgeted before dispatch. An ambiguous
-- submit acknowledgement becomes `uncertain` and is never automatically resent.
alter table public.generation_jobs
  add column client_request_id uuid,
  add column provider text not null default 'fal-ai' check (provider = 'fal-ai'),
  add column model text not null default 'Lightricks/LTX-Video-0.9.7-distilled' check (model = 'Lightricks/LTX-Video-0.9.7-distilled'),
  add column dispatch_state text not null default 'queued' check (dispatch_state in ('queued','submitting','submitted','polling','cancelling','uncertain','finalized')),
  add column provider_request_path text,
  add column output_storage_path text,
  add column output_asset_id uuid,
  add column cancel_requested_at timestamptz,
  add column lease_token uuid,
  add column lease_until timestamptz,
  add column next_attempt_at timestamptz not null default clock_timestamp(),
  add column attempt_count integer not null default 0 check (attempt_count between 0 and 10000),
  add column uncertain_at timestamptz,
  add column last_error_code text check (last_error_code is null or last_error_code ~ '^[a-z][a-z0-9_]{0,63}$'),
  add column reservation_day date,
  add column reservation_micro_usd bigint not null default 50000 check (reservation_micro_usd between 0 and 50000),
  add column charged_micro_usd bigint not null default 0 check (charged_micro_usd between 0 and 50000),
  add constraint generation_jobs_request_key_unique unique (requested_by, client_request_id),
  add constraint generation_jobs_lease_pair_check check ((lease_token is null) = (lease_until is null)),
  add constraint generation_jobs_provider_path_check check (provider_request_path is null or provider_request_path ~ '^/fal-ai/ltx-video-13b-distilled/requests/[A-Za-z0-9_-]{1,100}$'),
  add constraint generation_jobs_output_path_check check (output_storage_path is null or output_storage_path = 'projects/' || project_id::text || '/' || id::text || '/generation.mp4'),
  add constraint generation_jobs_output_asset_check check (status <> 'completed' or output_asset_id is not null);

update public.generation_jobs set client_request_id = id, reservation_day = (created_at at time zone 'UTC')::date;
update public.generation_jobs set status='failed',dispatch_state='finalized',reservation_micro_usd=0,
  error_message='The job predates durable provider billing and was not submitted.',completed_at=coalesce(completed_at,clock_timestamp())
  where status in ('queued','running');
alter table public.generation_jobs alter column client_request_id set not null;
alter table public.generation_jobs alter column reservation_day set not null;
drop policy if exists "generation_jobs: owners and editors create" on public.generation_jobs;
revoke insert (project_id, requested_by, input) on public.generation_jobs from public, anon, authenticated;
revoke select on public.generation_jobs from authenticated;
grant select (id, project_id, requested_by, status, dispatch_state, input, output, error_message, created_at, updated_at, completed_at)
  on public.generation_jobs to authenticated;
create index generation_jobs_dispatch_queue_idx on public.generation_jobs(next_attempt_at, created_at, id)
  where status = 'queued' or (status = 'running' and dispatch_state in ('submitted','polling','cancelling'));
create index generation_jobs_expired_lease_idx on public.generation_jobs(lease_until) where lease_token is not null;

create table private.generation_budget_settings (
  singleton boolean primary key default true check (singleton),
  daily_global_micro_usd bigint not null default 1000000 check (daily_global_micro_usd between 50000 and 1000000000),
  daily_user_micro_usd bigint not null default 500000 check (daily_user_micro_usd between 50000 and 500000000),
  updated_at timestamptz not null default clock_timestamp()
);
insert into private.generation_budget_settings(singleton) values (true);
alter table private.generation_budget_settings enable row level security;
revoke all on private.generation_budget_settings from public, anon, authenticated;
grant select, insert, update, delete on private.generation_budget_settings to service_role;

create table private.generation_budget_daily (
  usage_day date not null,
  bucket_user uuid not null,
  reserved_micro_usd bigint not null default 0 check (reserved_micro_usd >= 0),
  spent_micro_usd bigint not null default 0 check (spent_micro_usd >= 0),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (usage_day, bucket_user)
);
alter table private.generation_budget_daily enable row level security;
revoke all on private.generation_budget_daily from public, anon, authenticated;
grant select, insert, update, delete on private.generation_budget_daily to service_role;
create index generation_budget_daily_user_day_idx on private.generation_budget_daily(bucket_user, usage_day desc);

create table private.generation_output_reservations (
  job_id uuid primary key references public.generation_jobs(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  reserved_bytes bigint not null default 52428800 check (reserved_bytes = 52428800),
  created_at timestamptz not null default clock_timestamp()
);
alter table private.generation_output_reservations enable row level security;
revoke all on private.generation_output_reservations from public, anon, authenticated;
grant select, insert, update, delete on private.generation_output_reservations to service_role;

create or replace function private.project_media_usage(target_project uuid) returns bigint
language sql stable security definer set search_path = '' as $$
  select coalesce((select sum(bytes) from (
    select a.size_bytes::bigint as bytes from public.assets a where a.project_id = target_project
    union all select v.size_bytes::bigint from public.asset_versions v join public.assets a on a.id = v.asset_id where a.project_id = target_project
    union all select i.reserved_bytes from private.media_upload_intents i where i.project_id = target_project and i.state in ('uploading','cleanup_pending')
    union all select r.reserved_bytes from private.generation_output_reservations r where r.project_id = target_project
  ) usage_rows), 0)::bigint;
$$;
revoke all on function private.project_media_usage(uuid) from public, anon, authenticated;

create function private.settle_generation_budget(target_job uuid, charge_micro_usd bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare job public.generation_jobs; changed_rows integer;
begin
  select * into job from public.generation_jobs where id = target_job for update;
  if not found then raise exception 'Generation job missing' using errcode = 'P0002'; end if;
  if charge_micro_usd < 0 or charge_micro_usd > job.reservation_micro_usd then raise exception 'Invalid generation charge' using errcode = '22023'; end if;
  if job.reservation_micro_usd = 0 then return; end if;
  update private.generation_budget_daily set reserved_micro_usd = reserved_micro_usd-job.reservation_micro_usd,
    spent_micro_usd = spent_micro_usd+charge_micro_usd, updated_at=clock_timestamp()
  where usage_day=job.reservation_day and bucket_user in ('00000000-0000-0000-0000-000000000000'::uuid,job.requested_by)
    and reserved_micro_usd>=job.reservation_micro_usd;
  get diagnostics changed_rows = row_count;
  if changed_rows <> 2 then raise exception 'Generation reservation is inconsistent' using errcode='23514'; end if;
  update public.generation_jobs set reservation_micro_usd=0,charged_micro_usd=charge_micro_usd where id=target_job;
end $$;
revoke all on function private.settle_generation_budget(uuid,bigint) from public, anon, authenticated;
grant execute on function private.settle_generation_budget(uuid,bigint) to service_role;

create function private.create_generation_job_internal(target_project uuid, request_key uuid, generation_prompt text)
returns table(job_id uuid, job_status public.generation_status, was_reused boolean)
language plpgsql volatile security definer set search_path = '' as $$
declare caller uuid := (select auth.uid()); existing public.generation_jobs; policy private.generation_budget_settings;
  day_key date := (clock_timestamp() at time zone 'UTC')::date; global_bucket constant uuid := '00000000-0000-0000-0000-000000000000';
  used_global bigint; used_user bigint; created_job public.generation_jobs; quota_bytes bigint; media_used bigint; normalized_prompt text := trim(generation_prompt);
begin
  if caller is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if request_key is null or generation_prompt is null or char_length(normalized_prompt) not between 10 and 2000 then
    raise exception 'Invalid generation request' using errcode='22023';
  end if;
  if not exists (
    select 1 from public.project_members m join public.projects p on p.id=m.project_id
      join public.organization_members om on om.organization_id=p.organization_id and om.user_id=m.user_id
    where m.project_id=target_project and m.user_id=caller and m.role in ('owner','editor')
  ) then raise exception 'Project generation forbidden' using errcode='42501'; end if;
  select * into existing from public.generation_jobs j where j.requested_by=caller and j.client_request_id=request_key for update;
  if found then
    if existing.project_id<>target_project or existing.input->>'prompt'<>normalized_prompt then raise exception 'Idempotency key conflict' using errcode='23505'; end if;
    return query select existing.id,existing.status,true; return;
  end if;
  select * into policy from private.generation_budget_settings where singleton;
  insert into private.generation_budget_daily(usage_day,bucket_user) values(day_key,global_bucket),(day_key,caller) on conflict do nothing;
  perform 1 from private.generation_budget_daily b where b.usage_day=day_key and b.bucket_user in (global_bucket,caller) order by b.bucket_user for update;
  select reserved_micro_usd+spent_micro_usd into used_global from private.generation_budget_daily where usage_day=day_key and bucket_user=global_bucket;
  select reserved_micro_usd+spent_micro_usd into used_user from private.generation_budget_daily where usage_day=day_key and bucket_user=caller;
  if used_global+50000>policy.daily_global_micro_usd then raise exception 'Daily generation budget exhausted' using errcode='P0001'; end if;
  if used_user+50000>policy.daily_user_micro_usd then raise exception 'Personal daily generation limit reached' using errcode='P0001'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('media-quota:'||target_project::text,0));
  quota_bytes := coalesce((select q.quota_bytes from private.media_project_quotas q where q.project_id=target_project),1073741824);
  media_used := private.project_media_usage(target_project);
  if media_used+52428800>quota_bytes then raise exception 'Project media quota cannot reserve generation output' using errcode='P0001'; end if;
  insert into public.generation_jobs(project_id,requested_by,input,client_request_id,reservation_day,reservation_micro_usd)
    values(target_project,caller,jsonb_build_object('prompt',normalized_prompt),request_key,day_key,50000) returning * into created_job;
  insert into private.generation_output_reservations(job_id,project_id) values(created_job.id,target_project);
  update private.generation_budget_daily set reserved_micro_usd=reserved_micro_usd+50000,updated_at=clock_timestamp()
    where usage_day=day_key and bucket_user in (global_bucket,caller);
  return query select created_job.id,created_job.status,false;
end $$;
revoke all on function private.create_generation_job_internal(uuid,uuid,text) from public, anon;
grant execute on function private.create_generation_job_internal(uuid,uuid,text) to authenticated;
create function public.create_generation_job(target_project uuid,request_key uuid,generation_prompt text)
returns table(job_id uuid,job_status public.generation_status,was_reused boolean)
language sql volatile security invoker set search_path = '' as $$
  select * from private.create_generation_job_internal(target_project,request_key,generation_prompt);
$$;
revoke all on function public.create_generation_job(uuid,uuid,text) from public, anon;
grant execute on function public.create_generation_job(uuid,uuid,text) to authenticated;

create function private.cancel_generation_job_internal(target_job uuid)
returns table(job_status public.generation_status,cancellation_requested boolean)
language plpgsql volatile security definer set search_path = '' as $$
declare caller uuid := (select auth.uid()); job public.generation_jobs;
begin
  if caller is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select * into job from public.generation_jobs j where j.id=target_job for update;
  if not found then return; end if;
  if not exists (select 1 from public.project_members m where m.project_id=job.project_id and m.user_id=caller and m.role in ('owner','editor')) then
    raise exception 'Generation cancellation forbidden' using errcode='42501';
  end if;
  if job.status='queued' then
    perform private.settle_generation_budget(target_job,0);
    update public.generation_jobs set status='cancelled',dispatch_state='finalized',completed_at=clock_timestamp(),updated_at=clock_timestamp() where id=target_job;
    delete from private.generation_output_reservations where job_id=target_job;
    return query select 'cancelled'::public.generation_status,true; return;
  end if;
  if job.status='running' then
    update public.generation_jobs set cancel_requested_at=coalesce(cancel_requested_at,clock_timestamp()),
      dispatch_state=case when provider_request_path is not null then 'cancelling' else dispatch_state end,
      next_attempt_at=clock_timestamp(),updated_at=clock_timestamp() where id=target_job;
    return query select 'running'::public.generation_status,true; return;
  end if;
  return query select job.status,false;
end $$;
revoke all on function private.cancel_generation_job_internal(uuid) from public, anon;
grant execute on function private.cancel_generation_job_internal(uuid) to authenticated;
create function public.cancel_generation_job(target_job uuid)
returns table(job_status public.generation_status,cancellation_requested boolean)
language sql volatile security invoker set search_path = '' as $$
  select * from private.cancel_generation_job_internal(target_job);
$$;
revoke all on function public.cancel_generation_job(uuid) from public, anon;
grant execute on function public.cancel_generation_job(uuid) to authenticated;

create function public.claim_generation_jobs(batch_size integer default 4)
returns table(job_id uuid,dispatch_state text,lease_token uuid,project_id uuid,requested_by uuid,
  prompt text,provider_request_path text,cancel_requested boolean,output_storage_path text)
language plpgsql volatile security invoker set search_path = '' as $$
declare revoked_job record;
begin
  if batch_size is null or batch_size not between 1 and 8 then raise exception 'Invalid generation batch size' using errcode='22023'; end if;
  -- A queued request is still unpaid. If its owner/editor access was revoked,
  -- close it without dispatch and release both financial and byte reservations.
  for revoked_job in
    select j.id from public.generation_jobs j
    where j.status='queued' and j.dispatch_state='queued'
      and not exists (
        select 1 from public.project_members m
          join public.projects p on p.id=m.project_id
          join public.organization_members om on om.organization_id=p.organization_id and om.user_id=m.user_id
        where m.project_id=j.project_id and m.user_id=j.requested_by and m.role in ('owner','editor')
      )
    order by j.created_at,j.id limit 50 for update of j skip locked
  loop
    perform private.settle_generation_budget(revoked_job.id,0);
    delete from private.generation_output_reservations as r where r.job_id=revoked_job.id;
    update public.generation_jobs as revoked set status='cancelled',dispatch_state='finalized',completed_at=clock_timestamp(),
      last_error_code='requester_access_revoked',updated_at=clock_timestamp()
      where revoked.id=revoked_job.id and revoked.status='queued' and revoked.dispatch_state='queued';
  end loop;
  update public.generation_jobs as expired set dispatch_state='uncertain',uncertain_at=clock_timestamp(),last_error_code='submission_ack_lost',lease_token=null,lease_until=null,updated_at=clock_timestamp()
    where expired.status='running' and expired.dispatch_state='submitting' and expired.provider_request_path is null and expired.lease_until<=clock_timestamp();
  return query with candidates as (
    select j.id from public.generation_jobs j
    where (j.status='queued' and j.dispatch_state='queued' and j.next_attempt_at<=clock_timestamp() and j.lease_token is null)
      or (j.status='running' and j.dispatch_state in ('submitted','polling','cancelling') and j.next_attempt_at<=clock_timestamp() and (j.lease_until is null or j.lease_until<=clock_timestamp()))
    order by j.next_attempt_at,j.created_at,j.id limit batch_size for update skip locked
  ), claimed as (
    update public.generation_jobs j set status='running',dispatch_state=case when j.dispatch_state='queued' then 'submitting' else j.dispatch_state end,
      attempt_count=j.attempt_count+1,lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '90 seconds',updated_at=clock_timestamp()
    from candidates c where j.id=c.id returning j.*
  ) select c.id,c.dispatch_state,c.lease_token,c.project_id,c.requested_by,c.input->>'prompt',c.provider_request_path,
      c.cancel_requested_at is not null,c.output_storage_path from claimed c;
end $$;
revoke all on function public.claim_generation_jobs(integer) from public, anon, authenticated;
grant execute on function public.claim_generation_jobs(integer) to service_role;

create function public.claim_generation_job_for_view(target_job uuid, viewer_id uuid)
returns table(job_id uuid,dispatch_state text,lease_token uuid,project_id uuid,requested_by uuid,
  prompt text,provider_request_path text,cancel_requested boolean,output_storage_path text)
language plpgsql volatile security invoker set search_path = '' as $$
begin
  if viewer_id is null then return; end if;
  return query with picked as (
    select j.id from public.generation_jobs j
      join public.project_members m on m.project_id=j.project_id and m.user_id=viewer_id and m.role in ('owner','editor')
      join public.projects p on p.id=j.project_id
      join public.organization_members om on om.organization_id=p.organization_id and om.user_id=viewer_id
    where j.id=target_job and (
      (j.status='queued' and j.dispatch_state='queued') or
      (j.status='running' and j.dispatch_state in ('submitted','polling','cancelling'))
    ) and j.next_attempt_at<=clock_timestamp()
      and (j.lease_until is null or j.lease_until<=clock_timestamp()) for update of j skip locked
  ), claimed as (
    update public.generation_jobs j set status='running',dispatch_state=case when j.dispatch_state='queued' then 'submitting' else j.dispatch_state end,
      attempt_count=j.attempt_count+1,lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '90 seconds',updated_at=clock_timestamp()
    from picked p where j.id=p.id returning j.*
  ) select c.id,c.dispatch_state,c.lease_token,c.project_id,c.requested_by,c.input->>'prompt',c.provider_request_path,
      c.cancel_requested_at is not null,c.output_storage_path from claimed c;
end $$;
revoke all on function public.claim_generation_job_for_view(uuid,uuid) from public, anon, authenticated;
grant execute on function public.claim_generation_job_for_view(uuid,uuid) to service_role;

create function public.record_generation_submission(target_job uuid,token uuid,request_path text)
returns boolean language plpgsql volatile security invoker set search_path = '' as $$
begin
  if request_path is null or request_path !~ '^/fal-ai/ltx-video-13b-distilled/requests/[A-Za-z0-9_-]{1,100}$' then raise exception 'Invalid provider request path' using errcode='22023'; end if;
  update public.generation_jobs set provider_request_path=request_path,
    dispatch_state=case when cancel_requested_at is null then 'submitted' else 'cancelling' end,
    next_attempt_at=clock_timestamp(),lease_token=null,lease_until=null,last_error_code=null,updated_at=clock_timestamp()
  where id=target_job and status='running' and dispatch_state='submitting' and lease_token=token and lease_until>clock_timestamp();
  return found;
end $$;
revoke all on function public.record_generation_submission(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.record_generation_submission(uuid,uuid,text) to service_role;

create function public.mark_generation_uncertain(target_job uuid,token uuid,error_code text)
returns boolean language plpgsql volatile security invoker set search_path = '' as $$
begin
  update public.generation_jobs set dispatch_state='uncertain',uncertain_at=clock_timestamp(),last_error_code=error_code,lease_token=null,lease_until=null,updated_at=clock_timestamp()
  where id=target_job and status='running' and dispatch_state='submitting' and provider_request_path is null and lease_token=token and lease_until>clock_timestamp();
  return found;
end $$;
revoke all on function public.mark_generation_uncertain(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.mark_generation_uncertain(uuid,uuid,text) to service_role;

create function public.finish_generation_without_charge(target_job uuid,token uuid,error_code text)
returns boolean language plpgsql volatile security invoker set search_path = '' as $$
declare job public.generation_jobs;
begin
  select * into job from public.generation_jobs j where j.id=target_job and j.status='running' and j.dispatch_state='submitting'
    and j.provider_request_path is null and j.lease_token=token and j.lease_until>clock_timestamp() for update;
  if not found then return false; end if;
  perform private.settle_generation_budget(target_job,0);
  delete from private.generation_output_reservations where job_id=target_job;
  update public.generation_jobs set status='failed',dispatch_state='finalized',error_message='The generation request was rejected before provider acceptance.',last_error_code=error_code,completed_at=clock_timestamp(),lease_token=null,lease_until=null,updated_at=clock_timestamp() where id=target_job;
  return true;
end $$;
revoke all on function public.finish_generation_without_charge(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.finish_generation_without_charge(uuid,uuid,text) to service_role;

create function public.finish_generation_pre_submit_cancel(target_job uuid,token uuid)
returns boolean language plpgsql volatile security invoker set search_path = '' as $$
declare job public.generation_jobs;
begin
  select * into job from public.generation_jobs j where j.id=target_job and j.status='running'
    and j.dispatch_state='submitting' and j.provider_request_path is null and j.cancel_requested_at is not null
    and j.lease_token=token and j.lease_until>clock_timestamp() for update;
  if not found then return false; end if;
  perform private.settle_generation_budget(target_job,0);
  delete from private.generation_output_reservations where job_id=target_job;
  update public.generation_jobs set status='cancelled',dispatch_state='finalized',completed_at=clock_timestamp(),
    lease_token=null,lease_until=null,updated_at=clock_timestamp() where id=target_job;
  return true;
end $$;
revoke all on function public.finish_generation_pre_submit_cancel(uuid,uuid) from public, anon, authenticated;
grant execute on function public.finish_generation_pre_submit_cancel(uuid,uuid) to service_role;

create function public.authorize_generation_dispatch(target_job uuid,token uuid)
returns boolean language plpgsql volatile security invoker set search_path = '' as $$
declare job public.generation_jobs;
begin
  select * into job from public.generation_jobs j where j.id=target_job and j.status='running'
    and j.dispatch_state='submitting' and j.provider_request_path is null and j.lease_token=token
    and j.lease_until>clock_timestamp() for update;
  if not found then return false; end if;
  if not exists (
    select 1 from public.project_members m join public.projects p on p.id=m.project_id
      join public.organization_members om on om.organization_id=p.organization_id and om.user_id=m.user_id
    where m.project_id=job.project_id and m.user_id=job.requested_by and m.role in ('owner','editor')
  ) then
    perform private.settle_generation_budget(target_job,0);
    delete from private.generation_output_reservations where job_id=target_job;
    update public.generation_jobs set status='cancelled',dispatch_state='finalized',completed_at=clock_timestamp(),
      last_error_code='requester_access_revoked',lease_token=null,lease_until=null,updated_at=clock_timestamp()
      where id=target_job;
    return false;
  end if;
  return true;
end $$;
revoke all on function public.authorize_generation_dispatch(uuid,uuid) from public, anon, authenticated;
grant execute on function public.authorize_generation_dispatch(uuid,uuid) to service_role;

create function public.retry_generation_poll(target_job uuid,token uuid,delay_seconds integer,error_code text default null)
returns boolean language plpgsql volatile security invoker set search_path = '' as $$
begin
  if delay_seconds is null or delay_seconds not between 5 and 3600 then raise exception 'Invalid generation retry delay' using errcode='22023'; end if;
  update public.generation_jobs set dispatch_state=case when cancel_requested_at is null then 'submitted' else 'cancelling' end,
    next_attempt_at=clock_timestamp()+make_interval(secs=>delay_seconds),last_error_code=error_code,lease_token=null,lease_until=null,updated_at=clock_timestamp()
  where id=target_job and status='running' and provider_request_path is not null and lease_token=token and lease_until>clock_timestamp();
  return found;
end $$;
revoke all on function public.retry_generation_poll(uuid,uuid,integer,text) from public, anon, authenticated;
grant execute on function public.retry_generation_poll(uuid,uuid,integer,text) to service_role;

create function public.finish_generation_failure(target_job uuid,token uuid,error_code text)
returns boolean language plpgsql volatile security invoker set search_path = '' as $$
declare job public.generation_jobs;
begin
  select * into job from public.generation_jobs j where j.id=target_job and j.status='running' and j.provider_request_path is not null
    and j.lease_token=token and j.lease_until>clock_timestamp() for update;
  if not found then return false; end if;
  perform private.settle_generation_budget(target_job,job.reservation_micro_usd);
  if job.output_storage_path is not null then
    insert into private.media_deletion_outbox(asset_id,project_id,object_path)
    values(job.id,job.project_id,job.output_storage_path) on conflict(object_path) do nothing;
  end if;
  delete from private.generation_output_reservations where job_id=target_job;
  update public.generation_jobs set status='failed',dispatch_state='finalized',error_message='The provider could not complete this generation.',last_error_code=error_code,completed_at=clock_timestamp(),lease_token=null,lease_until=null,updated_at=clock_timestamp() where id=target_job;
  return true;
end $$;
revoke all on function public.finish_generation_failure(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.finish_generation_failure(uuid,uuid,text) to service_role;

create function public.finish_generation_cancel(target_job uuid,token uuid)
returns boolean language plpgsql volatile security invoker set search_path = '' as $$
declare job public.generation_jobs;
begin
  select * into job from public.generation_jobs j where j.id=target_job and j.status='running' and j.dispatch_state='cancelling'
    and j.lease_token=token and j.lease_until>clock_timestamp() for update;
  if not found then return false; end if;
  perform private.settle_generation_budget(target_job,job.reservation_micro_usd);
  if job.output_storage_path is not null then
    insert into private.media_deletion_outbox(asset_id,project_id,object_path)
    values(job.id,job.project_id,job.output_storage_path) on conflict(object_path) do nothing;
  end if;
  delete from private.generation_output_reservations where job_id=target_job;
  update public.generation_jobs set status='cancelled',dispatch_state='finalized',error_message=null,completed_at=clock_timestamp(),lease_token=null,lease_until=null,updated_at=clock_timestamp() where id=target_job;
  return true;
end $$;
revoke all on function public.finish_generation_cancel(uuid,uuid) from public, anon, authenticated;
grant execute on function public.finish_generation_cancel(uuid,uuid) to service_role;

create function public.prepare_generation_output(target_job uuid,token uuid)
returns text language plpgsql volatile security invoker set search_path = '' as $$
declare path text;
begin
  update public.generation_jobs set output_storage_path='projects/'||project_id::text||'/'||id::text||'/generation.mp4',updated_at=clock_timestamp()
  where id=target_job and status='running' and dispatch_state='submitted' and cancel_requested_at is null and lease_token=token and lease_until>clock_timestamp()
  returning output_storage_path into path;
  return path;
end $$;
revoke all on function public.prepare_generation_output(uuid,uuid) from public, anon, authenticated;
grant execute on function public.prepare_generation_output(uuid,uuid) to service_role;

create function public.extend_generation_lease(target_job uuid,token uuid)
returns boolean language plpgsql volatile security invoker set search_path = '' as $$
begin
  update public.generation_jobs set lease_until=clock_timestamp()+interval '90 seconds',updated_at=clock_timestamp()
  where id=target_job and status='running' and dispatch_state in ('submitted','cancelling') and lease_token=token and lease_until>clock_timestamp();
  return found;
end $$;
revoke all on function public.extend_generation_lease(uuid,uuid) from public, anon, authenticated;
grant execute on function public.extend_generation_lease(uuid,uuid) to service_role;

create function public.finish_generation_success(target_job uuid,token uuid,output_size_bytes bigint)
returns uuid language plpgsql volatile security invoker set search_path = '' as $$
declare job public.generation_jobs; stored_asset_id uuid;
begin
  if output_size_bytes is null or output_size_bytes not between 1 and 52428800 then raise exception 'Invalid generated output size' using errcode='22023'; end if;
  select * into job from public.generation_jobs j where j.id=target_job and j.status='running' and j.dispatch_state='submitted'
    and j.cancel_requested_at is null and j.lease_token=token and j.lease_until>clock_timestamp() for update;
  if not found then return null; end if;
  if job.output_storage_path is distinct from 'projects/'||job.project_id::text||'/'||job.id::text||'/generation.mp4' then raise exception 'Generated output path is not prepared' using errcode='23514'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('media-quota:'||job.project_id::text,0));
  delete from private.generation_output_reservations where job_id=target_job;
  insert into public.assets(id,project_id,kind,name,storage_path,mime_type,size_bytes,created_by)
    values(target_job,job.project_id,'video'::public.asset_kind,'Generated video',job.output_storage_path,'video/mp4',output_size_bytes,job.requested_by)
    returning id into stored_asset_id;
  perform private.settle_generation_budget(target_job,job.reservation_micro_usd);
  update public.generation_jobs set status='completed',dispatch_state='finalized',output=jsonb_build_object('asset_id',stored_asset_id,'name','Generated video'),output_asset_id=stored_asset_id,
    completed_at=clock_timestamp(),last_error_code=null,lease_token=null,lease_until=null,updated_at=clock_timestamp() where id=target_job;
  insert into public.notifications(user_id,kind,title,body,project_id)
    values(job.requested_by,'generation','Видео готово','Сгенерированный файл сохранён в медиатеке.',job.project_id);
  return stored_asset_id;
end $$;
revoke all on function public.finish_generation_success(uuid,uuid,bigint) from public, anon, authenticated;
grant execute on function public.finish_generation_success(uuid,uuid,bigint) to service_role;

create function public.reconcile_generation_submission(target_job uuid,provider_accepted boolean,request_path text default null)
returns boolean language plpgsql volatile security invoker set search_path = '' as $$
declare job public.generation_jobs;
begin
  select * into job from public.generation_jobs j where j.id=target_job and j.status='running' and j.dispatch_state='uncertain' for update;
  if not found then return false; end if;
  if provider_accepted then
    if request_path is null or request_path !~ '^/fal-ai/ltx-video-13b-distilled/requests/[A-Za-z0-9_-]{1,100}$' then raise exception 'Invalid provider request path' using errcode='22023'; end if;
    update public.generation_jobs set provider_request_path=request_path,
      dispatch_state=case when cancel_requested_at is null then 'submitted' else 'cancelling' end,
      uncertain_at=null,last_error_code=null,next_attempt_at=clock_timestamp(),updated_at=clock_timestamp() where id=target_job;
  else
    perform private.settle_generation_budget(target_job,0);
    delete from private.generation_output_reservations where job_id=target_job;
    update public.generation_jobs set status='failed',dispatch_state='finalized',error_message='Provider reconciliation confirmed the request was not accepted.',
      last_error_code='reconciled_not_accepted',completed_at=clock_timestamp(),updated_at=clock_timestamp() where id=target_job;
  end if;
  return true;
end $$;
revoke all on function public.reconcile_generation_submission(uuid,boolean,text) from public, anon, authenticated;
grant execute on function public.reconcile_generation_submission(uuid,boolean,text) to service_role;

create function public.set_generation_budget(daily_global_micro_usd bigint,daily_user_micro_usd bigint)
returns void language plpgsql volatile security invoker set search_path = '' as $$
begin
  if daily_global_micro_usd not between 50000 and 1000000000 or daily_user_micro_usd not between 50000 and 500000000 then
    raise exception 'Invalid daily generation budget' using errcode='22023';
  end if;
  update private.generation_budget_settings set daily_global_micro_usd=set_generation_budget.daily_global_micro_usd,
    daily_user_micro_usd=set_generation_budget.daily_user_micro_usd,updated_at=clock_timestamp() where singleton;
end $$;
revoke all on function public.set_generation_budget(bigint,bigint) from public, anon, authenticated;
grant execute on function public.set_generation_budget(bigint,bigint) to service_role;
