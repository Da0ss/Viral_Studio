-- Read-only policy/catalog inspection plus transaction-local RLS acceptance.
-- Run on the hosted project using a database role that can inspect auth.users,
-- profiles, and membership rows, and can SET ROLE authenticated. This script
-- writes only organization_members/project_members inside this transaction;
-- ROLLBACK removes those changes. It never changes auth.users or profiles.
-- Expects the state AFTER migration 20261117120000 (consolidated SELECT policy
-- plus owner INSERT/UPDATE/DELETE policies; 11 FK covering indexes). It will
-- fail on the pre-migration FOR ALL policy shape by design. The behavioural
-- checks below (owner manages, admin/editor/viewer read-only, outsider no
-- access) are unchanged and hold both before and after.

begin;
set local lock_timeout = '2s';
set local statement_timeout = '30s';

do $$
declare
  selected_organization_id uuid;
  selected_project_id uuid;
  selected_owner_id uuid;
  selected_second_user_id uuid;
  t record;
  pol record;
begin
  -- Select one owner of both an organization and a project in that
  -- organization, plus a distinct confirmed account with a profile and no
  -- membership in either selected scope. Do not return identity data.
  select om.organization_id, p.id, om.user_id
    into selected_organization_id, selected_project_id, selected_owner_id
  from public.organization_members om
  join public.projects p on p.organization_id = om.organization_id
  join public.project_members pm
    on pm.project_id = p.id and pm.user_id = om.user_id
  join auth.users owner_account
    on owner_account.id = om.user_id
   and owner_account.email_confirmed_at is not null
  join public.profiles owner_profile on owner_profile.id = om.user_id
  where om.role = 'owner'::public.organization_role
    and pm.role = 'owner'::public.project_role
  order by om.created_at, p.created_at
  limit 1;

  if selected_owner_id is null then
    raise exception 'Acceptance needs a confirmed profiled user who owns both a hosted organization and a project in it';
  end if;

  select u.id into selected_second_user_id
  from auth.users u
  join public.profiles profile_row on profile_row.id = u.id
  where u.email_confirmed_at is not null
    and u.id <> selected_owner_id
    and not exists (
      select 1 from public.organization_members om
      where om.organization_id = selected_organization_id
        and om.user_id = u.id
    )
    and not exists (
      select 1 from public.project_members pm
      where pm.project_id = selected_project_id
        and pm.user_id = u.id
    )
  order by u.created_at, u.id
  limit 1;

  if selected_second_user_id is null then
    raise exception 'Acceptance needs a second confirmed profiled user with no membership in the selected organization or project';
  end if;

  -- Keep fixture identifiers transaction-local and out of query results.
  perform set_config('performance_acceptance.organization_id', selected_organization_id::text, true);
  perform set_config('performance_acceptance.project_id', selected_project_id::text, true);
  perform set_config('performance_acceptance.owner_id', selected_owner_id::text, true);
  perform set_config('performance_acceptance.second_user_id', selected_second_user_id::text, true);

  -- Consolidated membership policies (migration 20261117120000): exactly one
  -- permissive authenticated-only policy per command, no FOR ALL policy.
  -- Exact (whitespace-stripped) predicate comparison, as in the migration.
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
end
$$;

-- All 11 foreign-key covering indexes (3 earlier + 8 from migration
-- 20261117120000) must exist as full, valid, ready B-tree prefix indexes.
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

-- Create only temporary organization-admin/project-editor fixtures for the
-- already existing second user. These rows are removed by the final rollback.
insert into public.organization_members (organization_id, user_id, role)
values (
  current_setting('performance_acceptance.organization_id')::uuid,
  current_setting('performance_acceptance.second_user_id')::uuid,
  'admin'::public.organization_role
);
insert into public.project_members (project_id, user_id, role)
values (
  current_setting('performance_acceptance.project_id')::uuid,
  current_setting('performance_acceptance.second_user_id')::uuid,
  'editor'::public.project_role
);

-- Owner can update another member in both scopes.
set local role authenticated;
do $$
declare
  affected integer;
  v_owner_id uuid := current_setting('performance_acceptance.owner_id')::uuid;
  v_organization_id uuid := current_setting('performance_acceptance.organization_id')::uuid;
  v_project_id uuid := current_setting('performance_acceptance.project_id')::uuid;
  v_second_user_id uuid := current_setting('performance_acceptance.second_user_id')::uuid;
begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_owner_id)::text, true);
  update public.organization_members set updated_at = updated_at
  where organization_members.organization_id = v_organization_id
    and organization_members.user_id = v_second_user_id;
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'Organization owner lost management access'; end if;

  update public.project_members set updated_at = updated_at
  where project_members.project_id = v_project_id
    and project_members.user_id = v_second_user_id;
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'Project owner lost management access'; end if;
end
$$;

-- Organization admin and project editor can read their rosters but cannot
-- update the owner's membership row through the per-command owner UPDATE policies.
do $$
declare
  affected integer;
  v_owner_id uuid := current_setting('performance_acceptance.owner_id')::uuid;
  v_organization_id uuid := current_setting('performance_acceptance.organization_id')::uuid;
  v_project_id uuid := current_setting('performance_acceptance.project_id')::uuid;
  v_second_user_id uuid := current_setting('performance_acceptance.second_user_id')::uuid;
begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_second_user_id)::text, true);
  if not exists (select 1 from public.organization_members om
    where om.organization_id = v_organization_id and om.user_id = v_owner_id) then
    raise exception 'Organization admin lost independent roster read access';
  end if;
  if not exists (select 1 from public.project_members pm
    where pm.project_id = v_project_id and pm.user_id = v_owner_id) then
    raise exception 'Project editor lost independent roster read access';
  end if;

  update public.organization_members set updated_at = updated_at
  where organization_members.organization_id = v_organization_id
    and organization_members.user_id = v_owner_id;
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'Organization admin gained owner-policy writes'; end if;

  update public.project_members set updated_at = updated_at
  where project_members.project_id = v_project_id
    and project_members.user_id = v_owner_id;
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'Project editor gained owner-policy writes'; end if;
end
$$;

reset role;

-- Change only the temporary second-user project fixture to viewer, then verify
-- the viewer retains roster reads but has no owner-policy write access.
update public.project_members set role = 'viewer'::public.project_role
where project_id = current_setting('performance_acceptance.project_id')::uuid
  and user_id = current_setting('performance_acceptance.second_user_id')::uuid;

set local role authenticated;
do $$
declare
  affected integer;
  v_owner_id uuid := current_setting('performance_acceptance.owner_id')::uuid;
  v_project_id uuid := current_setting('performance_acceptance.project_id')::uuid;
  v_second_user_id uuid := current_setting('performance_acceptance.second_user_id')::uuid;
begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_second_user_id)::text, true);
  if not exists (select 1 from public.project_members pm
    where pm.project_id = v_project_id and pm.user_id = v_owner_id) then
    raise exception 'Project viewer lost independent roster read access';
  end if;
  update public.project_members set updated_at = updated_at
  where project_members.project_id = v_project_id
    and project_members.user_id = v_owner_id;
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'Project viewer gained owner-policy writes'; end if;
end
$$;

reset role;
delete from public.project_members
where project_id = current_setting('performance_acceptance.project_id')::uuid
  and user_id = current_setting('performance_acceptance.second_user_id')::uuid;
delete from public.organization_members
where organization_id = current_setting('performance_acceptance.organization_id')::uuid
  and user_id = current_setting('performance_acceptance.second_user_id')::uuid;

-- The second user has no membership in either scope and cannot read or write.
set local role authenticated;
do $$
declare
  affected integer;
  v_owner_id uuid := current_setting('performance_acceptance.owner_id')::uuid;
  v_organization_id uuid := current_setting('performance_acceptance.organization_id')::uuid;
  v_project_id uuid := current_setting('performance_acceptance.project_id')::uuid;
  v_outsider_id uuid := current_setting('performance_acceptance.second_user_id')::uuid;
begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_outsider_id)::text, true);
  if exists (select 1 from public.organization_members om
    where om.organization_id = v_organization_id) then
    raise exception 'Outsider gained organization roster read access';
  end if;
  if exists (select 1 from public.project_members pm
    where pm.project_id = v_project_id) then
    raise exception 'Outsider gained project roster read access';
  end if;

  update public.organization_members set updated_at = updated_at
  where organization_members.organization_id = v_organization_id
    and organization_members.user_id = v_owner_id;
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'Outsider gained organization-management writes'; end if;
  update public.project_members set updated_at = updated_at
  where project_members.project_id = v_project_id
    and project_members.user_id = v_owner_id;
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'Outsider gained project-management writes'; end if;
end
$$;

rollback;
