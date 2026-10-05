-- Do not change ownership or add triggers to the managed Storage schema.
-- Restrictive policy remains effective alongside other permissive INSERT policies.
create function private.media_path_uploadable(object_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null
    and private.can_access_media(object_name, true)
    and not exists (
      select 1 from private.media_deletion_outbox q where q.object_path = object_name
    );
$$;
revoke all on function private.media_path_uploadable(text) from public, anon;
grant execute on function private.media_path_uploadable(text) to authenticated;

create policy "project-media: retired paths cannot upload" on storage.objects
as restrictive for insert to authenticated
with check (bucket_id <> 'project-media' or private.media_path_uploadable(name));
