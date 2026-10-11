-- Read-only policy/catalog inspection plus transaction-local RLS acceptance.
-- Run on the hosted project using a database role that can inspect auth.users,
-- profiles, and membership rows, and can SET ROLE authenticated. This script
-- writes only organization_members/project_members inside this transaction;
-- ROLLBACK removes those changes. It never changes auth.users or profiles.
-- Run once before and once after the performance migration. The policy checks
-- intentionally accept either spelling of auth.uid() while requiring the
-- same policy roles, command, permissive mode, and owner helper calls.

begin;
set local lock_timeout = '2s';
set local statement_timeout = '30s';

do $$
declare
  selected_organization_id uuid;
  selected_project_id uuid;
  selected_owner_id uuid;
  selected_second_user_id uuid;
  owner_policy_count integer;
  project_policy_count integer;
  owner_policy record;
  project_policy record;
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

  select count(*) into owner_policy_count
  from pg_catalog.pg_policies
  where schemaname = 'public' and tablename = 'organization_members'
    and policyname = 'organization_members: owners manage members';
  select count(*) into project_policy_count
  from pg_catalog.pg_policies
  where schemaname = 'public' and tablename = 'project_members'
    and policyname = 'project_members: project owners manage';
  if owner_policy_count <> 1 or project_policy_count <> 1 then
    raise exception 'Expected exactly one owner-management policy on each membership table';
  end if;

  select * into owner_policy from pg_catalog.pg_policies
  where schemaname = 'public' and tablename = 'organization_members'
    and policyname = 'organization_members: owners manage members';
  select * into project_policy from pg_catalog.pg_policies
  where schemaname = 'public' and tablename = 'project_members'
    and policyname = 'project_members: project owners manage';

  if owner_policy.permissive is distinct from 'PERMISSIVE'
    or owner_policy.roles is distinct from array['authenticated']::name[]
    or owner_policy.cmd is distinct from 'ALL'
    or coalesce(owner_policy.qual like '%is_organization_owner%auth.uid()%', false) is not true
    or coalesce(owner_policy.with_check like '%is_organization_owner%auth.uid()%', false) is not true
  then raise exception 'Organization owner policy semantics or raw expression changed'; end if;

  if project_policy.permissive is distinct from 'PERMISSIVE'
    or project_policy.roles is distinct from array['authenticated']::name[]
    or project_policy.cmd is distinct from 'ALL'
    or coalesce(project_policy.qual like '%is_project_owner%auth.uid()%', false) is not true
    or coalesce(project_policy.with_check like '%is_project_owner%auth.uid()%', false) is not true
  then raise exception 'Project owner policy semantics or raw expression changed'; end if;

  raise notice 'Organization owner policy raw qual/check: % / %', owner_policy.qual, owner_policy.with_check;
  raise notice 'Project owner policy raw qual/check: % / %', project_policy.qual, project_policy.with_check;
end
$$;

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
-- update the owner's membership row through the owner-only ALL policies.
do $$
declare
  affected integer;
  v_owner_id uuid := current_setting('performance_acceptance.owner_id')::uuid;
  v_organization_id uuid := current_setting('performance_acceptance.organization_id')::uuid;
  v_project_id uuid := current_setting('performance_acceptance.project_id')::uuid;
  v_second_user_id uuid := current_setting('performance_acceptance.second_user_id')::uuid;
begin
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
