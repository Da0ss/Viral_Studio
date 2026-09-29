-- Private, per-user avatars. Object names follow avatars/{userId}/{timestamp}-{safeFileName}.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = 5242880, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

drop policy if exists "avatars: user reads own" on storage.objects;
drop policy if exists "avatars: user uploads own" on storage.objects;
drop policy if exists "avatars: user deletes own" on storage.objects;

create policy "avatars: user reads own" on storage.objects for select to authenticated
using (bucket_id = 'avatars' and (storage.foldername(name))[1] = 'avatars' and (storage.foldername(name))[2] = (select auth.uid()::text));
create policy "avatars: user uploads own" on storage.objects for insert to authenticated
with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = 'avatars' and (storage.foldername(name))[2] = (select auth.uid()::text));
create policy "avatars: user deletes own" on storage.objects for delete to authenticated
using (bucket_id = 'avatars' and (storage.foldername(name))[1] = 'avatars' and (storage.foldername(name))[2] = (select auth.uid()::text));
