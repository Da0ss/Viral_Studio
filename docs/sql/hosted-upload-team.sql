-- Hosted Viral Studio forward package: upload intents and team APIs.
-- Target inspected: sytjbknfwwbombypwfhc, hosted core ending at 20261005202352.
-- Apply this package before hosted-generation-metrics.sql. Do not record any of
-- the local source filenames as applied: hosted history bundled the core under
-- a different version. The deployment tool should run this file transactionally.
--
-- Source contracts:
--   20261005201417_media_upload_intents.sql
--   20261005201459_team_invitations.sql
--   20261006022500_project_team_roster.sql
--
-- Asset-version upload support is deliberately excluded. Its current quota
-- function references private.generation_output_reservations, so it belongs in
-- a later stage after hosted-generation-metrics.sql.

-- The hosted migration runner must keep this package in one transaction. This
-- makes the zero/under-quota compatibility check race-safe against media writes.
lock table public.assets, public.asset_versions in share row exclusive mode;

do $preflight$
begin
  if to_regnamespace('private') is null
    or to_regclass('public.assets') is null
    or to_regclass('public.asset_versions') is null
    or to_regclass('public.projects') is null
    or to_regclass('public.project_members') is null
    or to_regclass('public.organizations') is null
    or to_regclass('public.organization_members') is null
    or to_regclass('public.profiles') is null
    or to_regclass('private.media_deletion_outbox') is null
    or to_regclass('storage.objects') is null
    or to_regclass('storage.buckets') is null then
    raise exception 'Hosted core precondition failed: required relations are missing';
  end if;

  if to_regtype('public.asset_kind') is null
    or to_regtype('public.organization_role') is null
    or to_regtype('public.project_role') is null then
    raise exception 'Hosted core precondition failed: required enum types are missing';
  end if;

  if to_regprocedure('private.guard_media_path_reuse()') is null
    or to_regprocedure('private.is_organization_owner(uuid,uuid)') is null
    or to_regprocedure('public.set_updated_at()') is null
    or to_regprocedure('public.claim_media_cleanup()') is null
    or to_regprocedure('public.inspect_media_cleanup(uuid,uuid)') is null
    or to_regprocedure('public.finish_media_cleanup(uuid,uuid,text,integer)') is null then
    raise exception 'Hosted core precondition failed: required helpers or cleanup RPCs are missing';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_proc p
    where p.oid = 'public.set_updated_at()'::regprocedure
      and 'search_path=pg_catalog' = any(coalesce(p.proconfig, array[]::text[]))
  ) then
    raise exception 'Hosted core precondition failed: set_updated_at search_path is not pinned to pg_catalog';
  end if;
  if to_regprocedure('public.rls_auto_enable()') is not null
    and (
      has_function_privilege('anon','public.rls_auto_enable()','EXECUTE')
      or has_function_privilege('authenticated','public.rls_auto_enable()','EXECUTE')
    ) then
    raise exception 'Hosted core precondition failed: platform RLS helper is client-executable';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_trigger
    where tgrelid = 'public.assets'::regclass
      and tgname = 'assets_guard_media_path_reuse' and not tgisinternal
  ) or not exists (
    select 1 from pg_catalog.pg_trigger
    where tgrelid = 'public.asset_versions'::regclass
      and tgname = 'asset_versions_guard_media_path_reuse' and not tgisinternal
  ) then
    raise exception 'Hosted core precondition failed: media path guard triggers are missing';
  end if;

  if exists (
    select 1 from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('public','private')
      and c.relname in ('team_invitations','media_project_quotas','media_upload_intents','media_retired_upload_paths')
  ) then
    raise exception 'Forward package precondition failed: one or more target relations already exist';
  end if;

  if to_regprocedure('public.begin_media_upload(uuid,uuid,text,text,text,bigint)') is not null
    or to_regprocedure('public.accept_team_invitation(text)') is not null
    or to_regprocedure('public.list_team_members(uuid)') is not null
    or to_regprocedure('public.list_project_team_members(uuid)') is not null then
    raise exception 'Forward package precondition failed: one or more target APIs already exist';
  end if;

  if exists (
    select 1 from pg_catalog.pg_policy
    where polrelid = 'public.organization_members'::regclass
      and polname = 'organization_members: team managers read roster'
  ) then
    raise exception 'Forward package precondition failed: team roster policy already exists';
  end if;

  if not exists (
    select 1 from storage.buckets
    where id = 'project-media' and name = 'project-media' and public is false
      and file_size_limit = 52428800
  ) then
    raise exception 'Hosted core precondition failed: private project-media bucket configuration differs';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_policy
    where polrelid = 'storage.objects'::regclass
      and polname = 'project-media: retired paths cannot upload'
      and polcmd = 'a' and not polpermissive
      and polroles @> array['authenticated'::regrole::oid]
  ) then
    raise exception 'Hosted core precondition failed: restrictive project-media upload fence is missing';
  end if;

  if exists (
    select 1
    from (
      select a.project_id, sum(a.size_bytes::bigint) as bytes
      from public.assets a
      group by a.project_id
    ) asset_usage
    left join (
      select a.project_id, sum(v.size_bytes::bigint) as bytes
      from public.asset_versions v
      join public.assets a on a.id = v.asset_id
      group by a.project_id
    ) version_usage using (project_id)
    where asset_usage.bytes + coalesce(version_usage.bytes, 0) > 1073741824
  ) then
    raise exception 'Hosted data precondition failed: at least one project exceeds the default 1 GiB media quota';
  end if;
end
$preflight$;

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

-- Metadata creation is part of the trusted finalize transaction. The application
-- has no direct client INSERT/UPDATE path for assets or versions; retaining those
-- grants would let a client bypass reservation accounting or rewrite immutable
-- tenant/path/creator fields. Preserve authenticated SELECT and DELETE behavior.
revoke insert, update on public.assets, public.asset_versions from public, anon, authenticated;
do $column_grants$
declare
  relation record;
  columns text;
begin
  for relation in
    select c.oid, c.relname
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in ('assets','asset_versions')
      and c.relkind in ('r','p')
  loop
    select string_agg(pg_catalog.quote_ident(a.attname), ', ' order by a.attnum)
      into columns
    from pg_catalog.pg_attribute a
    where a.attrelid = relation.oid and a.attnum > 0 and not a.attisdropped;
    execute pg_catalog.format(
      'revoke insert (%1$s), update (%1$s) on public.%2$I from public, anon, authenticated',
      columns, relation.relname
    );
  end loop;
end
$column_grants$;
grant insert on public.assets, public.asset_versions to service_role;

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
    join public.organization_members om on om.organization_id=p.organization_id and om.user_id=m.user_id
    where m.project_id=upload.project_id and m.user_id=upload.requested_by and m.role in ('owner','editor')
  ) then return null; end if;
  kind := case when upload.mime_type like 'image/%' then 'image'::public.asset_kind when upload.mime_type like 'video/%' then 'video'::public.asset_kind when upload.mime_type like 'audio/%' then 'audio'::public.asset_kind else 'document'::public.asset_kind end;
  update private.media_upload_intents set state='completed',asset_id=id,lease_token=null,lease_until=null,updated_at=clock_timestamp()
  where id=upload.id;
  insert into public.assets(id,project_id,kind,name,storage_path,mime_type,size_bytes,created_by)
  values(upload.id,upload.project_id,kind,upload.original_name,upload.object_path,upload.mime_type,upload.size_bytes,upload.requested_by);
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
  where ((i.state='uploading' and i.reconcile_after<=clock_timestamp() and (i.lease_until is null or i.lease_until<=clock_timestamp()))
    or (i.state='cleanup_pending' and i.reconcile_after<=clock_timestamp() and i.available_at<=clock_timestamp() and (i.lease_until is null or i.lease_until<=clock_timestamp())))
  order by i.available_at,i.created_at,i.id limit 1 for update skip locked;
  if not found then return; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('project-media:' || claimed.object_path, 0));
  if exists (select 1 from public.assets a where a.storage_path=claimed.object_path)
    or exists (select 1 from public.asset_versions v where v.storage_path=claimed.object_path) then
    update private.media_upload_intents set state='abandoned',lease_token=null,lease_until=null,updated_at=clock_timestamp() where id=claimed.id;
    return;
  end if;
  insert into private.media_retired_upload_paths(object_path,intent_id) values (claimed.object_path,claimed.id)
    on conflict on constraint media_retired_upload_paths_pkey do nothing;
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
    state=case when success then 'abandoned' else 'cleanup_pending' end,
    available_at=case when success then i.available_at else clock_timestamp()+make_interval(secs=>delay_seconds) end,
    lease_token=null,lease_until=null,updated_at=clock_timestamp()
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

-- Team invitations: one-time, email-bound bearer hashes. The token hash remains
-- inaccessible through direct authenticated table reads.
create table public.team_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  email text not null check (email = lower(btrim(email)) and email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  organization_role public.organization_role not null default 'member' check (organization_role <> 'owner'),
  project_role public.project_role check (project_role is null or project_role <> 'owner'),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  invited_by uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint team_invitation_lifetime check (expires_at > created_at and expires_at <= created_at + interval '7 days'),
  constraint team_invitation_terminal_state check (accepted_at is null or revoked_at is null),
  constraint team_invitation_scope_roles check (
    (project_id is null and project_role is null)
    or (project_id is not null and project_role is not null and organization_role = 'member')
  )
);

create index team_invitations_pending_org_idx
  on public.team_invitations (organization_id, created_at desc)
  where accepted_at is null and revoked_at is null;

alter table public.team_invitations enable row level security;
revoke all on public.team_invitations from public, anon, authenticated;
revoke select on public.team_invitations from authenticated;
grant select (id, organization_id, project_id, email, organization_role, project_role, invited_by, expires_at, accepted_at, revoked_at, created_at)
  on public.team_invitations to authenticated;
grant insert (organization_id, project_id, email, organization_role, project_role, token_hash, invited_by, expires_at)
  on public.team_invitations to authenticated;

create function private.can_manage_organization_team(target_organization_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = target_organization_id
      and m.user_id = (select auth.uid())
      and m.role in ('owner', 'admin')
  );
$$;
revoke all on function private.can_manage_organization_team(uuid) from public, anon;
grant execute on function private.can_manage_organization_team(uuid) to authenticated;

create policy "organization_members: team managers read roster" on public.organization_members
  for select to authenticated
  using ((select private.can_manage_organization_team(organization_id)));

create policy "team invitations: managers read" on public.team_invitations
  for select to authenticated
  using ((select private.can_manage_organization_team(organization_id)));

create policy "team invitations: managers create limited roles" on public.team_invitations
  for insert to authenticated
  with check (
    invited_by = (select auth.uid())
    and (select private.can_manage_organization_team(organization_id))
    and (organization_role <> 'admin' or (select private.is_organization_owner(organization_id, (select auth.uid()))))
    and (
      project_id is null
      or exists (
        select 1 from public.projects p
        where p.id = public.team_invitations.project_id
          and p.organization_id = public.team_invitations.organization_id
      )
    )
  );

create function private.accept_team_invitation(target_token_hash text)
returns table (organization_id uuid, project_id uuid)
language plpgsql security definer set search_path = '' as $$
declare
  invitation public.team_invitations%rowtype;
  verified_email text;
begin
  if auth.uid() is null or target_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invitation unavailable' using errcode = '42501';
  end if;

  select lower(u.email) into verified_email
  from auth.users u
  where u.id = (select auth.uid()) and u.email_confirmed_at is not null;
  if verified_email is null then
    raise exception 'A verified email is required' using errcode = '42501';
  end if;

  select i.* into invitation
  from public.team_invitations i
  where i.token_hash = target_token_hash
    and i.email = verified_email
    and i.accepted_at is null
    and i.revoked_at is null
    and i.expires_at > now()
  for update;
  if not found then
    raise exception 'Invitation unavailable or expired' using errcode = '42501';
  end if;

  perform 1 from public.organization_members m
  where m.organization_id = invitation.organization_id
    and m.user_id = invitation.invited_by
    and m.role in ('owner', 'admin')
  for share;
  if not found then
    raise exception 'Invitation issuer no longer has team access' using errcode = '42501';
  end if;
  if invitation.organization_role = 'admin' then
    perform 1 from public.organization_members m
    where m.organization_id = invitation.organization_id
      and m.user_id = invitation.invited_by
      and m.role = 'owner'
    for share;
    if not found then
      raise exception 'Invitation issuer can no longer grant admin access' using errcode = '42501';
    end if;
  end if;

  insert into public.organization_members (organization_id, user_id, role)
  values (invitation.organization_id, (select auth.uid()), invitation.organization_role)
  on conflict on constraint organization_members_pkey do update
    set role = case
      when public.organization_members.role = 'owner' then 'owner'::public.organization_role
      when public.organization_members.role = 'admin' then 'admin'::public.organization_role
      else excluded.role
    end;

  if invitation.project_id is not null then
    insert into public.project_members (project_id, user_id, role)
    values (invitation.project_id, (select auth.uid()), invitation.project_role)
    on conflict on constraint project_members_pkey do update
      set role = case
        when public.project_members.role = 'owner' then 'owner'::public.project_role
        when public.project_members.role = 'editor' then 'editor'::public.project_role
        when public.project_members.role = 'commenter' and excluded.role = 'viewer' then 'commenter'::public.project_role
        else excluded.role
      end;
  end if;

  update public.team_invitations set accepted_at = now() where id = invitation.id;
  return query select invitation.organization_id, invitation.project_id;
end;
$$;
revoke all on function private.accept_team_invitation(text) from public, anon;
grant execute on function private.accept_team_invitation(text) to authenticated;

create function public.accept_team_invitation(target_token_hash text)
returns table (organization_id uuid, project_id uuid)
language sql security invoker set search_path = '' as $$
  select * from private.accept_team_invitation(target_token_hash);
$$;
revoke all on function public.accept_team_invitation(text) from public, anon;
grant execute on function public.accept_team_invitation(text) to authenticated;

create function private.revoke_team_invitation(target_invitation_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare invitation_organization_id uuid;
begin
  select i.organization_id into invitation_organization_id
  from public.team_invitations i where i.id = target_invitation_id;
  if invitation_organization_id is null
    or not (select private.can_manage_organization_team(invitation_organization_id)) then
    return false;
  end if;
  update public.team_invitations i set revoked_at = now()
  where i.id = target_invitation_id and i.accepted_at is null and i.revoked_at is null;
  return found;
end;
$$;
revoke all on function private.revoke_team_invitation(uuid) from public, anon;
grant execute on function private.revoke_team_invitation(uuid) to authenticated;

create function public.revoke_team_invitation(target_invitation_id uuid)
returns boolean language sql security invoker set search_path = '' as $$
  select private.revoke_team_invitation(target_invitation_id);
$$;
revoke all on function public.revoke_team_invitation(uuid) from public, anon;
grant execute on function public.revoke_team_invitation(uuid) to authenticated;

create function private.list_team_members(target_organization_id uuid)
returns table (user_id uuid, name text, email text, role public.organization_role, joined_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select m.user_id, p.name, p.email, m.role, m.created_at
  from public.organization_members m
  join public.profiles p on p.id = m.user_id
  where m.organization_id = target_organization_id
    and (select private.can_manage_organization_team(target_organization_id))
  order by case m.role when 'owner' then 0 when 'admin' then 1 else 2 end, lower(p.name), m.user_id;
$$;
revoke all on function private.list_team_members(uuid) from public, anon;
grant execute on function private.list_team_members(uuid) to authenticated;

create function public.list_team_members(target_organization_id uuid)
returns table (user_id uuid, name text, email text, role public.organization_role, joined_at timestamptz)
language sql security invoker set search_path = '' as $$
  select * from private.list_team_members(target_organization_id);
$$;
revoke all on function public.list_team_members(uuid) from public, anon;
grant execute on function public.list_team_members(uuid) to authenticated;

-- Project owners need one narrowly-scoped profile lookup for managing project
-- membership. Direct membership changes continue to use authenticated DML/RLS.
create function private.list_project_team_members(target_project_id uuid)
returns table (user_id uuid, name text, email text, role public.project_role, joined_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select m.user_id, p.name, p.email, m.role, m.created_at
  from public.project_members m
  join public.profiles p on p.id = m.user_id
  where m.project_id = target_project_id
    and exists (
      select 1 from public.project_members caller
      join public.projects parent_project on parent_project.id = caller.project_id
      join public.organization_members organization_member
        on organization_member.organization_id = parent_project.organization_id
       and organization_member.user_id = caller.user_id
      where caller.project_id = target_project_id
        and caller.user_id = (select auth.uid())
        and caller.role = 'owner'
    )
  order by case m.role when 'owner' then 0 when 'editor' then 1 when 'commenter' then 2 else 3 end, lower(p.name), m.user_id;
$$;
revoke all on function private.list_project_team_members(uuid) from public, anon;
grant execute on function private.list_project_team_members(uuid) to authenticated;

create function public.list_project_team_members(target_project_id uuid)
returns table (user_id uuid, name text, email text, role public.project_role, joined_at timestamptz)
language sql security invoker set search_path = '' as $$
  select * from private.list_project_team_members(target_project_id);
$$;
revoke all on function public.list_project_team_members(uuid) from public, anon;
grant execute on function public.list_project_team_members(uuid) to authenticated;

-- Fail the same transaction if the intended public/private boundary differs.
do $postflight$
begin
  if not (select c.relrowsecurity from pg_catalog.pg_class c where c.oid = 'private.media_upload_intents'::regclass)
    or not (select c.relrowsecurity from pg_catalog.pg_class c where c.oid = 'private.media_project_quotas'::regclass)
    or not (select c.relrowsecurity from pg_catalog.pg_class c where c.oid = 'private.media_retired_upload_paths'::regclass)
    or not (select c.relrowsecurity from pg_catalog.pg_class c where c.oid = 'public.team_invitations'::regclass) then
    raise exception 'Postflight failed: RLS is not enabled on every new relation';
  end if;

  if has_table_privilege('authenticated','private.media_upload_intents','SELECT')
    or has_table_privilege('authenticated','private.media_project_quotas','SELECT')
    or has_table_privilege('authenticated','public.team_invitations','SELECT')
    or has_column_privilege('authenticated','public.team_invitations','token_hash','SELECT')
    or has_table_privilege('authenticated','public.team_invitations','UPDATE')
    or has_table_privilege('authenticated','public.team_invitations','DELETE')
    or has_function_privilege('anon','public.begin_media_upload(uuid,uuid,text,text,text,bigint)','EXECUTE')
    or has_function_privilege('authenticated','public.finish_media_upload(uuid,uuid,text,bigint)','EXECUTE')
    or has_function_privilege('authenticated','public.claim_media_upload_cleanup()','EXECUTE')
    or has_function_privilege('anon','public.accept_team_invitation(text)','EXECUTE')
    or has_function_privilege('anon','private.accept_team_invitation(text)','EXECUTE') then
    raise exception 'Postflight failed: an upload or invitation boundary is exposed';
  end if;

  if has_any_column_privilege('anon','public.assets','INSERT')
    or has_any_column_privilege('anon','public.assets','UPDATE')
    or has_any_column_privilege('authenticated','public.assets','INSERT')
    or has_any_column_privilege('authenticated','public.assets','UPDATE')
    or has_any_column_privilege('anon','public.asset_versions','INSERT')
    or has_any_column_privilege('anon','public.asset_versions','UPDATE')
    or has_any_column_privilege('authenticated','public.asset_versions','INSERT')
    or has_any_column_privilege('authenticated','public.asset_versions','UPDATE') then
    raise exception 'Postflight failed: client asset metadata writes remain granted';
  end if;

  if not has_function_privilege('authenticated','public.begin_media_upload(uuid,uuid,text,text,text,bigint)','EXECUTE')
    or not has_function_privilege('authenticated','public.accept_team_invitation(text)','EXECUTE')
    or not has_function_privilege('authenticated','public.list_team_members(uuid)','EXECUTE')
    or not has_function_privilege('authenticated','public.list_project_team_members(uuid)','EXECUTE')
    or not has_table_privilege('service_role','public.assets','INSERT')
    or not has_table_privilege('service_role','public.asset_versions','INSERT')
    or not has_function_privilege('service_role','public.finish_media_upload(uuid,uuid,text,bigint)','EXECUTE')
    or not has_function_privilege('service_role','public.claim_media_upload_cleanup()','EXECUTE') then
    raise exception 'Postflight failed: an intended RPC grant is missing';
  end if;

  if exists (
    select 1 from pg_catalog.pg_proc p
    where p.oid in (
      'public.begin_media_upload(uuid,uuid,text,text,text,bigint)'::regprocedure,
      'public.assert_media_upload_lease(uuid,uuid)'::regprocedure,
      'public.get_media_upload_status(uuid,uuid,text)'::regprocedure,
      'public.finish_media_upload(uuid,uuid,text,bigint)'::regprocedure,
      'public.accept_team_invitation(text)'::regprocedure,
      'public.list_team_members(uuid)'::regprocedure,
      'public.list_project_team_members(uuid)'::regprocedure
    ) and p.prosecdef
  ) then
    raise exception 'Postflight failed: a public RPC unexpectedly uses SECURITY DEFINER';
  end if;

  if (select p.prosecdef from pg_catalog.pg_proc p where p.oid = 'private.media_path_uploadable(text)'::regprocedure)
    or has_function_privilege('anon','private.media_path_uploadable(text)','EXECUTE') then
    raise exception 'Postflight failed: the Storage upload fence has unsafe function security';
  end if;

  if exists (
    select 1 from pg_catalog.pg_policy
    where polrelid = 'storage.objects'::regclass
      and polname = 'project-media: editors upload'
  ) then
    raise exception 'Postflight failed: direct authenticated project-media upload policy remains';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_policy
    where polrelid = 'storage.objects'::regclass
      and polname = 'project-media: retired paths cannot upload'
      and polcmd = 'a' and not polpermissive
      and polroles @> array['authenticated'::regrole::oid]
  ) then
    raise exception 'Postflight failed: restrictive project-media upload fence is missing';
  end if;
end
$postflight$;
