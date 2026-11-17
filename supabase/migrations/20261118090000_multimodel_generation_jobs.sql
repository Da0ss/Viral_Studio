-- Multi-model generation: a service-only model/price catalog, provider
-- columns that reference it, per-model reservations and a provider request id
-- for reconciliation. Existing rows and the 3-argument create_generation_job
-- keep working unchanged (they map to the legacy catalog key).
set local lock_timeout = '5s';

-- Fail closed: drop the single-model CHECKs by looking up the actual constraint
-- on each column and verifying its definition first. Any drift aborts the migration.
do $$
declare spec record; n integer; cname name; def text;
begin
  for spec in select * from (values
    ('provider'::text, 'fal-ai'::text),
    ('model', 'Lightricks/LTX-Video-0.9.7-distilled'),
    ('reservation_micro_usd', '50000'),
    ('charged_micro_usd', '50000'),
    ('provider_request_path', '/fal-ai/ltx-video-13b-distilled/requests/')
  ) v(column_name, needle) loop
    select count(*) into n
    from pg_catalog.pg_constraint c
    join pg_catalog.pg_attribute a on a.attrelid = c.conrelid and a.attname = spec.column_name and not a.attisdropped
    where c.conrelid = 'public.generation_jobs'::regclass and c.contype = 'c' and c.conkey = array[a.attnum];
    if n <> 1 then
      raise exception 'Expected exactly one CHECK on generation_jobs.%, found %', spec.column_name, n;
    end if;
    select c.conname, pg_catalog.pg_get_constraintdef(c.oid) into cname, def
    from pg_catalog.pg_constraint c
    join pg_catalog.pg_attribute a on a.attrelid = c.conrelid and a.attname = spec.column_name and not a.attisdropped
    where c.conrelid = 'public.generation_jobs'::regclass and c.contype = 'c' and c.conkey = array[a.attnum];
    if pg_catalog.strpos(def, spec.needle) = 0 then
      raise exception 'Unexpected CHECK definition on generation_jobs.%: %', spec.column_name, def;
    end if;
    execute pg_catalog.format('alter table public.generation_jobs drop constraint %I', cname);
  end loop;
end $$;

-- Model catalog: only service_role reads or writes it; clients never see it.
create table private.generation_models (
  model_key text primary key check (model_key ~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$'),
  provider text not null check (provider in ('fal-ai','fal')),
  endpoint text not null check (endpoint ~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,149}$'),
  request_path_prefix text not null check (request_path_prefix ~ '^(/[A-Za-z0-9][A-Za-z0-9._-]*){2,4}$'),
  cost_micro_usd bigint check (cost_micro_usd is null or cost_micro_usd between 1 and 5000000),
  enabled boolean not null default false,
  updated_at timestamptz not null default clock_timestamp(),
  constraint generation_models_provider_model_key unique (provider, model_key),
  constraint generation_models_enabled_needs_price check (not enabled or cost_micro_usd is not null)
);
alter table private.generation_models enable row level security;
revoke all on private.generation_models from public, anon, authenticated;
grant select, insert, update, delete on private.generation_models to service_role;

insert into private.generation_models(model_key, provider, endpoint, request_path_prefix, cost_micro_usd, enabled) values
  ('Lightricks/LTX-Video-0.9.7-distilled', 'fal-ai', 'Lightricks/LTX-Video-0.9.7-distilled', '/fal-ai/ltx-video-13b-distilled', 50000, true),
  ('ltx', 'fal', 'fal-ai/ltx-video', '/fal-ai/ltx-video', 50000, true),
  ('minimax', 'fal', 'fal-ai/minimax/video-01', '/fal-ai/minimax', 50000, true),
  ('kling', 'fal', 'fal-ai/kling-video/v3/standard/text-to-video', '/fal-ai/kling-video', null, false),
  ('seedance', 'fal', 'bytedance/seedance-2.0/text-to-video', '/bytedance/seedance-2.0', null, false);

-- generation_jobs: provider request id (backfilled from the stored path first).
alter table public.generation_jobs add column provider_request_id text;
-- Keep updated_at unchanged for the backfill (ACCESS EXCLUSIVE is held anyway).
alter table public.generation_jobs disable trigger generation_jobs_updated_at;
update public.generation_jobs
  set provider_request_id = pg_catalog.substring(provider_request_path, '/requests/([A-Za-z0-9_-]{1,100})$')
  where provider_request_path is not null;
alter table public.generation_jobs enable trigger generation_jobs_updated_at;

alter table public.generation_jobs
  add constraint generation_jobs_provider_model_fkey
    foreign key (provider, model) references private.generation_models (provider, model_key),
  add constraint generation_jobs_reservation_micro_usd_range check (reservation_micro_usd between 0 and 5000000),
  add constraint generation_jobs_charged_micro_usd_range check (charged_micro_usd between 0 and 5000000),
  add constraint generation_jobs_provider_path_check check (provider_request_path is null
    or provider_request_path ~ '^(/[A-Za-z0-9][A-Za-z0-9._-]*){2,4}/requests/[A-Za-z0-9_-]{1,100}$'),
  add constraint generation_jobs_provider_request_id_check check (provider_request_id is null
    or provider_request_id ~ '^[A-Za-z0-9_-]{1,100}$'),
  add constraint generation_jobs_provider_request_consistency check (
    (provider_request_path is null and provider_request_id is null)
    or (provider_request_path is not null and provider_request_id is not null
      and pg_catalog.right(provider_request_path, 10 + pg_catalog.char_length(provider_request_id)) = '/requests/' || provider_request_id));
create unique index generation_jobs_provider_request_id_key
  on public.generation_jobs (provider_request_id) where provider_request_id is not null;
create index generation_jobs_provider_model_idx on public.generation_jobs (provider, model);
-- The model name is shown to participants; provider_request_* stays hidden.
grant select (model) on public.generation_jobs to authenticated;

-- Create: the catalog decides availability and the reserved price.
create function private.create_generation_job_internal(target_project uuid, request_key uuid, generation_prompt text, model_key text)
returns table(job_id uuid, job_status public.generation_status, was_reused boolean)
language plpgsql volatile security definer set search_path = '' as $$
declare caller uuid := (select auth.uid()); existing public.generation_jobs; policy private.generation_budget_settings;
  model_row private.generation_models;
  day_key date := (clock_timestamp() at time zone 'UTC')::date; global_bucket constant uuid := '00000000-0000-0000-0000-000000000000';
  used_global bigint; used_user bigint; created_job public.generation_jobs; quota_bytes bigint; media_used bigint; normalized_prompt text := trim(generation_prompt);
  reserve_micro_usd bigint;
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
    if existing.project_id<>target_project or existing.input->>'prompt'<>normalized_prompt
      or existing.model is distinct from create_generation_job_internal.model_key then raise exception 'Idempotency key conflict' using errcode='23505'; end if;
    return query select existing.id,existing.status,true; return;
  end if;
  select * into model_row from private.generation_models gm where gm.model_key=create_generation_job_internal.model_key for share;
  if not found or not model_row.enabled or model_row.cost_micro_usd is null then
    raise exception 'Generation model unavailable' using errcode='22023';
  end if;
  reserve_micro_usd := model_row.cost_micro_usd;
  select * into policy from private.generation_budget_settings where singleton;
  insert into private.generation_budget_daily(usage_day,bucket_user) values(day_key,global_bucket),(day_key,caller) on conflict do nothing;
  perform 1 from private.generation_budget_daily b where b.usage_day=day_key and b.bucket_user in (global_bucket,caller) order by b.bucket_user for update;
  select reserved_micro_usd+spent_micro_usd into used_global from private.generation_budget_daily where usage_day=day_key and bucket_user=global_bucket;
  select reserved_micro_usd+spent_micro_usd into used_user from private.generation_budget_daily where usage_day=day_key and bucket_user=caller;
  if used_global+reserve_micro_usd>policy.daily_global_micro_usd then raise exception 'Daily generation budget exhausted' using errcode='P0001'; end if;
  if used_user+reserve_micro_usd>policy.daily_user_micro_usd then raise exception 'Personal daily generation limit reached' using errcode='P0001'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('media-quota:'||target_project::text,0));
  quota_bytes := coalesce((select q.quota_bytes from private.media_project_quotas q where q.project_id=target_project),1073741824);
  media_used := private.project_media_usage(target_project);
  if media_used+52428800>quota_bytes then raise exception 'Project media quota cannot reserve generation output' using errcode='P0001'; end if;
  insert into public.generation_jobs(project_id,requested_by,input,client_request_id,reservation_day,reservation_micro_usd,provider,model)
    values(target_project,caller,jsonb_build_object('prompt',normalized_prompt),request_key,day_key,reserve_micro_usd,model_row.provider,model_row.model_key) returning * into created_job;
  insert into private.generation_output_reservations(job_id,project_id) values(created_job.id,target_project);
  update private.generation_budget_daily set reserved_micro_usd=reserved_micro_usd+reserve_micro_usd,updated_at=clock_timestamp()
    where usage_day=day_key and bucket_user in (global_bucket,caller);
  return query select created_job.id,created_job.status,false;
end $$;
revoke all on function private.create_generation_job_internal(uuid,uuid,text,text) from public, anon;
grant execute on function private.create_generation_job_internal(uuid,uuid,text,text) to authenticated;

-- The 3-argument entry points keep their signatures and grants; they map to the legacy key.
create or replace function private.create_generation_job_internal(target_project uuid, request_key uuid, generation_prompt text)
returns table(job_id uuid, job_status public.generation_status, was_reused boolean)
language sql volatile security definer set search_path = '' as $$
  select * from private.create_generation_job_internal(target_project, request_key, generation_prompt, 'Lightricks/LTX-Video-0.9.7-distilled');
$$;
revoke all on function private.create_generation_job_internal(uuid,uuid,text) from public, anon;
grant execute on function private.create_generation_job_internal(uuid,uuid,text) to authenticated;

create function public.create_generation_job(target_project uuid, request_key uuid, generation_prompt text, model_key text)
returns table(job_id uuid, job_status public.generation_status, was_reused boolean)
language sql volatile security invoker set search_path = '' as $$
  select * from private.create_generation_job_internal(target_project, request_key, generation_prompt, model_key);
$$;
revoke all on function public.create_generation_job(uuid,uuid,text,text) from public, anon;
grant execute on function public.create_generation_job(uuid,uuid,text,text) to authenticated;

-- Claim functions: same outputs plus provider and model (return type changes, so drop first).
drop function public.claim_generation_jobs(integer);
drop function public.claim_generation_job_for_view(uuid, uuid);

create function public.claim_generation_jobs(batch_size integer default 4)
returns table(job_id uuid,dispatch_state text,lease_token uuid,project_id uuid,requested_by uuid,
  prompt text,provider_request_path text,cancel_requested boolean,output_storage_path text,provider text,model text)
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
      c.cancel_requested_at is not null,c.output_storage_path,c.provider,c.model from claimed c;
end $$;
revoke all on function public.claim_generation_jobs(integer) from public, anon, authenticated;
grant execute on function public.claim_generation_jobs(integer) to service_role;

create function public.claim_generation_job_for_view(target_job uuid, viewer_id uuid)
returns table(job_id uuid,dispatch_state text,lease_token uuid,project_id uuid,requested_by uuid,
  prompt text,provider_request_path text,cancel_requested boolean,output_storage_path text,provider text,model text)
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
      c.cancel_requested_at is not null,c.output_storage_path,c.provider,c.model from claimed c;
end $$;
revoke all on function public.claim_generation_job_for_view(uuid,uuid) from public, anon, authenticated;
grant execute on function public.claim_generation_job_for_view(uuid,uuid) to service_role;

-- Persisting an accepted submission validates the path against the job's catalog
-- entry and stores the provider request id used for reconciliation.
create or replace function public.record_generation_submission(target_job uuid,token uuid,request_path text)
returns boolean language plpgsql volatile security invoker set search_path = '' as $$
declare job public.generation_jobs; model_row private.generation_models; extracted_id text;
begin
  if request_path is null or request_path !~ '^(/[A-Za-z0-9][A-Za-z0-9._-]*){2,4}/requests/[A-Za-z0-9_-]{1,100}$' then raise exception 'Invalid provider request path' using errcode='22023'; end if;
  select * into job from public.generation_jobs j where j.id=target_job and j.status='running' and j.dispatch_state='submitting'
    and j.lease_token=token and j.lease_until>clock_timestamp() for update;
  if not found then return false; end if;
  select * into model_row from private.generation_models m where m.provider=job.provider and m.model_key=job.model;
  if not found or not starts_with(request_path, model_row.request_path_prefix||'/requests/') then raise exception 'Invalid provider request path' using errcode='22023'; end if;
  extracted_id := pg_catalog.substring(request_path, '/requests/([A-Za-z0-9_-]{1,100})$');
  update public.generation_jobs set provider_request_path=request_path,provider_request_id=extracted_id,
    dispatch_state=case when cancel_requested_at is null then 'submitted' else 'cancelling' end,
    next_attempt_at=clock_timestamp(),lease_token=null,lease_until=null,last_error_code=null,updated_at=clock_timestamp()
  where id=target_job;
  return true;
end $$;
revoke all on function public.record_generation_submission(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.record_generation_submission(uuid,uuid,text) to service_role;

create or replace function public.reconcile_generation_submission(target_job uuid,provider_accepted boolean,request_path text default null)
returns boolean language plpgsql volatile security invoker set search_path = '' as $$
declare job public.generation_jobs; model_row private.generation_models; extracted_id text;
begin
  select * into job from public.generation_jobs j where j.id=target_job and j.status='running' and j.dispatch_state='uncertain' for update;
  if not found then return false; end if;
  if provider_accepted then
    if request_path is null or request_path !~ '^(/[A-Za-z0-9][A-Za-z0-9._-]*){2,4}/requests/[A-Za-z0-9_-]{1,100}$' then raise exception 'Invalid provider request path' using errcode='22023'; end if;
    select * into model_row from private.generation_models m where m.provider=job.provider and m.model_key=job.model;
    if not found or not starts_with(request_path, model_row.request_path_prefix||'/requests/') then raise exception 'Invalid provider request path' using errcode='22023'; end if;
    extracted_id := pg_catalog.substring(request_path, '/requests/([A-Za-z0-9_-]{1,100})$');
    update public.generation_jobs set provider_request_path=request_path,provider_request_id=extracted_id,
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

-- Disabling a model also stops jobs that are queued but not yet submitted
-- (closed without charge); already-submitted jobs keep finishing.
create or replace function public.authorize_generation_dispatch(target_job uuid,token uuid)
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
  if not exists (select 1 from private.generation_models gm where gm.provider=job.provider and gm.model_key=job.model and gm.enabled) then
    perform private.settle_generation_budget(target_job,0);
    delete from private.generation_output_reservations where job_id=target_job;
    update public.generation_jobs set status='failed',dispatch_state='finalized',
      error_message='The generation request was rejected before provider acceptance.',last_error_code='model_disabled',
      completed_at=clock_timestamp(),lease_token=null,lease_until=null,updated_at=clock_timestamp()
      where id=target_job;
    return false;
  end if;
  return true;
end $$;
revoke all on function public.authorize_generation_dispatch(uuid,uuid) from public, anon, authenticated;
grant execute on function public.authorize_generation_dispatch(uuid,uuid) to service_role;

-- Operator pricing: unknown model fails; enabling requires a price.
create function public.set_generation_model_price(model_key text, cost_micro_usd bigint, enabled boolean)
returns void language plpgsql volatile security invoker set search_path = '' as $$
begin
  if set_generation_model_price.model_key is null or set_generation_model_price.enabled is null
    or (set_generation_model_price.cost_micro_usd is not null and set_generation_model_price.cost_micro_usd not between 1 and 5000000)
    or (set_generation_model_price.enabled and set_generation_model_price.cost_micro_usd is null) then
    raise exception 'Invalid generation model price' using errcode='22023';
  end if;
  update private.generation_models as gm set cost_micro_usd=set_generation_model_price.cost_micro_usd,
    enabled=set_generation_model_price.enabled,updated_at=clock_timestamp()
  where gm.model_key=set_generation_model_price.model_key;
  if not found then raise exception 'Generation model not found' using errcode='P0002'; end if;
end $$;
revoke all on function public.set_generation_model_price(text,bigint,boolean) from public, anon, authenticated;
grant execute on function public.set_generation_model_price(text,bigint,boolean) to service_role;
