do $$
declare
  missing_indexes text[];
  organization_policy record;
  project_policy record;
begin
  select array_agg(expected.name order by expected.name)
  into missing_indexes
  from (values
    ('private'::text, 'generation_output_reservations'::text, 'generation_output_reservations_project_id_idx'::text, 'project_id'::text),
    ('public', 'team_invitations', 'team_invitations_invited_by_idx', 'invited_by'),
    ('public', 'team_invitations', 'team_invitations_project_id_idx', 'project_id')
  ) expected(schema_name, table_name, name, leading_column)
  where not exists (
    select 1
    from pg_catalog.pg_class table_class
    join pg_catalog.pg_namespace table_namespace on table_namespace.oid = table_class.relnamespace
    join pg_catalog.pg_index index_catalog on index_catalog.indrelid = table_class.oid
    join pg_catalog.pg_class index_class on index_class.oid = index_catalog.indexrelid
    join pg_catalog.pg_am access_method on access_method.oid = index_class.relam
    join pg_catalog.pg_attribute attribute
      on attribute.attrelid = table_class.oid
      and attribute.attnum = (index_catalog.indkey::smallint[])[0]
    where table_namespace.nspname = expected.schema_name
      and table_class.relname = expected.table_name
      and attribute.attname = expected.leading_column
      and index_catalog.indisvalid
      and index_catalog.indisready
      and index_catalog.indpred is null
      and access_method.amname = 'btree'
  );
  if missing_indexes is not null then
    raise exception 'Missing or invalid performance indexes: %', missing_indexes;
  end if;

  select * into organization_policy from pg_policies
  where schemaname = 'public' and tablename = 'organization_members'
    and policyname = 'organization_members: owners manage members';
  if not found then raise exception 'Organization owner policy is absent'; end if;
  select * into project_policy from pg_policies
  where schemaname = 'public' and tablename = 'project_members'
    and policyname = 'project_members: project owners manage';
  if not found then raise exception 'Project owner policy is absent'; end if;
  if (select count(*) from pg_policies where schemaname='public' and tablename='organization_members'
      and policyname='organization_members: owners manage members') is distinct from 1::bigint
    or (select count(*) from pg_policies where schemaname='public' and tablename='project_members'
      and policyname='project_members: project owners manage') is distinct from 1::bigint
  then raise exception 'Owner policy count changed unexpectedly'; end if;
  if organization_policy.permissive is distinct from 'PERMISSIVE'
    or organization_policy.cmd is distinct from 'ALL'
    or organization_policy.roles is distinct from array['authenticated']::name[]
    or (organization_policy.qual like '%is_organization_owner%SELECT auth.uid()%') is distinct from true
    or (organization_policy.with_check like '%is_organization_owner%SELECT auth.uid()%') is distinct from true
  then raise exception 'Organization owner policy shape changed unexpectedly'; end if;
  if project_policy.permissive is distinct from 'PERMISSIVE'
    or project_policy.cmd is distinct from 'ALL'
    or project_policy.roles is distinct from array['authenticated']::name[]
    or (project_policy.qual like '%is_project_owner%SELECT auth.uid()%') is distinct from true
    or (project_policy.with_check like '%is_project_owner%SELECT auth.uid()%') is distinct from true
  then raise exception 'Project owner policy shape changed unexpectedly'; end if;
end $$;

begin;

-- Owner remains able to manage both membership tables.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111"}', true);
do $$ declare affected integer; begin
  update public.organization_members set updated_at = updated_at
    where organization_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      and user_id = '22222222-2222-4222-8222-222222222222';
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'Organization owner lost management access'; end if;
  update public.project_members set updated_at = updated_at
    where project_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
      and user_id = '22222222-2222-4222-8222-222222222222';
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'Project owner lost management access'; end if;
end $$;
reset role;

-- Admin/editor are still readable through the independent permissive SELECT
-- policies, but the owner-management policies do not grant write access.
update public.organization_members set role = 'admin'
  where organization_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    and user_id = '22222222-2222-4222-8222-222222222222';
update public.project_members set role = 'editor'
  where project_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    and user_id = '22222222-2222-4222-8222-222222222222';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222"}', true);
do $$ declare affected integer; begin
  if not exists (select 1 from public.organization_members where organization_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
    or not exists (select 1 from public.project_members where project_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')
  then raise exception 'Independent roster read access changed'; end if;
  update public.organization_members set updated_at = updated_at
    where organization_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      and user_id = '11111111-1111-4111-8111-111111111111';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'Organization admin gained owner-policy writes'; end if;
  update public.project_members set updated_at = updated_at
    where project_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
      and user_id = '11111111-1111-4111-8111-111111111111';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'Project editor gained owner-policy writes'; end if;
end $$;
reset role;

-- Viewer and outsider remain unable to manage membership rows.
update public.project_members set role = 'viewer'
  where project_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    and user_id = '22222222-2222-4222-8222-222222222222';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222"}', true);
do $$ declare affected integer; begin
  update public.project_members set updated_at = updated_at
    where project_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
      and user_id = '11111111-1111-4111-8111-111111111111';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'Project viewer gained owner-policy writes'; end if;
end $$;
select set_config('request.jwt.claims', '{"sub":"33333333-3333-4333-8333-333333333333"}', true);
do $$ declare affected integer; begin
  update public.organization_members set updated_at = updated_at
    where organization_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      and user_id = '22222222-2222-4222-8222-222222222222';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'Outsider gained organization-management writes'; end if;
  update public.project_members set updated_at = updated_at
    where project_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
      and user_id = '22222222-2222-4222-8222-222222222222';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'Outsider gained project-management writes'; end if;
end $$;
reset role;

rollback;
