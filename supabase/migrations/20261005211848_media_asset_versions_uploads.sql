-- Asset versions reuse upload intents and the project quota. The parent asset
-- is deliberately not FK-bound here: deleting an asset while a signed token is
-- outstanding must leave the intent durable until token expiry and cleanup.
alter table private.media_upload_intents add column target_asset_id uuid;
create index media_upload_intents_target_asset_idx on private.media_upload_intents(target_asset_id)
where target_asset_id is not null and state in ('uploading','cleanup_pending');

drop function public.begin_media_upload(uuid,uuid,text,text,text,bigint);
drop function private.begin_media_upload_impl(uuid,uuid,text,text,text,bigint);

-- Clients may read/delete versions under existing RLS, but only the verified
-- service-only upload finalizer may create immutable version metadata.
revoke insert on public.asset_versions from public, anon, authenticated;
grant select, insert on public.asset_versions to service_role;

-- Keep logical quota reserved while deleted bytes await Storage cleanup.
alter table private.media_deletion_outbox add column size_bytes bigint not null default 0 check (size_bytes>=0);
create or replace function private.enqueue_media_deletion() returns trigger
language plpgsql security definer set search_path = '' as $$
declare queued record;
begin
  for queued in
    select paths.storage_path,max(paths.size_bytes)::bigint as size_bytes from (
      select old.storage_path,old.size_bytes::bigint as size_bytes
      union all select v.storage_path,v.size_bytes::bigint from public.asset_versions v where v.asset_id=old.id
    ) paths group by paths.storage_path
  loop
    if queued.storage_path !~ '^projects/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[a-zA-Z0-9][a-zA-Z0-9_-]{0,100}\.[a-z0-9]{1,8}$'
      or (storage.foldername(queued.storage_path))[2]<>old.project_id::text then
      raise exception 'Unsupported material storage path' using errcode='23514';
    end if;
    insert into private.media_deletion_outbox(asset_id,project_id,object_path,size_bytes)
      values(old.id,old.project_id,queued.storage_path,queued.size_bytes)
      on conflict(object_path) do nothing;
  end loop;
  return old;
end $$;
revoke all on function private.enqueue_media_deletion() from public, anon, authenticated;

create or replace function private.project_media_usage(target_project uuid) returns bigint
language sql stable security definer set search_path = '' as $$
  select coalesce((select sum(bytes) from (
    select a.size_bytes::bigint as bytes from public.assets a where a.project_id=target_project
    union all select v.size_bytes::bigint from public.asset_versions v join public.assets a on a.id=v.asset_id where a.project_id=target_project
    union all select i.reserved_bytes from private.media_upload_intents i where i.project_id=target_project and i.state in ('uploading','cleanup_pending')
    union all select r.reserved_bytes from private.generation_output_reservations r where r.project_id=target_project
    union all select q.size_bytes from private.media_deletion_outbox q where q.project_id=target_project and q.completed_at is null
  ) usage_rows),0)::bigint;
$$;
revoke all on function private.project_media_usage(uuid) from public, anon, authenticated;

create function private.begin_media_upload_impl(
  target_project uuid, parent_asset uuid, request_key uuid, content_hash text,
  content_type text, upload_name text, upload_size bigint
) returns table(outcome text, intent_id uuid, lease_token uuid, object_path text, asset_id uuid)
language plpgsql volatile security definer set search_path = '' as $$
declare caller uuid := (select auth.uid()); existing private.media_upload_intents; token uuid; quota bigint; usage bigint;
  new_intent uuid := gen_random_uuid(); path text; ext text;
begin
  if caller is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if request_key is null or content_hash !~ '^[0-9a-f]{64}$'
    or content_type not in ('image/jpeg','image/png','image/webp','video/mp4','video/webm','audio/mpeg','audio/wav','application/pdf')
    or char_length(upload_name) not between 1 and 255 or upload_size not between 1 and 52428800 then
    raise exception 'Invalid upload intent' using errcode='22023';
  end if;
  if not exists(select 1 from public.project_members m join public.projects p on p.id=m.project_id
    join public.organization_members om on om.organization_id=p.organization_id and om.user_id=m.user_id
    where m.project_id=target_project and m.user_id=caller and m.role in ('owner','editor')) then
    raise exception 'Project upload forbidden' using errcode='42501';
  end if;
  if parent_asset is not null and not exists(select 1 from public.assets a where a.id=parent_asset and a.project_id=target_project) then
    raise exception 'Target asset unavailable' using errcode='22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('media-quota:'||target_project::text,0));
  select * into existing from private.media_upload_intents i
    where i.requested_by=caller and i.project_id=target_project and i.idempotency_key=request_key for update;
  if found then
    if existing.target_asset_id is distinct from parent_asset or existing.content_sha256<>content_hash
      or existing.mime_type<>content_type or existing.original_name<>upload_name or existing.size_bytes<>upload_size then
      return query select 'conflict',existing.id,null::uuid,existing.object_path,existing.asset_id; return;
    end if;
    if existing.target_asset_id is not null and not exists(select 1 from public.assets a where a.id=existing.target_asset_id and a.project_id=target_project) then
      if existing.state='uploading' then update private.media_upload_intents set state='cleanup_pending',lease_token=null,lease_until=null,updated_at=clock_timestamp() where id=existing.id; end if;
      return query select 'expired',existing.id,null::uuid,existing.object_path,null::uuid; return;
    end if;
    if existing.state='completed' then
      if (existing.target_asset_id is not null and not exists(select 1 from public.asset_versions v where v.id=existing.asset_id and v.asset_id=existing.target_asset_id))
        or (existing.target_asset_id is null and not exists(select 1 from public.assets a where a.id=existing.asset_id and a.project_id=target_project)) then
        return query select 'expired',existing.id,null::uuid,existing.object_path,null::uuid; return;
      end if;
      return query select 'completed',existing.id,null::uuid,existing.object_path,existing.asset_id; return;
    end if;
    if existing.state in ('cleanup_pending','abandoned') or (existing.signed_expires_at is not null and existing.signed_expires_at<=clock_timestamp()) then
      return query select 'expired',existing.id,null::uuid,existing.object_path,null::uuid; return;
    end if;
    if existing.lease_until>clock_timestamp() then return query select 'upload',existing.id,existing.lease_token,existing.object_path,null::uuid; return; end if;
    if existing.reconcile_after<=clock_timestamp() then
      update private.media_upload_intents set state='cleanup_pending',lease_token=null,lease_until=null,updated_at=clock_timestamp() where id=existing.id;
      return query select 'expired',existing.id,null::uuid,existing.object_path,null::uuid; return;
    end if;
    token:=gen_random_uuid();
    update private.media_upload_intents set lease_token=token,lease_until=clock_timestamp()+interval '5 minutes',
      reconcile_after=greatest(reconcile_after,clock_timestamp()+interval '3 hours 10 minutes'),updated_at=clock_timestamp() where id=existing.id;
    return query select 'upload',existing.id,token,existing.object_path,null::uuid; return;
  end if;
  quota:=coalesce((select q.quota_bytes from private.media_project_quotas q where q.project_id=target_project),1073741824);
  usage:=private.project_media_usage(target_project);
  if usage+52428800>quota then return query select 'quota',null::uuid,null::uuid,null::text,null::uuid; return; end if;
  token:=gen_random_uuid();
  ext:=case content_type when 'image/jpeg' then 'jpg' when 'image/png' then 'png' when 'image/webp' then 'webp' when 'video/mp4' then 'mp4' when 'video/webm' then 'webm' when 'audio/mpeg' then 'mp3' when 'audio/wav' then 'wav' else 'pdf' end;
  path:='projects/'||target_project::text||'/'||new_intent::text||'/'||coalesce(
    nullif(left(trim(both '-' from regexp_replace(regexp_replace(upload_name,'\.[^.]*$',''),'[^a-zA-Z0-9]+','-','g')),80),''),'material'
  )||'.'||ext;
  insert into private.media_upload_intents(id,requested_by,project_id,idempotency_key,content_sha256,mime_type,original_name,size_bytes,object_path,lease_token,lease_until,target_asset_id)
    values(new_intent,caller,target_project,request_key,content_hash,content_type,upload_name,upload_size,path,token,clock_timestamp()+interval '5 minutes',parent_asset);
  return query select 'upload',new_intent,token,path,null::uuid;
end $$;
revoke all on function private.begin_media_upload_impl(uuid,uuid,uuid,text,text,text,bigint) from public,anon;
grant execute on function private.begin_media_upload_impl(uuid,uuid,uuid,text,text,text,bigint) to authenticated;

create function public.begin_media_upload(target_project uuid,request_key uuid,content_hash text,content_type text,upload_name text,upload_size bigint)
returns table(outcome text,intent_id uuid,lease_token uuid,object_path text,asset_id uuid)
language sql volatile security invoker set search_path = '' as $$
  select * from private.begin_media_upload_impl(target_project,null::uuid,request_key,content_hash,content_type,upload_name,upload_size);
$$;
revoke all on function public.begin_media_upload(uuid,uuid,text,text,text,bigint) from public,anon;
grant execute on function public.begin_media_upload(uuid,uuid,text,text,text,bigint) to authenticated;
create function public.begin_media_version_upload(target_project uuid,parent_asset uuid,request_key uuid,content_hash text,content_type text,upload_name text,upload_size bigint)
returns table(outcome text,intent_id uuid,lease_token uuid,object_path text,asset_id uuid)
language sql volatile security invoker set search_path = '' as $$
  select * from private.begin_media_upload_impl(target_project,parent_asset,request_key,content_hash,content_type,upload_name,upload_size);
$$;
revoke all on function public.begin_media_version_upload(uuid,uuid,uuid,text,text,text,bigint) from public,anon;
grant execute on function public.begin_media_version_upload(uuid,uuid,uuid,text,text,text,bigint) to authenticated;

create or replace function public.store_media_upload_token(target_intent uuid, token uuid, signed_token text)
returns table(upload_token text, expires_at timestamptz)
language plpgsql volatile security invoker set search_path = '' as $$
begin
  if signed_token is not null and char_length(signed_token) not between 1 and 4096 then raise exception 'Invalid signed token' using errcode='22023'; end if;
  if signed_token is not null then update private.media_upload_intents i set signed_upload_token=signed_token,
    signed_expires_at=clock_timestamp()+interval '2 hours', reconcile_after=clock_timestamp()+interval '3 hours',
    lease_until=clock_timestamp()+interval '2 hours'
    where i.id=target_intent and i.state='uploading' and i.lease_token=token and i.lease_until>clock_timestamp()
      and i.signed_upload_token is null
      and (i.target_asset_id is null or exists(select 1 from public.assets a where a.id=i.target_asset_id and a.project_id=i.project_id));
  end if;
  if found then
    return query select i.signed_upload_token,i.signed_expires_at from private.media_upload_intents i where i.id=target_intent;
  else
    return query select i.signed_upload_token,i.signed_expires_at from private.media_upload_intents i
      where i.id=target_intent and i.state='uploading' and i.lease_token=token and i.signed_expires_at>clock_timestamp()
        and (i.target_asset_id is null or exists(select 1 from public.assets a where a.id=i.target_asset_id and a.project_id=i.project_id));
  end if;
end $$;
revoke all on function public.store_media_upload_token(uuid,uuid,text) from public, anon, authenticated;
grant select, update on private.media_upload_intents to service_role;
grant execute on function public.store_media_upload_token(uuid,uuid,text) to service_role;

create or replace function public.finish_media_upload(target_intent uuid, token uuid, actual_hash text, actual_size bigint)
returns uuid language plpgsql volatile security invoker set search_path = '' as $$
declare upload private.media_upload_intents; kind public.asset_kind; target_project uuid; version_number integer;
begin
  select i.project_id into target_project from private.media_upload_intents i where i.id=target_intent;
  if not found then return null; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('media-quota:' || target_project::text, 0));
  select * into upload from private.media_upload_intents i where i.id=target_intent for update;
  if not found then return null; end if;
  if upload.state='completed' then return upload.asset_id; end if;
  if upload.state<>'uploading' or upload.lease_token is distinct from token or upload.lease_until<=clock_timestamp() then return null; end if;
  if actual_hash is distinct from upload.content_sha256 or actual_size is distinct from upload.size_bytes then return null; end if;
  if not exists (
    select 1 from public.project_members m join public.projects p on p.id=m.project_id
    join public.organization_members om on om.organization_id=p.organization_id and om.user_id=m.user_id
    where m.project_id=upload.project_id and m.user_id=upload.requested_by and m.role in ('owner','editor')
  ) then return null; end if;

  if upload.target_asset_id is not null then
    -- The asset lock serializes ordinal allocation across concurrent finishes.
    perform 1 from public.assets a where a.id=upload.target_asset_id and a.project_id=upload.project_id for update;
    if not found then return null; end if;
    select coalesce(max(v.version_number),0)+1 into version_number
      from public.asset_versions v where v.asset_id=upload.target_asset_id;
    update private.media_upload_intents set state='completed',asset_id=id,lease_token=null,lease_until=null,updated_at=clock_timestamp()
      where id=upload.id;
    insert into public.asset_versions(id,asset_id,version_number,storage_path,mime_type,size_bytes,created_by)
      values(upload.id,upload.target_asset_id,version_number,upload.object_path,upload.mime_type,upload.size_bytes,upload.requested_by);
    return upload.id;
  end if;

  kind:=case when upload.mime_type like 'image/%' then 'image'::public.asset_kind when upload.mime_type like 'video/%' then 'video'::public.asset_kind when upload.mime_type like 'audio/%' then 'audio'::public.asset_kind else 'document'::public.asset_kind end;
  update private.media_upload_intents set state='completed',asset_id=id,lease_token=null,lease_until=null,updated_at=clock_timestamp() where id=upload.id;
  insert into public.assets(id,project_id,kind,name,storage_path,mime_type,size_bytes,created_by)
    values(upload.id,upload.project_id,kind,upload.original_name,upload.object_path,upload.mime_type,upload.size_bytes,upload.requested_by);
  return upload.id;
end $$;
revoke all on function public.finish_media_upload(uuid,uuid,text,bigint) from public, anon, authenticated;
grant select, update on private.media_upload_intents to service_role;
grant insert on public.assets, public.asset_versions to service_role;
grant select on public.project_members, public.projects, public.organization_members to service_role;
grant execute on function public.finish_media_upload(uuid,uuid,text,bigint) to service_role;

create or replace function private.get_media_upload_status_impl(target_project uuid, request_key uuid, content_hash text)
returns table(outcome text, asset_id uuid)
language plpgsql stable security definer set search_path = '' as $$
declare caller uuid := (select auth.uid()); intent private.media_upload_intents;
begin
  if caller is null or request_key is null or content_hash !~ '^[0-9a-f]{64}$' then return query select 'none',null::uuid; return; end if;
  select * into intent from private.media_upload_intents i where i.project_id=target_project and i.requested_by=caller and i.idempotency_key=request_key;
  if not found then return query select 'none',null::uuid; return; end if;
  if not exists(select 1 from public.project_members m join public.projects p on p.id=m.project_id
    join public.organization_members om on om.organization_id=p.organization_id and om.user_id=m.user_id
    where m.project_id=target_project and m.user_id=caller and m.role in ('owner','editor')) then
    return query select 'none',null::uuid; return;
  end if;
  if intent.content_sha256<>content_hash then return query select 'conflict',null::uuid; return; end if;
  if intent.target_asset_id is not null and not exists(select 1 from public.assets a where a.id=intent.target_asset_id and a.project_id=target_project) then
    return query select 'expired',null::uuid; return;
  end if;
  if intent.state='completed' then
    if intent.target_asset_id is not null and not exists(select 1 from public.asset_versions v where v.id=intent.asset_id and v.asset_id=intent.target_asset_id) then
      return query select 'expired',null::uuid; return;
    end if;
    if intent.target_asset_id is null and not exists(select 1 from public.assets a where a.id=intent.asset_id and a.project_id=target_project) then
      return query select 'expired',null::uuid; return;
    end if;
    return query select 'completed',intent.asset_id; return;
  end if;
  if intent.state in ('cleanup_pending','abandoned') or intent.reconcile_after<=statement_timestamp() then return query select 'expired',null::uuid; return; end if;
  if intent.lease_until>statement_timestamp() then return query select 'pending',null::uuid; return; end if;
  return query select 'retry',null::uuid;
end $$;
revoke all on function private.get_media_upload_status_impl(uuid,uuid,text) from public, anon;
grant execute on function private.get_media_upload_status_impl(uuid,uuid,text) to authenticated;

create or replace function public.get_media_upload_verification(target_intent uuid, token uuid, target_project uuid)
returns table(object_path text, mime_type text, content_sha256 text, size_bytes bigint)
language sql stable security invoker set search_path = '' as $$
  select i.object_path,i.mime_type,i.content_sha256,i.size_bytes from private.media_upload_intents i
  where i.id=target_intent and i.project_id=target_project and i.state='uploading'
    and i.lease_token=token and i.lease_until>clock_timestamp() and i.signed_expires_at>clock_timestamp()
    and (i.target_asset_id is null or exists(select 1 from public.assets a where a.id=i.target_asset_id and a.project_id=i.project_id));
$$;
revoke all on function public.get_media_upload_verification(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.get_media_upload_verification(uuid,uuid,uuid) to service_role;
