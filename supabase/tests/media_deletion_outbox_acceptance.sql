begin;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111"}',true);
insert into public.assets(id, project_id, kind, name, storage_path, mime_type, size_bytes, created_by)
values ('12121212-1212-4212-8212-121212121212','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','image','Cleanup fixture',
'projects/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/12121212-1212-4212-8212-121212121212/original.png','image/png',8,'11111111-1111-4111-8111-111111111111');
insert into public.assets(id,project_id,kind,name,storage_path,mime_type,size_bytes,created_by)
values ('14141414-1414-4414-8414-141414141414','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','image','Other fixture',
'projects/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/14141414-1414-4414-8414-141414141414/other.png','image/png',8,'11111111-1111-4111-8111-111111111111');
insert into public.asset_versions(asset_id,version_number,storage_path,mime_type,size_bytes,created_by)
values ('12121212-1212-4212-8212-121212121212',1,'projects/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/13131313-1313-4313-8313-131313131313/version.png','image/png',8,'11111111-1111-4111-8111-111111111111');
reset role;
savepoint before_deletion;
set local role authenticated;
delete from public.assets where id='12121212-1212-4212-8212-121212121212';
reset role;
do $$ begin
  if (select count(*) from private.media_deletion_outbox where asset_id='12121212-1212-4212-8212-121212121212')<>2 then raise exception 'Original/version cleanup not queued'; end if;
end $$;
rollback to savepoint before_deletion;
do $$ begin
  if exists(select 1 from private.media_deletion_outbox where asset_id='12121212-1212-4212-8212-121212121212') then raise exception 'Rolled back deletion retained jobs'; end if;
  if not exists(select 1 from public.assets where id='12121212-1212-4212-8212-121212121212') then raise exception 'Rollback lost asset'; end if;
  if has_table_privilege('authenticated','private.media_deletion_outbox','SELECT') or has_table_privilege('authenticated','private.media_deletion_outbox','INSERT') then raise exception 'Queue exposed to client'; end if;
  if has_function_privilege('authenticated','private.enqueue_media_deletion()','EXECUTE') then raise exception 'Internal trigger exposed'; end if;
end $$;
set local role authenticated;
delete from public.assets where id='12121212-1212-4212-8212-121212121212';
reset role;
do $$ begin
  if exists(select 1 from public.asset_versions where asset_id='12121212-1212-4212-8212-121212121212') then raise exception 'Version cascade failed'; end if;
  if (select count(*) from private.media_deletion_outbox where asset_id='12121212-1212-4212-8212-121212121212')<>2 then raise exception 'Cascade lost queued paths'; end if;
end $$;
-- Simulate successful cleanup: completed names still may not be recycled.
update private.media_deletion_outbox set completed_at=now() where asset_id='12121212-1212-4212-8212-121212121212';
-- Even an accidentally broader permissive policy cannot override the guard.
create policy test_permissive_media_upload on storage.objects for insert to authenticated
with check (bucket_id='project-media');
do $$ begin
  if has_function_privilege('anon','private.media_path_uploadable(text)','EXECUTE') then
    raise exception 'Upload helper exposed to guests';
  end if;
end $$;
set local role authenticated;
do $$ begin
  begin
    insert into public.assets(project_id,kind,name,storage_path,mime_type,size_bytes,created_by)
    values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','image','Reused','projects/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/12121212-1212-4212-8212-121212121212/original.png','image/png',8,'11111111-1111-4111-8111-111111111111');
    raise exception 'Retired original path reused';
  exception when check_violation then null; end;
  begin
    insert into public.asset_versions(asset_id,version_number,storage_path,mime_type,size_bytes,created_by)
    values ('14141414-1414-4414-8414-141414141414',999,'projects/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/13131313-1313-4313-8313-131313131313/version.png','image/png',8,'11111111-1111-4111-8111-111111111111');
    raise exception 'Retired version path reused';
  exception when check_violation then null; end;
end $$;
-- A direct Storage metadata INSERT must also reject completed paths.
do $$ begin
  begin
    insert into storage.objects(bucket_id,name) values ('project-media',
      'projects/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/12121212-1212-4212-8212-121212121212/original.png');
    raise exception 'Storage accepted retired original';
  exception when insufficient_privilege then null; end;
  begin
    insert into storage.objects(bucket_id,name) values ('project-media',
      'projects/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/13131313-1313-4313-8313-131313131313/version.png');
    raise exception 'Storage accepted retired version';
  exception when insufficient_privilege then null; end;
end $$;
insert into storage.objects(bucket_id,name) values ('project-media',
  'projects/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/15151515-1515-4515-8515-151515151515/fresh.png');
rollback;
