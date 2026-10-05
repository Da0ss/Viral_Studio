-- No FK to assets/projects: cleanup must survive deletion of either parent.
create table private.media_deletion_outbox (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null,
  project_id uuid not null,
  bucket_id text not null default 'project-media' check (bucket_id = 'project-media'),
  object_path text not null unique,
  created_at timestamptz not null default now(),
  available_at timestamptz not null default now(),
  attempts integer not null default 0 check (attempts >= 0),
  lease_token uuid,
  lease_until timestamptz,
  completed_at timestamptz,
  last_error text check (char_length(last_error) <= 500),
  check ((lease_token is null) = (lease_until is null))
);
alter table private.media_deletion_outbox enable row level security;
revoke all on private.media_deletion_outbox from public, anon, authenticated;
create index media_deletion_outbox_ready_idx on private.media_deletion_outbox(available_at, created_at)
where completed_at is null;

-- Internal trigger only: RLS on the originating DELETE authorizes the caller.
-- Definer privileges are needed solely to retain a private durable work item.
create function private.enqueue_media_deletion() returns trigger
language plpgsql security definer set search_path = '' as $$
declare queued_path text;
begin
  for queued_path in
    select old.storage_path union select v.storage_path from public.asset_versions v where v.asset_id = old.id
  loop
    if queued_path !~ '^projects/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[a-zA-Z0-9][a-zA-Z0-9_-]{0,100}\.[a-z0-9]{1,8}$'
      or (storage.foldername(queued_path))[2] <> old.project_id::text then
      raise exception 'Unsupported material storage path' using errcode = '23514';
    end if;
    insert into private.media_deletion_outbox(asset_id, project_id, object_path)
    values (old.id, old.project_id, queued_path)
    on conflict (object_path) do nothing;
  end loop;
  return old;
end $$;
revoke all on function private.enqueue_media_deletion() from public, anon, authenticated;
create trigger assets_enqueue_media_deletion before delete on public.assets
for each row execute function private.enqueue_media_deletion();
