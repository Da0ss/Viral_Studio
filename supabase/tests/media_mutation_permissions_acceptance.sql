begin;

-- Trusted fixture writes use the migration/test owner, not an authenticated
-- client. The seeded project belongs to the owner identity below.
insert into public.assets(id,project_id,kind,name,storage_path,mime_type,size_bytes,created_by)
values ('a8100000-0000-4000-8000-000000000001','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'image','Mutation permission fixture',
  'projects/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/a8100000-0000-4000-8000-000000000001/original.png',
  'image/png',16,'11111111-1111-4111-8111-111111111111');
insert into public.asset_versions(id,asset_id,version_number,storage_path,mime_type,size_bytes,created_by)
values ('a8100000-0000-4000-8000-000000000002','a8100000-0000-4000-8000-000000000001',1,
  'projects/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/a8100000-0000-4000-8000-000000000001/v1.png',
  'image/png',16,'11111111-1111-4111-8111-111111111111');

do $$
declare
  relation_name text;
  role_name text;
  column_name text;
begin
  foreach relation_name in array array['assets', 'asset_versions'] loop
    foreach role_name in array array['anon', 'authenticated'] loop
      if has_table_privilege(role_name, format('public.%I', relation_name), 'INSERT')
        or has_table_privilege(role_name, format('public.%I', relation_name), 'UPDATE') then
        raise exception 'Client table mutation privilege remains on public.%', relation_name;
      end if;

      for column_name in
        select a.attname
        from pg_catalog.pg_attribute a
        where a.attrelid = format('public.%I', relation_name)::regclass
          and a.attnum > 0 and not a.attisdropped
      loop
        if has_column_privilege(role_name, format('public.%I', relation_name), column_name, 'INSERT')
          or has_column_privilege(role_name, format('public.%I', relation_name), column_name, 'UPDATE') then
          raise exception 'Client column mutation privilege remains on public.%.%', relation_name, column_name;
        end if;
      end loop;
    end loop;
  end loop;

  if not has_table_privilege('authenticated','public.assets','SELECT')
    or not has_table_privilege('authenticated','public.asset_versions','SELECT')
    or not has_table_privilege('authenticated','public.assets','DELETE') then
    raise exception 'Media reads or parent-asset deletion were revoked';
  end if;
  if has_table_privilege('anon','public.asset_versions','DELETE')
    or has_table_privilege('authenticated','public.asset_versions','DELETE') then
    raise exception 'Direct asset-version deletion remains available to clients';
  end if;
  if not has_table_privilege('service_role','public.assets','INSERT')
    or not has_table_privilege('service_role','public.asset_versions','INSERT') then
    raise exception 'Trusted upload finalizer cannot insert media metadata';
  end if;
end $$;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111"}',true);

do $$
begin
  if not exists (select 1 from public.assets where id='a8100000-0000-4000-8000-000000000001')
    or not exists (select 1 from public.asset_versions where id='a8100000-0000-4000-8000-000000000002') then
    raise exception 'Project participant lost media reads';
  end if;

  begin
    insert into public.assets(project_id,kind,name,storage_path,mime_type,size_bytes,created_by)
    values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','image','Forged asset',
      'projects/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/forged.png','image/png',1,auth.uid());
    raise exception 'Authenticated client inserted asset metadata';
  exception when insufficient_privilege then null; end;

  begin
    update public.assets set storage_path='projects/forged/original.png'
    where id='a8100000-0000-4000-8000-000000000001';
    raise exception 'Authenticated client updated asset metadata';
  exception when insufficient_privilege then null; end;

  begin
    insert into public.asset_versions(asset_id,version_number,storage_path,mime_type,size_bytes,created_by)
    values ('a8100000-0000-4000-8000-000000000001',2,
      'projects/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/a8100000-0000-4000-8000-000000000001/v2.png',
      'image/png',1,auth.uid());
    raise exception 'Authenticated client inserted asset version metadata';
  exception when insufficient_privilege then null; end;

  begin
    update public.asset_versions set size_bytes=2
    where id='a8100000-0000-4000-8000-000000000002';
    raise exception 'Authenticated client updated asset version metadata';
  exception when insufficient_privilege then null; end;

  begin
    delete from public.asset_versions where id='a8100000-0000-4000-8000-000000000002';
    raise exception 'Authenticated client directly deleted an asset version';
  exception when insufficient_privilege then null; end;
end $$;

-- Parent deletion remains available, and its cascade queues both original and
-- version paths for cleanup in the same transaction.
delete from public.assets where id='a8100000-0000-4000-8000-000000000001';
reset role;
do $$ begin
  if exists (select 1 from public.asset_versions where id='a8100000-0000-4000-8000-000000000002') then
    raise exception 'Parent asset deletion did not cascade to its version';
  end if;
  if (select count(*) from private.media_deletion_outbox where asset_id='a8100000-0000-4000-8000-000000000001') <> 2 then
    raise exception 'Parent asset deletion did not queue every media path';
  end if;
end $$;
rollback;
