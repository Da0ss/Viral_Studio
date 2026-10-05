-- Immutable object names: projects/{project UUID}/{object UUID}/{safe filename}.
-- No UPDATE policy: replacing bytes must create a new object/version.
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('project-media', 'project-media', false, 52428800,
  array['image/jpeg','image/png','image/webp','video/mp4','video/webm','audio/mpeg','audio/wav','application/pdf']);

create function private.can_access_media(object_name text, write_access boolean)
returns boolean language sql stable security invoker set search_path = '' as $$
  select object_name ~ '^projects/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[a-zA-Z0-9][a-zA-Z0-9_-]{0,100}\.[a-z0-9]{1,8}$'
  and exists (
    select 1 from public.projects p
    join public.project_members m on m.project_id = p.id
    join public.organization_members o on o.organization_id = p.organization_id and o.user_id = m.user_id
    where p.id::text = (storage.foldername(object_name))[2]
      and m.user_id = (select auth.uid())
      and (not write_access or m.role in ('owner', 'editor'))
  );
$$;
revoke all on function private.can_access_media(text, boolean) from public, anon;
grant execute on function private.can_access_media(text, boolean) to authenticated;

create policy "project-media: participants read" on storage.objects for select to authenticated
using (bucket_id = 'project-media' and private.can_access_media(name, false));
create policy "project-media: editors upload" on storage.objects for insert to authenticated
with check (bucket_id = 'project-media' and private.can_access_media(name, true));
create policy "project-media: editors delete" on storage.objects for delete to authenticated
using (bucket_id = 'project-media' and private.can_access_media(name, true));
