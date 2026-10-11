-- Rollback-only native acceptance for the hosted worker and asset-version
-- packages. Run as the SQL editor/admin role after all three hosted packages
-- are applied. This creates only transaction-local job, intent, membership,
-- asset, version, and outbox rows. It never calls a provider or Storage HTTP.
-- A false reconciliation is a synthetic, proven-not-accepted branch check.
-- No fixture identifier, email, or prompt is selected into a result set.
begin;

create temporary table hosted_worker_versions_fixture (
  org_id uuid not null, project_id uuid not null, owner_id uuid not null,
  outsider_id uuid not null
) on commit drop;
insert into hosted_worker_versions_fixture
select p.organization_id,p.id,pm.user_id,outsider.id
from public.projects p
join public.project_members pm on pm.project_id=p.id and pm.role='owner'
join public.organization_members om on om.organization_id=p.organization_id
  and om.user_id=pm.user_id and om.role='owner'
join auth.users owner_user on owner_user.id=pm.user_id
  and owner_user.email_confirmed_at is not null
join public.profiles owner_profile on owner_profile.id=pm.user_id
cross join lateral (
  select u.id from auth.users u
  join public.profiles outsider_profile on outsider_profile.id=u.id
  where u.id<>pm.user_id and u.email is not null and u.email_confirmed_at is not null
    and not exists(select 1 from public.organization_members x
      where x.organization_id=p.organization_id and x.user_id=u.id)
    and not exists(select 1 from public.project_members x
      where x.project_id=p.id and x.user_id=u.id)
  order by u.created_at,u.id limit 1
) outsider
order by p.created_at,p.id limit 1;

do $fixture$
declare
  f pg_temp.hosted_worker_versions_fixture;
  quota bigint;
  used bigint;
  day_key date := (clock_timestamp() at time zone 'UTC')::date;
  global_bucket constant uuid := '00000000-0000-0000-0000-000000000000';
begin
  if (select count(*) from pg_temp.hosted_worker_versions_fixture)<>1 then
    raise exception 'Acceptance precondition failed: eligible owner/outsider pair missing';
  end if;
  select * into f from pg_temp.hosted_worker_versions_fixture;
  quota:=coalesce((select q.quota_bytes from private.media_project_quotas q
    where q.project_id=f.project_id),1073741824);
  used:=private.project_media_usage(f.project_id);
  if used+104857600>quota then
    raise exception 'Acceptance precondition failed: project quota has insufficient fixture room';
  end if;
  if not exists (
    select 1 from private.generation_budget_settings s
    where s.singleton
      and coalesce((select b.reserved_micro_usd+b.spent_micro_usd
        from private.generation_budget_daily b
        where b.usage_day=day_key and b.bucket_user=global_bucket),0)+50000
        <=s.daily_global_micro_usd
      and coalesce((select b.reserved_micro_usd+b.spent_micro_usd
        from private.generation_budget_daily b
        where b.usage_day=day_key and b.bucket_user=f.owner_id),0)+50000
        <=s.daily_user_micro_usd
  ) then
    raise exception 'Acceptance precondition failed: generation budget has insufficient fixture room';
  end if;
  perform set_config('hv.org',f.org_id::text,true),
    set_config('hv.project',f.project_id::text,true),
    set_config('hv.owner',f.owner_id::text,true),
    set_config('hv.outsider',f.outsider_id::text,true),
    set_config('hv.usage_before',used::text,true),
    set_config('hv.day',day_key::text,true),
    set_config('hv.global_reserved_before',coalesce((select b.reserved_micro_usd
      from private.generation_budget_daily b where b.usage_day=day_key
        and b.bucket_user=global_bucket),0)::text,true),
    set_config('hv.global_spent_before',coalesce((select b.spent_micro_usd
      from private.generation_budget_daily b where b.usage_day=day_key
        and b.bucket_user=global_bucket),0)::text,true),
    set_config('hv.user_reserved_before',coalesce((select b.reserved_micro_usd
      from private.generation_budget_daily b where b.usage_day=day_key
        and b.bucket_user=f.owner_id),0)::text,true),
    set_config('hv.user_spent_before',coalesce((select b.spent_micro_usd
      from private.generation_budget_daily b where b.usage_day=day_key
        and b.bucket_user=f.owner_id),0)::text,true);
end
$fixture$;

do $acl$
begin
  if has_table_privilege('authenticated','public.asset_versions','DELETE')
    or not has_table_privilege('authenticated','public.assets','DELETE')
    or has_function_privilege('authenticated','public.finish_media_upload(uuid,uuid,text,bigint)','EXECUTE')
    or has_function_privilege('authenticated','public.claim_generation_job_for_view(uuid,uuid)','EXECUTE')
    or not has_function_privilege('authenticated',
      'public.begin_media_version_upload(uuid,uuid,uuid,text,text,text,bigint)','EXECUTE')
    or not has_function_privilege('service_role','public.finish_media_upload(uuid,uuid,text,bigint)','EXECUTE')
    or not has_function_privilege('service_role','public.claim_generation_job_for_view(uuid,uuid)','EXECUTE')
    or not has_function_privilege('authenticated','public.list_team_members(uuid)','EXECUTE')
    or not has_function_privilege('authenticated','public.list_project_team_members(uuid)','EXECUTE')
  then raise exception 'Acceptance ACL assertion failed'; end if;
end
$acl$;

set local role authenticated;
do $owner_begin$
declare
  p uuid:=current_setting('hv.project')::uuid;
  job record;
  upload record;
begin
  perform set_config('request.jwt.claim.sub',current_setting('hv.owner'),true);
  if not exists(select 1 from public.organization_members
      where organization_id=current_setting('hv.org')::uuid
        and user_id=current_setting('hv.owner')::uuid)
    or not exists(select 1 from public.project_members
      where project_id=p and user_id=current_setting('hv.owner')::uuid and role='owner')
    or not exists(select 1 from public.list_team_members(current_setting('hv.org')::uuid)
      where user_id=current_setting('hv.owner')::uuid and role='owner')
    or not exists(select 1 from public.list_project_team_members(p)
      where user_id=current_setting('hv.owner')::uuid and role='owner')
  then raise exception 'Owner roster scope assertion failed'; end if;
  select * into job from public.create_generation_job(
    p,gen_random_uuid(),'Rollback-only worker version acceptance prompt');
  if job.job_id is null or job.job_status<>'queued' or job.was_reused
  then raise exception 'Generation create assertion failed'; end if;
  perform set_config('hv.job',job.job_id::text,true);
  select * into upload from public.begin_media_upload(
    p,gen_random_uuid(),repeat('a',64),'image/png','fixture-parent.png',100);
  if upload.outcome<>'upload' or upload.intent_id is null or upload.lease_token is null
  then raise exception 'Parent upload begin assertion failed'; end if;
  perform set_config('hv.parent_intent',upload.intent_id::text,true),
    set_config('hv.parent_lease',upload.lease_token::text,true),
    set_config('hv.parent_path',upload.object_path,true);
end
$owner_begin$;

reset role;
set local role service_role;
do $worker_and_parent$
declare
  claim record;
  j uuid:=current_setting('hv.job')::uuid;
  parent_id uuid;
begin
  select * into claim from public.claim_generation_job_for_view(
    j,current_setting('hv.owner')::uuid);
  if claim.job_id is distinct from j or claim.dispatch_state<>'submitting'
    or claim.lease_token is null
  then raise exception 'Targeted worker claim assertion failed'; end if;
  if not exists(select 1 from public.generation_jobs
      where id=j and reservation_day=current_setting('hv.day')::date)
  then raise exception 'Acceptance precondition failed: UTC day changed during fixture'; end if;
  if public.authorize_generation_dispatch(j,gen_random_uuid())
    or not public.authorize_generation_dispatch(j,claim.lease_token)
    or public.mark_generation_uncertain(j,gen_random_uuid(),'submission_ack_lost')
    or not public.mark_generation_uncertain(j,claim.lease_token,'submission_ack_lost')
  then raise exception 'Worker lease fencing assertion failed'; end if;
  if not exists(select 1 from public.generation_jobs
      where id=j and status='running' and dispatch_state='uncertain'
        and provider_request_path is null)
    or not exists(select 1 from private.generation_output_reservations where job_id=j)
  then raise exception 'Uncertain submission retention assertion failed'; end if;
  if not public.reconcile_generation_submission(j,false,null)
    or public.reconcile_generation_submission(j,false,null)
  then raise exception 'Proven-not-accepted reconciliation assertion failed'; end if;
  if not exists(select 1 from public.generation_jobs
      where id=j and status='failed' and dispatch_state='finalized'
        and reservation_micro_usd=0 and charged_micro_usd=0)
    or exists(select 1 from private.generation_output_reservations where job_id=j)
  then raise exception 'Generation reservation release assertion failed'; end if;

  if public.finish_media_upload(current_setting('hv.parent_intent')::uuid,
      gen_random_uuid(),repeat('a',64),100) is not null
  then raise exception 'Wrong parent-upload lease was accepted'; end if;
  parent_id:=public.finish_media_upload(current_setting('hv.parent_intent')::uuid,
    current_setting('hv.parent_lease')::uuid,repeat('a',64),100);
  if parent_id is distinct from current_setting('hv.parent_intent')::uuid
    or not exists(select 1 from public.assets where id=parent_id
      and project_id=current_setting('hv.project')::uuid and size_bytes=100)
  then raise exception 'Parent upload finalize assertion failed'; end if;
  perform set_config('hv.parent',parent_id::text,true);
end
$worker_and_parent$;

reset role;
set local role authenticated;
do $owner_versions$
declare
  p uuid:=current_setting('hv.project')::uuid;
  parent_id uuid:=current_setting('hv.parent')::uuid;
  request_one uuid:=gen_random_uuid();
  first_version record;
  first_retry record;
  second_version record;
begin
  perform set_config('request.jwt.claim.sub',current_setting('hv.owner'),true);
  select * into first_version from public.begin_media_version_upload(
    p,parent_id,request_one,repeat('b',64),'image/png','fixture-v1.png',200);
  if first_version.outcome<>'upload' or first_version.intent_id is null
    or first_version.lease_token is null
  then raise exception 'First version begin assertion failed'; end if;
  select * into first_retry from public.begin_media_version_upload(
    p,parent_id,request_one,repeat('b',64),'image/png','fixture-v1.png',200);
  if first_retry.outcome<>'upload'
    or first_retry.intent_id is distinct from first_version.intent_id
    or first_retry.lease_token is distinct from first_version.lease_token
    or first_retry.object_path is distinct from first_version.object_path
  then raise exception 'Version begin idempotency assertion failed'; end if;
  select * into second_version from public.begin_media_version_upload(
    p,parent_id,gen_random_uuid(),repeat('c',64),'image/png','fixture-v2.png',300);
  if second_version.outcome<>'upload' or second_version.intent_id is null
    or second_version.lease_token is null
    or second_version.intent_id=first_version.intent_id
  then raise exception 'Second version begin assertion failed'; end if;
  perform set_config('hv.v1',first_version.intent_id::text,true),
    set_config('hv.v1_lease',first_version.lease_token::text,true),
    set_config('hv.v1_path',first_version.object_path,true),
    set_config('hv.v2',second_version.intent_id::text,true),
    set_config('hv.v2_lease',second_version.lease_token::text,true),
    set_config('hv.v2_path',second_version.object_path,true);
end
$owner_versions$;

reset role;
set local role service_role;
do $finish_versions$
declare
  first_id uuid;
  second_id uuid;
begin
  if public.finish_media_upload(current_setting('hv.v1')::uuid,gen_random_uuid(),
      repeat('b',64),200) is not null
  then raise exception 'Wrong version-upload lease was accepted'; end if;
  first_id:=public.finish_media_upload(current_setting('hv.v1')::uuid,
    current_setting('hv.v1_lease')::uuid,repeat('b',64),200);
  second_id:=public.finish_media_upload(current_setting('hv.v2')::uuid,
    current_setting('hv.v2_lease')::uuid,repeat('c',64),300);
  if first_id is distinct from current_setting('hv.v1')::uuid
    or second_id is distinct from current_setting('hv.v2')::uuid
    or public.finish_media_upload(current_setting('hv.v1')::uuid,gen_random_uuid(),
      repeat('b',64),200) is distinct from first_id
  then raise exception 'Version finalize idempotency assertion failed'; end if;
  if (select count(*) from public.asset_versions
      where asset_id=current_setting('hv.parent')::uuid)<>2
    or not exists(select 1 from public.asset_versions
      where id=first_id and asset_id=current_setting('hv.parent')::uuid
        and version_number=1 and size_bytes=200
        and storage_path=current_setting('hv.v1_path'))
    or not exists(select 1 from public.asset_versions
      where id=second_id and asset_id=current_setting('hv.parent')::uuid
        and version_number=2 and size_bytes=300
        and storage_path=current_setting('hv.v2_path'))
  then raise exception 'Version numbering or metadata assertion failed'; end if;
end
$finish_versions$;

reset role;
set local role authenticated;
do $outsider$
declare denied boolean:=false;
begin
  perform set_config('request.jwt.claim.sub',current_setting('hv.outsider'),true);
  if exists(select 1 from public.organization_members
      where organization_id=current_setting('hv.org')::uuid)
    or exists(select 1 from public.project_members
      where project_id=current_setting('hv.project')::uuid)
    or exists(select 1 from public.assets
      where id=current_setting('hv.parent')::uuid)
    or exists(select 1 from public.asset_versions
      where asset_id=current_setting('hv.parent')::uuid)
    or exists(select 1 from public.generation_jobs
      where id=current_setting('hv.job')::uuid)
    or exists(select 1 from public.list_team_members(current_setting('hv.org')::uuid))
    or exists(select 1 from public.list_project_team_members(current_setting('hv.project')::uuid))
  then raise exception 'Outsider read scope assertion failed'; end if;
  begin
    perform * from public.begin_media_version_upload(
      current_setting('hv.project')::uuid,current_setting('hv.parent')::uuid,
      gen_random_uuid(),repeat('d',64),'image/png','outsider.png',1);
  exception when insufficient_privilege then denied:=true;
  end;
  if not denied then raise exception 'Outsider version upload was not denied'; end if;
end
$outsider$;

reset role;
set local role service_role;
do $viewer_membership$
begin
  insert into public.organization_members(organization_id,user_id,role)
  values(current_setting('hv.org')::uuid,current_setting('hv.outsider')::uuid,'member');
  insert into public.project_members(project_id,user_id,role)
  values(current_setting('hv.project')::uuid,current_setting('hv.outsider')::uuid,'viewer');
end
$viewer_membership$;

reset role;
set local role authenticated;
do $viewer$
declare denied boolean:=false;
begin
  perform set_config('request.jwt.claim.sub',current_setting('hv.outsider'),true);
  if not exists(select 1 from public.project_members
      where project_id=current_setting('hv.project')::uuid
        and user_id=current_setting('hv.outsider')::uuid and role='viewer')
    or not exists(select 1 from public.assets
      where id=current_setting('hv.parent')::uuid)
    or exists(select 1 from public.list_team_members(current_setting('hv.org')::uuid))
    or exists(select 1 from public.list_project_team_members(current_setting('hv.project')::uuid))
  then raise exception 'Viewer read scope assertion failed'; end if;
  begin
    perform * from public.begin_media_version_upload(
      current_setting('hv.project')::uuid,current_setting('hv.parent')::uuid,
      gen_random_uuid(),repeat('e',64),'image/png','viewer.png',1);
  exception when insufficient_privilege then denied:=true;
  end;
  if not denied then raise exception 'Viewer version upload was not denied'; end if;
end
$viewer$;

reset role;
set local role authenticated;
do $owner_delete$
declare
  denied boolean:=false;
  deleted_id uuid;
begin
  perform set_config('request.jwt.claim.sub',current_setting('hv.owner'),true);
  if not exists(select 1 from public.organization_members
      where organization_id=current_setting('hv.org')::uuid
        and user_id=current_setting('hv.outsider')::uuid and role='member')
    or not exists(select 1 from public.project_members
      where project_id=current_setting('hv.project')::uuid
        and user_id=current_setting('hv.outsider')::uuid and role='viewer')
    or not exists(select 1 from public.list_team_members(current_setting('hv.org')::uuid)
      where user_id=current_setting('hv.outsider')::uuid and role='member')
    or not exists(select 1 from public.list_project_team_members(current_setting('hv.project')::uuid)
      where user_id=current_setting('hv.outsider')::uuid and role='viewer')
  then raise exception 'Owner roster visibility assertion failed'; end if;
  begin
    delete from public.asset_versions where id=current_setting('hv.v1')::uuid;
  exception when insufficient_privilege then denied:=true;
  end;
  if not denied then raise exception 'Direct client version DELETE was not denied'; end if;
  delete from public.assets where id=current_setting('hv.parent')::uuid
  returning id into deleted_id;
  if deleted_id is distinct from current_setting('hv.parent')::uuid
  then raise exception 'Parent asset DELETE was not permitted'; end if;
end
$owner_delete$;

reset role;
do $final_checks$
declare
  p uuid:=current_setting('hv.project')::uuid;
  j uuid:=current_setting('hv.job')::uuid;
  day_key date:=current_setting('hv.day')::date;
  global_bucket constant uuid:='00000000-0000-0000-0000-000000000000';
begin
  if exists(select 1 from public.assets where id=current_setting('hv.parent')::uuid)
    or exists(select 1 from public.asset_versions
      where asset_id=current_setting('hv.parent')::uuid)
  then raise exception 'Parent delete did not cascade versions'; end if;
  if (select count(*) from private.media_deletion_outbox
      where asset_id=current_setting('hv.parent')::uuid and completed_at is null)<>3
    or (select coalesce(sum(size_bytes),0) from private.media_deletion_outbox
      where asset_id=current_setting('hv.parent')::uuid and completed_at is null)<>600
    or not exists(select 1 from private.media_deletion_outbox
      where object_path=current_setting('hv.parent_path') and size_bytes=100)
    or not exists(select 1 from private.media_deletion_outbox
      where object_path=current_setting('hv.v1_path') and size_bytes=200)
    or not exists(select 1 from private.media_deletion_outbox
      where object_path=current_setting('hv.v2_path') and size_bytes=300)
  then raise exception 'Deletion outbox byte snapshot assertion failed'; end if;
  if private.project_media_usage(p)<>current_setting('hv.usage_before')::bigint+600
  then raise exception 'Pending-deletion quota assertion failed'; end if;
  if exists(select 1 from private.generation_output_reservations where job_id=j)
    or (select reserved_micro_usd from private.generation_budget_daily
      where usage_day=day_key and bucket_user=global_bucket)
        is distinct from current_setting('hv.global_reserved_before')::bigint
    or (select spent_micro_usd from private.generation_budget_daily
      where usage_day=day_key and bucket_user=global_bucket)
        is distinct from current_setting('hv.global_spent_before')::bigint
    or (select reserved_micro_usd from private.generation_budget_daily
      where usage_day=day_key and bucket_user=current_setting('hv.owner')::uuid)
        is distinct from current_setting('hv.user_reserved_before')::bigint
    or (select spent_micro_usd from private.generation_budget_daily
      where usage_day=day_key and bucket_user=current_setting('hv.owner')::uuid)
        is distinct from current_setting('hv.user_spent_before')::bigint
  then raise exception 'Generation budget release assertion failed'; end if;
end
$final_checks$;

rollback;
