-- Read-only catalog acceptance for the connected database. It returns only
-- aggregate booleans and definitions; it does not read user rows.
-- Expects the state after migration 20261117120000 (11 FK covering indexes and
-- one consolidated SELECT policy plus owner INSERT/UPDATE/DELETE policies on
-- organization_members and project_members).
do $$ declare t record; begin
  for t in select * from (values
    ('private'::text,'generation_output_reservations'::text,'project_id'::text,'generation_output_reservations_project_id_idx'::text),
    ('public','team_invitations','invited_by','team_invitations_invited_by_idx'),
    ('public','team_invitations','project_id','team_invitations_project_id_idx'),
    ('public','asset_versions','created_by','asset_versions_created_by_idx'),
    ('public','assets','created_by','assets_created_by_idx'),
    ('public','audit_log','actor_id','audit_log_actor_id_idx'),
    ('public','messages','parent_message_id','messages_parent_message_id_idx'),
    ('public','messages','sender_id','messages_sender_id_idx'),
    ('public','notifications','project_id','notifications_project_id_idx'),
    ('public','organizations','created_by','organizations_created_by_idx'),
    ('public','projects','created_by','projects_created_by_idx')
  ) v(schema_name,table_name,column_name,index_name) loop
    if not exists(select 1 from pg_catalog.pg_class table_class
      join pg_catalog.pg_namespace table_namespace on table_namespace.oid=table_class.relnamespace
      join pg_catalog.pg_index index_catalog on index_catalog.indrelid=table_class.oid
      join pg_catalog.pg_class index_class on index_class.oid=index_catalog.indexrelid
      join pg_catalog.pg_am access_method on access_method.oid=index_class.relam
      join pg_catalog.pg_attribute attribute on attribute.attrelid=table_class.oid
        and attribute.attnum=(index_catalog.indkey::smallint[])[0]
      where table_namespace.nspname=t.schema_name and table_class.relname=t.table_name
        and index_class.relname=t.index_name
        and attribute.attname=t.column_name and index_catalog.indisvalid and index_catalog.indisready
        and index_catalog.indpred is null and access_method.amname='btree')
    then raise exception 'Missing full ready B-tree index % on %.%(%)',t.index_name,t.schema_name,t.table_name,t.column_name; end if;
  end loop;
end $$;

-- Consolidated membership policies: exactly these 8 permissive,
-- authenticated-only policies, with whitespace-stripped predicates compared
-- exactly (same method as migration 20261117120000).
do $$ declare t record; pol record; begin
  if (select count(*) from pg_catalog.pg_policies where schemaname='public'
        and tablename in ('organization_members','project_members')) is distinct from 8::bigint
  then raise exception 'Expected exactly 8 policies on the membership tables'; end if;
  for t in select * from (values
    ('organization_members'::text,'organization_members: read'::text,'SELECT'::text,
      '((user_id=(SELECTauth.uid()ASuid))OR(SELECTprivate.can_manage_organization_team(organization_members.organization_id)AScan_manage_organization_team)ORprivate.is_organization_owner(organization_id,(SELECTauth.uid()ASuid)))'::text,
      null::text),
    ('organization_members','organization_members: owners insert','INSERT',null,
      'private.is_organization_owner(organization_id,(SELECTauth.uid()ASuid))'),
    ('organization_members','organization_members: owners update','UPDATE',
      'private.is_organization_owner(organization_id,(SELECTauth.uid()ASuid))',
      'private.is_organization_owner(organization_id,(SELECTauth.uid()ASuid))'),
    ('organization_members','organization_members: owners delete','DELETE',
      'private.is_organization_owner(organization_id,(SELECTauth.uid()ASuid))',null),
    ('project_members','project_members: read','SELECT',
      '((SELECTprivate.can_read_project_members(project_members.project_id)AScan_read_project_members)ORprivate.is_project_owner(project_id,(SELECTauth.uid()ASuid)))',
      null),
    ('project_members','project_members: owners insert','INSERT',null,
      'private.is_project_owner(project_id,(SELECTauth.uid()ASuid))'),
    ('project_members','project_members: owners update','UPDATE',
      'private.is_project_owner(project_id,(SELECTauth.uid()ASuid))',
      'private.is_project_owner(project_id,(SELECTauth.uid()ASuid))'),
    ('project_members','project_members: owners delete','DELETE',
      'private.is_project_owner(project_id,(SELECTauth.uid()ASuid))',null)
  ) v(table_name,policy_name,expected_cmd,expected_qual,expected_check) loop
    select * into pol from pg_catalog.pg_policies
      where schemaname='public' and tablename=t.table_name and policyname=t.policy_name;
    if not found or pol.permissive is distinct from 'PERMISSIVE'
      or pol.cmd is distinct from t.expected_cmd
      or pol.roles is distinct from array['authenticated']::name[]
    then raise exception 'Unexpected policy metadata for %.%',t.table_name,t.policy_name; end if;
    if pg_catalog.regexp_replace(pol.qual,'[[:space:]]+','','g') is distinct from t.expected_qual
      or pg_catalog.regexp_replace(pol.with_check,'[[:space:]]+','','g') is distinct from t.expected_check
    then raise exception 'Unexpected policy expression for %.%',t.table_name,t.policy_name; end if;
  end loop;
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
