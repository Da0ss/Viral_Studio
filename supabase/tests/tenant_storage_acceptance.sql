-- Disposable database only; requires the three seed identities. All writes roll back.
begin;
-- Supabase Storage blocks direct SQL deletes to prevent orphaned blobs. Limit
-- the documented override to this rolled-back transaction while exercising RLS.
select set_config('storage.allow_delete_query','true',true);
set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';

-- Real onboarding under RLS, not a privileged fixture insert.
insert into public.organizations(id,name,slug,created_by) values
('44444444-4444-4444-8444-444444444444','Independent tenant','independent-tenant','33333333-3333-4333-8333-333333333333');
do $$ begin
  if not exists (select 1 from public.organization_members where organization_id='44444444-4444-4444-8444-444444444444' and user_id=auth.uid() and role='owner') then
    raise exception 'onboarding did not atomically create owner membership';
  end if;
end $$;
insert into public.projects(id,organization_id,name,created_by) values
('55555555-5555-4555-8555-555555555555','44444444-4444-4444-8444-444444444444','Independent project','33333333-3333-4333-8333-333333333333');
do $$ declare affected integer; begin
  if (select count(*) from public.projects) <> 1 then raise exception 'tenant B can see tenant A projects'; end if;
  if not exists (select 1 from public.project_members where project_id='55555555-5555-4555-8555-555555555555' and user_id=auth.uid() and role='owner') then raise exception 'project creator missing owner membership'; end if;
  update public.projects set name='Own project updated' where id='55555555-5555-4555-8555-555555555555';
  get diagnostics affected=row_count;
  if affected<>1 then raise exception 'owner cannot update own project'; end if;
  update public.projects set name='Foreign project' where id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  get diagnostics affected=row_count;
  if affected<>0 then raise exception 'tenant B can update tenant A project'; end if;
  delete from public.projects where id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  get diagnostics affected=row_count;
  if affected<>0 then raise exception 'tenant B can delete tenant A project'; end if;
  begin
    insert into public.projects(organization_id,name,created_by) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Unauthorized project',auth.uid());
    raise exception 'tenant B owner can create in tenant A';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.project_members(project_id,user_id,role) values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',auth.uid(),'owner');
    raise exception 'tenant B can promote itself in tenant A';
  exception when insufficient_privilege then null; end;
end $$;

-- Own avatar upload/read/delete must work; another identity must not access it.
insert into storage.objects(bucket_id,name) values ('avatars','avatars/33333333-3333-4333-8333-333333333333/test.png');
do $$ begin
  if (select count(*) from storage.objects where name='avatars/33333333-3333-4333-8333-333333333333/test.png')<>1 then raise exception 'own avatar not readable'; end if;
  begin
    insert into storage.objects(bucket_id,name) values ('avatars','avatars/11111111-1111-4111-8111-111111111111/foreign.png');
    raise exception 'foreign avatar upload accepted';
  exception when insufficient_privilege then null; end;
end $$;

set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
do $$ declare affected integer; begin
  if (select count(*) from public.projects)<>2 then raise exception 'tenant A can see tenant B projects'; end if;
  begin
    update public.projects set organization_id='44444444-4444-4444-8444-444444444444' where id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    raise exception 'tenant A can move its project into tenant B';
  exception when check_violation or insufficient_privilege then null; end;
  if not exists (select 1 from public.projects where id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' and organization_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and name='Seed campaign') then
    raise exception 'denied tenant writes changed or deleted the original project';
  end if;
  if exists (select 1 from public.project_members where project_id='55555555-5555-4555-8555-555555555555') then raise exception 'tenant A can see tenant B project members'; end if;
  if exists (select 1 from storage.objects where name='avatars/33333333-3333-4333-8333-333333333333/test.png') then raise exception 'foreign avatar read accepted'; end if;
  delete from storage.objects where name='avatars/33333333-3333-4333-8333-333333333333/test.png';
  get diagnostics affected=row_count;
  if affected<>0 then raise exception 'foreign avatar delete accepted'; end if;
end $$;
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
do $$ declare affected integer; begin
  if not exists (select 1 from storage.objects where name='avatars/33333333-3333-4333-8333-333333333333/test.png') then raise exception 'denied foreign delete removed avatar'; end if;
  delete from storage.objects where name='avatars/33333333-3333-4333-8333-333333333333/test.png';
  get diagnostics affected=row_count;
  if affected<>1 then raise exception 'own avatar delete denied'; end if;
  delete from public.projects where id='55555555-5555-4555-8555-555555555555';
  get diagnostics affected=row_count;
  if affected<>1 then raise exception 'owner cannot delete own project'; end if;
end $$;
rollback;

-- Profile updates and competing avatar writes preserve the committed path.
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
do $$ declare affected integer; begin
  if exists (select 1 from public.notifications where user_id<>auth.uid()) then raise exception 'notification read leaked another user'; end if;
  update public.notifications set read_at=now() where id='ffffffff-ffff-4fff-8fff-ffffffffffff' and read_at is null;
  get diagnostics affected=row_count;
  if affected<>1 then raise exception 'own notification could not be marked read'; end if;
  update public.notifications set read_at=now() where id='99999999-9999-4999-8999-999999999999';
  get diagnostics affected=row_count;
  if affected<>0 then raise exception 'foreign notification marked read'; end if;
end $$;
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
do $$ begin
  if not exists (select 1 from public.notifications where id='99999999-9999-4999-8999-999999999999' and read_at is null) then raise exception 'foreign update changed notification'; end if;
end $$;
rollback;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
do $$ declare affected integer; begin
  update public.profiles set avatar_path='avatars/11111111-1111-4111-8111-111111111111/first.png' where id=auth.uid() and avatar_path is null;
  get diagnostics affected=row_count;
  if affected<>1 then raise exception 'initial avatar compare-and-set failed'; end if;
  update public.profiles set avatar_path='avatars/11111111-1111-4111-8111-111111111111/stale.png' where id=auth.uid() and avatar_path is null;
  get diagnostics affected=row_count;
  if affected<>0 then raise exception 'stale avatar compare-and-set overwrote current path'; end if;
  update public.profiles set name='Updated profile' where id=auth.uid();
  if not exists (select 1 from public.profiles where id=auth.uid() and avatar_path='avatars/11111111-1111-4111-8111-111111111111/first.png') then raise exception 'profile field update overwrote avatar'; end if;
end $$;
rollback;

-- The bucket configuration is stored in SQL; HTTP MIME/size enforcement needs
-- a separate real Storage service test, not insertion into storage.objects.
do $$ begin
  if not exists (select 1 from storage.buckets where id='avatars' and not public and file_size_limit=5242880 and allowed_mime_types=array['image/jpeg','image/png','image/webp']) then
    raise exception 'avatar bucket is not private or restrictions differ';
  end if;
end $$;
