-- All metadata writers and deletion enqueue share transaction-level path locks.
-- Completed outbox rows are permanent tombstones, never reusable object names.
create function private.guard_media_path_reuse() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('project-media:' || new.storage_path, 0));
  if exists (select 1 from private.media_deletion_outbox q where q.object_path = new.storage_path) then
    raise exception 'Material path is retired' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function private.guard_media_path_reuse() from public, anon, authenticated;
create trigger assets_guard_media_path_reuse before insert or update of storage_path on public.assets
for each row execute function private.guard_media_path_reuse();
create trigger asset_versions_guard_media_path_reuse before insert or update of storage_path on public.asset_versions
for each row execute function private.guard_media_path_reuse();

create or replace function private.enqueue_media_deletion() returns trigger
language plpgsql security definer set search_path = '' as $$
declare queued_path text;
begin
  for queued_path in
    select paths.storage_path from (
      select old.storage_path union select v.storage_path from public.asset_versions v where v.asset_id = old.id
    ) paths order by paths.storage_path
  loop
    if queued_path !~ '^projects/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[a-zA-Z0-9][a-zA-Z0-9_-]{0,100}\.[a-z0-9]{1,8}$'
      or (storage.foldername(queued_path))[2] <> old.project_id::text then
      raise exception 'Unsupported material storage path' using errcode = '23514';
    end if;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('project-media:' || queued_path, 0));
    insert into private.media_deletion_outbox(asset_id, project_id, object_path)
    values (old.id, old.project_id, queued_path) on conflict (object_path) do nothing;
  end loop;
  return old;
end $$;
revoke all on function private.enqueue_media_deletion() from public, anon, authenticated;
