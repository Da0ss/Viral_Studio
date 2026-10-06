

-- Upload intents make retries and Storage/DB split-brain recoverable. A project
-- has a 1 GiB default logical quota; only service_role may override it.
create table private.media_project_quotas (
  project_id uuid primary key,
  quota_bytes bigint not null check (quota_bytes >= 0),
  updated_at timestamptz not null default clock_timestamp()
);
alter table private.media_project_quotas enable row level security;
revoke all on private.media_project_quotas from public, anon, authenticated;
grant select, insert, update, delete on private.media_project_quotas to service_role;

create table private.media_upload_intents (
  id uuid primary key default gen_random_uuid(),
  requested_by uuid not null,
  project_id uuid not null,
  idempotency_key uuid not null,
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  mime_type text not null check (mime_type in ('image/jpeg','image/png','image/webp','video/mp4','video/webm','audio/mpeg','audio/wav','application/pdf')),
  original_name text not null check (char_length(original_name) between 1 and 255),
  size_bytes bigint not null check (size_bytes between 1 and 52428800),
  reserved_bytes bigint not null default 52428800 check (reserved_bytes = 52428800),
  object_path text not null unique,
  signed_upload_token text,
  signed_expires_at timestamptz,
  reconcile_after timestamptz not null default (clock_timestamp() + interval '3 hours 10 minutes'),
  state text not null default 'uploading' check (state in ('uploading','completed','cleanup_pending','abandoned')),
  asset_id uuid,
  lease_token uuid,
  lease_until timestamptz,
  available_at timestamptz not null default clock_timestamp(),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check ((lease_token is null) = (lease_until is null)),
  check ((state = 'completed') = (asset_id is not null)),
  unique (requested_by, project_id, idempotency_key)
);
alter table private.media_upload_intents enable row level security;
revoke all on private.media_upload_intents from public, anon, authenticated;
grant select, insert, update on private.media_upload_intents to service_role;
create index media_upload_intents_reconcile_idx on private.media_upload_intents(available_at, created_at)
where state in ('uploading','cleanup_pending');

-- Separate permanent tombstones avoid mixing upload reconciliation with asset
-- deletion queue ownership while still fencing metadata and Storage uploads.
create table private.media_retired_upload_paths (
  object_path text primary key,
  intent_id uuid not null unique,
  retired_at timestamptz not null default clock_timestamp()
);
alter table private.media_retired_upload_paths enable row level security;
revoke all on private.media_retired_upload_paths from public, anon, authenticated;
grant select, insert on private.media_retired_upload_paths to service_role;

-- Uploads must pass the authenticated begin/finalize RPC quota contract. An
-- editor's publishable JWT must not be able to bypass reservations by writing
-- directly to Storage; only the trusted API route writes bytes after begin.
drop policy if exists "project-media: editors upload" on storage.objects;

create or replace function private.guard_media_path_reuse() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('project-media:' || new.storage_path, 0));
  if exists (select 1 from private.media_deletion_outbox q where q.object_path = new.storage_path)
    or exists (select 1 from private.media_retired_upload_paths r where r.object_path = new.storage_path)
    or exists (select 1 from private.media_upload_intents i where i.object_path = new.storage_path and i.state in ('uploading','cleanup_pending')) then
    raise exception 'Material path is reserved or retired' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function private.guard_media_path_reuse() from public, anon, authenticated;

-- Storage bytes must be accepted for the exact live reservation, while
-- retired/deleting paths remain fenced from signed-token and service writes.
create function private.guard_media_upload_storage_path() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.bucket_id <> 'project-media' then return new; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('project-media:' || new.name, 0));
  if exists (select 1 from private.media_deletion_outbox q where q.object_path = new.name)
    or exists (select 1 from private.media_retired_upload_paths r where r.object_path = new.name)
    or exists (select 1 from private.media_upload_intents i where i.object_path = new.name and i.state in ('cleanup_pending','abandoned','completed')) then
    raise exception 'Material path is retired or already finalized' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function private.guard_media_upload_storage_path() from public, anon, authenticated;
create trigger project_media_guard_upload_storage_path before insert or update of name on storage.objects
for each row execute function private.guard_media_upload_storage_path();

create or replace function private.media_path_uploadable(object_name text)
returns boolean language sql stable security invoker set search_path = '' as $$
  -- Upload bytes are written only by the trusted server API after verifying
  -- the reservation. A Storage RLS insert must never become a bypass.
  select false;
$$;
revoke all on function private.media_path_uploadable(text) from public, anon, authenticated;
grant execute on function private.media_path_uploadable(text) to authenticated;

-- Serialize quota reservation, finalize and ordinary metadata writes by project.
create function private.project_media_usage(target_project uuid) returns bigint
language sql stable security definer set search_path = '' as $$
  select coalesce((select sum(bytes) from (
    select a.size_bytes::bigint as bytes from public.assets a where a.project_id = target_project
    union all
    select v.size_bytes::bigint from public.asset_versions v join public.assets a on a.id = v.asset_id where a.project_id = target_project
    union all
  select i.reserved_bytes from private.media_upload_intents i where i.project_id = target_project and i.state in ('uploading','cleanup_pending')
  ) usage_rows), 0)::bigint;
$$;
revoke all on function private.project_media_usage(uuid) from public, anon, authenticated;

create function private.enforce_project_media_quota() returns trigger
language plpgsql security definer set search_path = '' as $$
declare target_project uuid; old_size bigint := 0; quota bigint; usage bigint;
begin
  if tg_table_name = 'assets' then
    target_project := new.project_id;
    if tg_op = 'UPDATE' then old_size := old.size_bytes; end if;
  else
    select a.project_id into target_project from public.assets a where a.id = new.asset_id;
    if tg_op = 'UPDATE' then old_size := old.size_bytes; end if;
  end if;
  if target_project is null then return new; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('media-quota:' || target_project::text, 0));
  quota := coalesce((select q.quota_bytes from private.media_project_quotas q where q.project_id = target_project), 1073741824);
  usage := private.project_media_usage(target_project);
  if usage - old_size + new.size_bytes > quota then
    raise exception 'Project media quota exceeded' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function private.enforce_project_media_quota() from public, anon, authenticated;
create trigger assets_enforce_media_quota before insert or update of size_bytes on public.assets
for each row execute function private.enforce_project_media_quota();
create trigger asset_versions_enforce_media_quota before insert or update of size_bytes on public.asset_versions
for each row execute function private.enforce_project_media_quota();

create function private.begin_media_upload_impl(
  target_project uuid, request_key uuid, content_hash text, content_type text,
  upload_name text, upload_size bigint
) returns table(outcome text, intent_id uuid, lease_token uuid, object_path text, asset_id uuid)
language plpgsql volatile security definer set search_path = '' as $$
declare caller uuid := (select auth.uid()); existing private.media_upload_intents; token uuid; quota bigint; usage bigint; new_intent uuid := gen_random_uuid(); path text;
begin
  if caller is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if request_key is null or content_hash !~ '^[0-9a-f]{64}$' or content_type not in ('image/jpeg','image/png','image/webp','video/mp4','video/webm','audio/mpeg','audio/wav','application/pdf')
    or char_length(upload_name) not between 1 and 255 or upload_size not between 1 and 52428800 then
    raise exception 'Invalid upload intent' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.project_members m join public.projects p on p.id = m.project_id
    join public.organization_members om on om.organization_id = p.organization_id and om.user_id = m.user_id
    where m.project_id = target_project and m.user_id = caller and m.role in ('owner','editor')
  ) then raise exception 'Project upload forbidden' using errcode = '42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('media-quota:' || target_project::text, 0));
  select * into existing from private.media_upload_intents i
    where i.requested_by = caller and i.project_id = target_project and i.idempotency_key = request_key for update;
  if found then
    if existing.content_sha256 <> content_hash or existing.mime_type <> content_type or existing.original_name <> upload_name or existing.size_bytes <> upload_size then
      return query select 'conflict', existing.id, null::uuid, existing.object_path, existing.asset_id; return;
    end if;
    if existing.state = 'completed' then return query select 'completed', existing.id, null::uuid, existing.object_path, existing.asset_id; return; end if;
    if existing.state in ('cleanup_pending','abandoned') then return query select 'expired', existing.id, null::uuid, existing.object_path, null::uuid; return; end if;
    if existing.signed_expires_at is not null and existing.signed_expires_at <= clock_timestamp() then
      return query select 'expired', existing.id, null::uuid, existing.object_path, null::uuid; return;
    end if;
    if existing.lease_until > clock_timestamp() then return query select 'upload', existing.id, existing.lease_token, existing.object_path, null::uuid; return; end if;
    if existing.reconcile_after <= clock_timestamp() then
      update private.media_upload_intents set state = 'cleanup_pending', lease_token = null, lease_until = null, updated_at = clock_timestamp()
      where id = existing.id;
      return query select 'expired', existing.id, null::uuid, existing.object_path, null::uuid; return;
    end if;
    token := gen_random_uuid();
    update private.media_upload_intents set lease_token = token, lease_until = clock_timestamp() + interval '5 minutes',
      reconcile_after=greatest(reconcile_after,clock_timestamp()+interval '3 hours 10 minutes'), updated_at = clock_timestamp()
    where id = existing.id;
    return query select 'upload', existing.id, token, existing.object_path, null::uuid; return;
  end if;
  quota := coalesce((select q.quota_bytes from private.media_project_quotas q where q.project_id = target_project), 1073741824);
  usage := private.project_media_usage(target_project);
  if usage + 52428800 > quota then return query select 'quota', null::uuid, null::uuid, null::text, null::uuid; return; end if;
  token := gen_random_uuid();
  path := 'projects/' || target_project::text || '/' || new_intent::text || '/' || coalesce(nullif(left(trim(both '-' from regexp_replace(regexp_replace(upload_name, '\.[^.]*$', ''), '[^a-zA-Z0-9]+', '-', 'g')),80),''),'material') || '.' ||
    case content_type when 'image/jpeg' then 'jpg' when 'image/png' then 'png' when 'image/webp' then 'webp' when 'video/mp4' then 'mp4' when 'video/webm' then 'webm' when 'audio/mpeg' then 'mp3' when 'audio/wav' then 'wav' else 'pdf' end;
  if path ~ '/\.[a-z0-9]+$' or path ~ '//[.]' then path := regexp_replace(path, '/\.[a-z0-9]+$', '/material'); end if;
  insert into private.media_upload_intents(id,requested_by,project_id,idempotency_key,content_sha256,mime_type,original_name,size_bytes,object_path,lease_token,lease_until)
  values (new_intent,caller,target_project,request_key,content_hash,content_type,upload_name,upload_size,path,token,clock_timestamp()+interval '5 minutes');
  return query select 'upload', new_intent, token, path, null::uuid;
end $$;
revoke all on function private.begin_media_upload_impl(uuid,uuid,text,text,text,bigint) from public, anon;
grant execute on function private.begin_media_upload_impl(uuid,uuid,text,text,text,bigint) to authenticated;
grant usage on schema private to authenticated, service_role;
create function public.begin_media_upload(
  target_project uuid, request_key uuid, content_hash text, content_type text,
  upload_name text, upload_size bigint
) returns table(outcome text, intent_id uuid, lease_token uuid, object_path text, asset_id uuid)
language sql volatile security invoker set search_path = '' as $$
  select * from private.begin_media_upload_impl(target_project,request_key,content_hash,content_type,upload_name,upload_size);
$$;
revoke all on function public.begin_media_upload(uuid,uuid,text,text,text,bigint) from public, anon;
grant execute on function public.begin_media_upload(uuid,uuid,text,text,text,bigint) to authenticated;

create function private.assert_media_upload_lease_impl(target_intent uuid, token uuid)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
declare upload private.media_upload_intents;
begin
  select * into upload from private.media_upload_intents i where i.id=target_intent;
  return found and upload.state='uploading' and upload.lease_token=token and upload.lease_until>clock_timestamp()
    and upload.requested_by=(select auth.uid())
    and exists (
      select 1 from public.project_members m join public.projects p on p.id=m.project_id
      join public.organization_members om on om.organization_id=p.organization_id and om.user_id=m.user_id
      where m.project_id=upload.project_id and m.user_id=upload.requested_by and m.role in ('owner','editor')
    );
end $$;
revoke all on function private.assert_media_upload_lease_impl(uuid,uuid) from public, anon;
grant execute on function private.assert_media_upload_lease_impl(uuid,uuid) to authenticated;
create function public.assert_media_upload_lease(target_intent uuid, token uuid)
returns boolean language sql volatile security invoker set search_path = '' as $$
  select private.assert_media_upload_lease_impl(target_intent,token);
$$;
revoke all on function public.assert_media_upload_lease(uuid,uuid) from public, anon;
grant execute on function public.assert_media_upload_lease(uuid,uuid) to authenticated;

-- The signed token is persisted before it is returned to the caller. Retries
-- can only replay the same token; they may not silently extend its 2h lifetime.
create function public.store_media_upload_token(target_intent uuid, token uuid, signed_token text)
returns table(upload_token text, expires_at timestamptz)
language plpgsql volatile security invoker set search_path = '' as $$
begin
  if signed_token is not null and char_length(signed_token) not between 1 and 4096 then raise exception 'Invalid signed token' using errcode='22023'; end if;
  if signed_token is not null then update private.media_upload_intents i set signed_upload_token=signed_token,
    signed_expires_at=clock_timestamp()+interval '2 hours',
    reconcile_after=clock_timestamp()+interval '3 hours',
    lease_until=clock_timestamp()+interval '2 hours'
  where i.id=target_intent and i.state='uploading' and i.lease_token=token and i.lease_until>clock_timestamp()
    and i.signed_upload_token is null;
  end if;
  if found then
    return query select i.signed_upload_token,i.signed_expires_at from private.media_upload_intents i where i.id=target_intent;
  else
    return query select i.signed_upload_token,i.signed_expires_at from private.media_upload_intents i
      where i.id=target_intent and i.state='uploading' and i.lease_token=token and i.signed_expires_at>clock_timestamp();
  end if;
end $$;
revoke all on function public.store_media_upload_token(uuid,uuid,text) from public, anon, authenticated;
grant select, update on private.media_upload_intents to service_role;
grant execute on function public.store_media_upload_token(uuid,uuid,text) to service_role;

create function public.get_media_upload_verification(target_intent uuid, token uuid, target_project uuid)
returns table(object_path text, mime_type text, content_sha256 text, size_bytes bigint)
language sql stable security invoker set search_path = '' as $$
  select i.object_path,i.mime_type,i.content_sha256,i.size_bytes from private.media_upload_intents i
  where i.id=target_intent and i.project_id=target_project and i.state='uploading'
    and i.lease_token=token and i.lease_until>clock_timestamp() and i.signed_expires_at>clock_timestamp();
$$;
revoke all on function public.get_media_upload_verification(uuid,uuid,uuid) from public, anon, authenticated;
grant select on private.media_upload_intents to service_role;
grant execute on function public.get_media_upload_verification(uuid,uuid,uuid) to service_role;

create function private.get_media_upload_status_impl(target_project uuid, request_key uuid, content_hash text)
returns table(outcome text, asset_id uuid)
language plpgsql stable security definer set search_path = '' as $$
declare caller uuid := (select auth.uid()); intent private.media_upload_intents;
begin
  if caller is null or request_key is null or content_hash !~ '^[0-9a-f]{64}$' then return query select 'none',null::uuid; return; end if;
  select * into intent from private.media_upload_intents i
    where i.project_id=target_project and i.requested_by=caller and i.idempotency_key=request_key;
  if not found then return query select 'none',null::uuid; return; end if;
  if intent.content_sha256<>content_hash then return query select 'conflict',null::uuid; return; end if;
  if intent.state='completed' then return query select 'completed',intent.asset_id; return; end if;
  if intent.state in ('cleanup_pending','abandoned') or intent.reconcile_after<=statement_timestamp() then
    return query select 'expired',null::uuid; return;
  end if;
  if intent.lease_until>statement_timestamp() then return query select 'pending',null::uuid; return; end if;
  return query select 'retry',null::uuid;
end $$;
revoke all on function private.get_media_upload_status_impl(uuid,uuid,text) from public, anon;
grant execute on function private.get_media_upload_status_impl(uuid,uuid,text) to authenticated;
create function public.get_media_upload_status(target_project uuid, request_key uuid, content_hash text)
returns table(outcome text, asset_id uuid)
language sql stable security invoker set search_path = '' as $$
  select * from private.get_media_upload_status_impl(target_project,request_key,content_hash);
$$;
revoke all on function public.get_media_upload_status(uuid,uuid,text) from public, anon;
grant execute on function public.get_media_upload_status(uuid,uuid,text) to authenticated;

create function public.finish_media_upload(target_intent uuid, token uuid, actual_hash text, actual_size bigint)
returns uuid language plpgsql volatile security invoker set search_path = '' as $$
declare upload private.media_upload_intents; kind public.asset_kind; target_project uuid;
begin
  select i.project_id into target_project from private.media_upload_intents i where i.id=target_intent;
  if not found then return null; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('media-quota:' || target_project::text, 0));
  select * into upload from private.media_upload_intents i where i.id = target_intent for update;
  if not found then return null; end if;
  if upload.state = 'completed' then return upload.asset_id; end if;
  if upload.state <> 'uploading' or upload.lease_token is distinct from token or upload.lease_until <= clock_timestamp() then return null; end if;
  if actual_hash is distinct from upload.content_sha256 or actual_size is distinct from upload.size_bytes then return null; end if;
  if not exists (
    select 1 from public.project_members m join public.projects p on p.id = m.project_id
    join public.organization_members om on om.organization_id = p.organization_id and om.user_id = m.user_id
    where m.project_id = upload.project_id and m.user_id = upload.requested_by and m.role in ('owner','editor')
  ) then return null; end if;
  kind := case when upload.mime_type like 'image/%' then 'image'::public.asset_kind when upload.mime_type like 'video/%' then 'video'::public.asset_kind when upload.mime_type like 'audio/%' then 'audio'::public.asset_kind else 'document'::public.asset_kind end;
  -- Mark completed inside this transaction before INSERT so the path guard sees
  -- the reservation convert atomically into its metadata row.
  update private.media_upload_intents set state = 'completed', asset_id = id, lease_token = null, lease_until = null, updated_at = clock_timestamp()
  where id = upload.id;
  insert into public.assets(id,project_id,kind,name,storage_path,mime_type,size_bytes,created_by)
  values (upload.id,upload.project_id,kind,upload.original_name,upload.object_path,upload.mime_type,upload.size_bytes,upload.requested_by);
  return upload.id;
end $$;
revoke all on function public.finish_media_upload(uuid,uuid,text,bigint) from public, anon, authenticated;
grant select, update on private.media_upload_intents to service_role;
grant insert on public.assets to service_role;
grant select on public.project_members, public.projects, public.organization_members to service_role;
grant execute on function public.finish_media_upload(uuid,uuid,text,bigint) to service_role;

create function public.claim_media_upload_cleanup()
returns table(intent_id uuid, lease_token uuid, bucket_id text, object_path text)
language plpgsql volatile security invoker set search_path = '' as $$
declare claimed private.media_upload_intents;
begin
  select * into claimed from private.media_upload_intents i
  where ((i.state='uploading' and i.reconcile_after <= clock_timestamp() and (i.lease_until is null or i.lease_until <= clock_timestamp()))
    or (i.state='cleanup_pending' and i.reconcile_after <= clock_timestamp() and i.available_at <= clock_timestamp() and (i.lease_until is null or i.lease_until <= clock_timestamp())))
  order by i.available_at,i.created_at,i.id limit 1 for update skip locked;
  if not found then return; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('project-media:' || claimed.object_path, 0));
  if exists (select 1 from public.assets a where a.storage_path=claimed.object_path)
    or exists (select 1 from public.asset_versions v where v.storage_path=claimed.object_path) then
    update private.media_upload_intents set state='abandoned',lease_token=null,lease_until=null,updated_at=clock_timestamp() where id=claimed.id;
    return;
  end if;
  insert into private.media_retired_upload_paths(object_path,intent_id) values (claimed.object_path,claimed.id) on conflict on constraint media_retired_upload_paths_pkey do nothing;
  update private.media_upload_intents set state='cleanup_pending',lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '120 seconds',updated_at=clock_timestamp()
  where id=claimed.id returning * into claimed;
  return query select claimed.id,claimed.lease_token,'project-media'::text,claimed.object_path;
end $$;
revoke all on function public.claim_media_upload_cleanup() from public, anon, authenticated;
grant select, update on private.media_upload_intents to service_role;
grant select, insert on private.media_retired_upload_paths to service_role;
grant execute on function public.claim_media_upload_cleanup() to service_role;

create function public.finish_media_upload_cleanup(target_intent uuid, token uuid, success boolean, delay_seconds integer default 60)
returns boolean language plpgsql volatile security invoker set search_path = '' as $$
begin
  if delay_seconds is null or delay_seconds < 30 or delay_seconds > 3600 then raise exception 'Invalid retry delay' using errcode='22023'; end if;
  update private.media_upload_intents i set
    state = case when success then 'abandoned' else 'cleanup_pending' end,
    available_at = case when success then i.available_at else clock_timestamp()+make_interval(secs=>delay_seconds) end,
    lease_token = null, lease_until = null, updated_at=clock_timestamp()
  where i.id=target_intent and i.state='cleanup_pending' and i.lease_token=token and i.lease_until>clock_timestamp();
  return found;
end $$;
revoke all on function public.finish_media_upload_cleanup(uuid,uuid,boolean,integer) from public, anon, authenticated;
grant execute on function public.finish_media_upload_cleanup(uuid,uuid,boolean,integer) to service_role;

create function public.set_project_media_quota(target_project uuid, quota bigint)
returns void language plpgsql volatile security invoker set search_path = '' as $$
begin
  if quota is null or quota < 0 then raise exception 'Invalid media quota' using errcode='22023'; end if;
  insert into private.media_project_quotas(project_id,quota_bytes) values(target_project,quota)
  on conflict(project_id) do update set quota_bytes=excluded.quota_bytes,updated_at=clock_timestamp();
end $$;
revoke all on function public.set_project_media_quota(uuid,bigint) from public, anon, authenticated;
grant execute on function public.set_project_media_quota(uuid,bigint) to service_role;
