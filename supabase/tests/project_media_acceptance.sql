begin;
do $$ begin
  if not exists (select 1 from storage.buckets where id='project-media' and not public and file_size_limit=52428800 and allowed_mime_types=array['image/jpeg','image/png','image/webp','video/mp4','video/webm','audio/mpeg','audio/wav','application/pdf']) then
    raise exception 'Media bucket restrictions missing';
  end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111"}',true);
insert into storage.objects(bucket_id,name) values ('project-media','projects/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/77777777-7777-4777-8777-777777777777/clip.mp4');
do $$ begin
  begin
    insert into storage.objects(bucket_id,name) values ('project-media','projects/not-a-uuid/invalid/clip.mp4');
    raise exception 'Malformed path accepted';
  exception when insufficient_privilege then null; end;
  begin
    insert into storage.objects(bucket_id,name) values ('project-media','projects/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/77777777-7777-4777-8777-777777777777/../clip.mp4');
    raise exception 'Traversal accepted';
  exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claims','{"sub":"22222222-2222-4222-8222-222222222222"}',true);
do $$ declare n integer; begin
  if (select count(*) from storage.objects where bucket_id='project-media') <> 1 then raise exception 'Participant cannot read'; end if;
  begin
    insert into storage.objects(bucket_id,name) values ('project-media','projects/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/88888888-8888-4888-8888-888888888888/clip.mp4');
    raise exception 'Commenter uploaded';
  exception when insufficient_privilege then null; end;
  delete from storage.objects where bucket_id='project-media';
  get diagnostics n = row_count;
  if n<>0 then raise exception 'Commenter deleted'; end if;
end $$;
select set_config('request.jwt.claims','{"sub":"33333333-3333-4333-8333-333333333333"}',true);
do $$ begin
  if exists(select 1 from storage.objects where bucket_id='project-media') then raise exception 'Outsider read media'; end if;
  begin
    insert into storage.objects(bucket_id,name) values ('project-media','projects/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/88888888-8888-4888-8888-888888888888/clip.mp4');
    raise exception 'Outsider uploaded';
  exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111"}',true);
do $$ declare n integer; begin
  update storage.objects set name='projects/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/77777777-7777-4777-8777-777777777777/other.mp4' where bucket_id='project-media';
  get diagnostics n = row_count;
  if n<>0 then raise exception 'Media overwrite allowed'; end if;
  delete from storage.objects where bucket_id='project-media';
  get diagnostics n = row_count;
  if n<>1 then raise exception 'Owner delete failed'; end if;
end $$;
insert into storage.objects(bucket_id,name) values ('project-media','projects/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/77777777-7777-4777-8777-777777777777/retained.mp4');
reset role;
-- Transfer organization ownership before revoking the previous sole owner.
update public.organization_members set role='owner'
where organization_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and user_id='22222222-2222-4222-8222-222222222222';
update public.project_members set role='owner'
where user_id='22222222-2222-4222-8222-222222222222';
delete from public.organization_members where user_id='11111111-1111-4111-8111-111111111111' and organization_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
set local role authenticated;
do $$ begin
  if exists(select 1 from storage.objects where bucket_id='project-media') then raise exception 'Revoked organization member retained access'; end if;
end $$;
rollback;
