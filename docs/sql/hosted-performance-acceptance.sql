-- Read-only catalog acceptance for the connected database. It returns only
-- aggregate booleans and definitions; it does not read user rows.
do $$ declare t record; begin
  for t in select * from (values
    ('private'::text,'generation_output_reservations'::text,'project_id'::text),
    ('public','team_invitations','invited_by'),
    ('public','team_invitations','project_id')
  ) v(schema_name,table_name,column_name) loop
    if not exists(select 1 from pg_catalog.pg_class table_class
      join pg_catalog.pg_namespace table_namespace on table_namespace.oid=table_class.relnamespace
      join pg_catalog.pg_index index_catalog on index_catalog.indrelid=table_class.oid
      join pg_catalog.pg_class index_class on index_class.oid=index_catalog.indexrelid
      join pg_catalog.pg_am access_method on access_method.oid=index_class.relam
      join pg_catalog.pg_attribute attribute on attribute.attrelid=table_class.oid
        and attribute.attnum=(index_catalog.indkey::smallint[])[0]
      where table_namespace.nspname=t.schema_name and table_class.relname=t.table_name
        and attribute.attname=t.column_name and index_catalog.indisvalid and index_catalog.indisready
        and index_catalog.indpred is null and access_method.amname='btree')
    then raise exception 'Missing full ready B-tree prefix index for %.%(%)',t.schema_name,t.table_name,t.column_name; end if;
  end loop;
end $$;

do $$ declare p record; begin
  if (select count(*) from pg_policies where schemaname='public' and (
    (tablename='organization_members' and policyname='organization_members: owners manage members') or
    (tablename='project_members' and policyname='project_members: project owners manage'))
  ) is distinct from 2::bigint then raise exception 'Expected exactly two owner policies'; end if;
  select * into p from pg_policies where schemaname='public' and tablename='organization_members'
    and policyname='organization_members: owners manage members';
  if not found or p.permissive is distinct from 'PERMISSIVE' or p.cmd is distinct from 'ALL'
    or p.roles is distinct from array['authenticated']::name[]
    or (p.qual like '%is_organization_owner%SELECT auth.uid()%') is distinct from true
    or (p.with_check like '%is_organization_owner%SELECT auth.uid()%') is distinct from true
  then raise exception 'Organization owner policy acceptance failed'; end if;
  select * into p from pg_policies where schemaname='public' and tablename='project_members'
    and policyname='project_members: project owners manage';
  if not found or p.permissive is distinct from 'PERMISSIVE' or p.cmd is distinct from 'ALL'
    or p.roles is distinct from array['authenticated']::name[]
    or (p.qual like '%is_project_owner%SELECT auth.uid()%') is distinct from true
    or (p.with_check like '%is_project_owner%SELECT auth.uid()%') is distinct from true
  then raise exception 'Project owner policy acceptance failed'; end if;
end $$;

explain (costs true, format text)
select 1 from private.generation_output_reservations
where project_id = '00000000-0000-0000-0000-000000000000'::uuid;
explain (costs true, format text)
select 1 from public.team_invitations
where project_id = '00000000-0000-0000-0000-000000000000'::uuid;
explain (costs true, format text)
select 1 from public.team_invitations
where invited_by = '00000000-0000-0000-0000-000000000000'::uuid;
