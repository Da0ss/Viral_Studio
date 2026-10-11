-- Rollback-only acceptance checks for hosted-upload-team.sql followed by
-- hosted-generation-metrics.sql. Run only after both packages are applied in
-- staging or an explicitly approved rollback-only window. Uses existing
-- confirmed identities; never writes auth.users, calls Storage HTTP, invokes a
-- provider, or selects fixture values as result sets.
begin;

-- Existing project owner plus confirmed-email outsider not in that org/project.
create temporary table hosted_acceptance_fixture (
  org_id uuid not null, project_id uuid not null, owner_id uuid not null,
  outsider_id uuid not null, outsider_email text not null
) on commit drop;
insert into hosted_acceptance_fixture
select p.organization_id,p.id,pm.user_id,outsider.id,lower(outsider.email)
from public.projects p
join public.project_members pm on pm.project_id=p.id and pm.role='owner'
join public.organization_members om on om.organization_id=p.organization_id
  and om.user_id=pm.user_id and om.role='owner'
join auth.users owner_user on owner_user.id=pm.user_id and owner_user.email_confirmed_at is not null
cross join lateral (
  select u.id,u.email from auth.users u
  where u.id<>pm.user_id and u.email is not null and u.email_confirmed_at is not null
    and not exists(select 1 from public.organization_members x where x.organization_id=p.organization_id and x.user_id=u.id)
    and not exists(select 1 from public.project_members x where x.project_id=p.id and x.user_id=u.id)
  order by u.created_at,u.id limit 1
) outsider
order by p.created_at,p.id limit 1;
do $fixture$
begin
  if (select count(*) from pg_temp.hosted_acceptance_fixture)<>1 then
    raise exception 'Acceptance precondition failed: eligible owner/outsider pair missing';
  end if;
  perform set_config('hosted_acceptance.org',org_id::text,true),
    set_config('hosted_acceptance.project',project_id::text,true),
    set_config('hosted_acceptance.owner',owner_id::text,true),
    set_config('hosted_acceptance.outsider',outsider_id::text,true),
    set_config('hosted_acceptance.email',outsider_email,true)
  from pg_temp.hosted_acceptance_fixture;
end
$fixture$;

do $acl$
begin
  if has_any_column_privilege('anon','public.assets','INSERT')
    or has_any_column_privilege('anon','public.assets','UPDATE')
    or has_any_column_privilege('authenticated','public.assets','INSERT')
    or has_any_column_privilege('authenticated','public.assets','UPDATE')
    or has_any_column_privilege('anon','public.asset_versions','INSERT')
    or has_any_column_privilege('anon','public.asset_versions','UPDATE')
    or has_any_column_privilege('authenticated','public.asset_versions','INSERT')
    or has_any_column_privilege('authenticated','public.asset_versions','UPDATE')
    or has_column_privilege('authenticated','public.team_invitations','token_hash','SELECT')
    or has_column_privilege('anon','public.team_invitations','token_hash','SELECT') then
    raise exception 'ACL assertion failed: client metadata/invitation boundary';
  end if;
  if not has_table_privilege('service_role','public.assets','INSERT')
    or not has_table_privilege('service_role','public.asset_versions','INSERT')
    or has_function_privilege('anon','public.finish_media_upload(uuid,uuid,text,bigint)','EXECUTE')
    or has_function_privilege('authenticated','public.finish_media_upload(uuid,uuid,text,bigint)','EXECUTE')
    or has_function_privilege('anon','public.claim_generation_jobs(integer)','EXECUTE')
    or has_function_privilege('authenticated','public.claim_generation_jobs(integer)','EXECUTE')
    or not has_function_privilege('service_role','public.finish_media_upload(uuid,uuid,text,bigint)','EXECUTE')
    or not has_function_privilege('service_role','public.claim_generation_jobs(integer)','EXECUTE') then
    raise exception 'ACL assertion failed: trusted finalizer/worker grants';
  end if;
end
$acl$;

-- Owner simulated JWT: idempotent create, conflicting retry rejection, queued
-- cancel, and reserved upload idempotency/lease. No provider call is made.
set local role authenticated;
do $owner_claim$ begin
  perform set_config('request.jwt.claim.sub',current_setting('hosted_acceptance.owner'),true);
end $owner_claim$;
do $owner$
declare
  project_id uuid:=current_setting('hosted_acceptance.project')::uuid;
  request_id uuid:=gen_random_uuid();
  job_id uuid; retry_id uuid; state public.generation_status; reused boolean;
  cancelled public.generation_status; cancel_requested boolean;
  upload_id uuid; lease_id uuid; object_path text; upload_retry record;
begin
  select x.job_id,x.job_status into job_id,state
    from public.create_generation_job(project_id,request_id,'Rollback-only acceptance prompt') x;
  if job_id is null or state<>'queued' then raise exception 'Generation create assertion failed'; end if;
  select x.job_id,x.was_reused into retry_id,reused
    from public.create_generation_job(project_id,request_id,'Rollback-only acceptance prompt') x;
  if retry_id is distinct from job_id or reused is distinct from true then
    raise exception 'Generation idempotency assertion failed';
  end if;
  begin
    perform * from public.create_generation_job(project_id,request_id,'Different acceptance prompt');
  exception when unique_violation then reused:=false;
  end;
  if reused is distinct from false then raise exception 'Generation conflict was accepted'; end if;
  select x.job_status,x.cancellation_requested into cancelled,cancel_requested
    from public.cancel_generation_job(job_id) x;
  if cancelled<>'cancelled' or cancel_requested is distinct from true then
    raise exception 'Queued generation cancel assertion failed';
  end if;
  perform set_config('hosted_acceptance.job',job_id::text,true);

  request_id:=gen_random_uuid();
  select x.intent_id,x.lease_token,x.object_path into upload_id,lease_id,object_path
    from public.begin_media_upload(project_id,request_id,repeat('a',64),'image/png','acceptance.png',1234) x;
  if upload_id is null or lease_id is null or object_path is null then
    raise exception 'Upload reservation assertion failed';
  end if;
  select * into upload_retry from public.begin_media_upload(
    project_id,request_id,repeat('a',64),'image/png','acceptance.png',1234);
  if upload_retry.intent_id is distinct from upload_id or upload_retry.lease_token is distinct from lease_id then
    raise exception 'Upload idempotency assertion failed';
  end if;
  if not public.assert_media_upload_lease(upload_id,lease_id) then
    raise exception 'Owner upload lease assertion failed';
  end if;
  perform set_config('hosted_acceptance.intent',upload_id::text,true),
    set_config('hosted_acceptance.lease',lease_id::text,true),
    set_config('hosted_acceptance.path',object_path,true);
  insert into public.team_invitations(organization_id,email,organization_role,token_hash,invited_by,expires_at)
  values(current_setting('hosted_acceptance.org')::uuid,current_setting('hosted_acceptance.email'),
    'member',repeat('b',64),current_setting('hosted_acceptance.owner')::uuid,now()+interval '1 day');
  insert into public.team_invitations(organization_id,project_id,email,organization_role,project_role,
    token_hash,invited_by,expires_at)
  values(current_setting('hosted_acceptance.org')::uuid,current_setting('hosted_acceptance.project')::uuid,
    current_setting('hosted_acceptance.email'),'member','viewer',repeat('c',64),
    current_setting('hosted_acceptance.owner')::uuid,now()+interval '1 day');
  begin
    update public.assets set name='forged update'
    where id=current_setting('hosted_acceptance.intent')::uuid;
    raise exception 'Authenticated asset UPDATE unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.assets(id,project_id,kind,name,storage_path,mime_type,size_bytes,created_by)
      values(gen_random_uuid(),project_id,'image'::public.asset_kind,'forged',
        'projects/'||project_id::text||'/forged.png','image/png',1,
        current_setting('hosted_acceptance.owner')::uuid);
    raise exception 'Authenticated asset INSERT unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into storage.objects(bucket_id,name) values('project-media',object_path);
    raise exception 'Authenticated direct Storage INSERT unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
end
$owner$;

-- Outsider before invite acceptance cannot read/cancel owner job, create a job,
-- reserve media, or validate the owner upload lease.
reset role;
set local role authenticated;
do $outsider_claim$ begin
  perform set_config('request.jwt.claim.sub',current_setting('hosted_acceptance.outsider'),true);
end $outsider_claim$;
do $outsider$
declare denied boolean;
begin
  if exists(select 1 from public.generation_jobs where id=current_setting('hosted_acceptance.job')::uuid) then
    raise exception 'Outsider can read owner generation job';
  end if;
  denied:=false;
  begin
    perform * from public.cancel_generation_job(current_setting('hosted_acceptance.job')::uuid);
  exception when insufficient_privilege then denied:=true;
  end;
  if not denied then raise exception 'Outsider cancellation was not denied'; end if;
  denied:=false;
  begin
    perform * from public.create_generation_job(current_setting('hosted_acceptance.project')::uuid,
      gen_random_uuid(),'Outsider acceptance prompt must be denied');
  exception when insufficient_privilege then denied:=true;
  end;
  if not denied then raise exception 'Outsider generation create was not denied'; end if;
  denied:=false;
  begin
    perform * from public.begin_media_upload(current_setting('hosted_acceptance.project')::uuid,
      gen_random_uuid(),repeat('d',64),'image/png','outsider.png',10);
  exception when insufficient_privilege then denied:=true;
  end;
  if not denied then raise exception 'Outsider upload reservation was not denied'; end if;
  if public.assert_media_upload_lease(current_setting('hosted_acceptance.intent')::uuid,
    current_setting('hosted_acceptance.lease')::uuid) then raise exception 'Outsider validated owner lease'; end if;

  -- Owner-created synthetic invite hashes are email-bound and transaction-local.
  if (select count(*) from public.accept_team_invitation(repeat('b',64)))<>1 then
    raise exception 'Verified-email organization invite acceptance failed';
  end if;
  if exists(select 1 from public.project_members where project_id=current_setting('hosted_acceptance.project')::uuid
    and user_id=current_setting('hosted_acceptance.outsider')::uuid) then
    raise exception 'Organization-only invitation unexpectedly added project membership';
  end if;
  if (select count(*) from public.accept_team_invitation(repeat('c',64)))<>1 then
    raise exception 'Verified-email project invite acceptance failed';
  end if;
  if not exists(select 1 from public.project_members where project_id=current_setting('hosted_acceptance.project')::uuid
    and user_id=current_setting('hosted_acceptance.outsider')::uuid and role='viewer') then
    raise exception 'Project viewer invite did not create viewer membership';
  end if;
  denied:=false;
  begin
    perform * from public.create_generation_job(current_setting('hosted_acceptance.project')::uuid,
      gen_random_uuid(),'Viewer acceptance prompt must be denied');
  exception when insufficient_privilege then denied:=true;
  end;
  if not denied then raise exception 'Project viewer generation create was not denied'; end if;
  denied:=false;
  begin
    perform * from public.begin_media_upload(current_setting('hosted_acceptance.project')::uuid,
      gen_random_uuid(),repeat('f',64),'image/png','viewer.png',10);
  exception when insufficient_privilege then denied:=true;
  end;
  if not denied then raise exception 'Project viewer upload was not denied'; end if;
end
$outsider$;

-- The trusted service finalizer can create matching asset metadata without any
-- Storage HTTP call. All fixture writes, including invitations and job usage,
-- are rolled back.
reset role;
set local role service_role;
do $service$
declare asset_id uuid;
begin
  asset_id:=public.finish_media_upload(current_setting('hosted_acceptance.intent')::uuid,
    current_setting('hosted_acceptance.lease')::uuid,repeat('a',64),1234);
  if asset_id is distinct from current_setting('hosted_acceptance.intent')::uuid
    or not exists(select 1 from public.assets where id=asset_id
      and project_id=current_setting('hosted_acceptance.project')::uuid
      and created_by=current_setting('hosted_acceptance.owner')::uuid and size_bytes=1234) then
    raise exception 'Trusted upload finalization assertion failed';
  end if;
end
$service$;
-- Once the rollback-only asset exists, verify direct client version creation is
-- denied independently of the foreign-key state.
reset role;
set local role authenticated;
do $version_client$
begin
  perform set_config('request.jwt.claim.sub',current_setting('hosted_acceptance.owner'),true);
  begin
    insert into public.asset_versions(asset_id,version_number,storage_path,mime_type,size_bytes,created_by)
    values(current_setting('hosted_acceptance.intent')::uuid,1,
      'projects/'||current_setting('hosted_acceptance.project')||'/acceptance-version.png',
      'image/png',1,current_setting('hosted_acceptance.owner')::uuid);
    raise exception 'Authenticated asset-version INSERT unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
end
$version_client$;
rollback;
