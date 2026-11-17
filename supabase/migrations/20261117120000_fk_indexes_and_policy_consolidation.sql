-- Cover the remaining unindexed foreign keys and collapse the multiple
-- permissive SELECT policies on the membership tables into one per table.
set local lock_timeout = '5s';

-- Fail closed if the reviewed policy baseline (metadata and predicates) has drifted.
do $$
declare t record; p record; q text; w text;
begin
  for t in select * from (values
    ('organization_members'::text,'organization_members: owners manage members'::text,'ALL'::text,
      'private.is_organization_owner(organization_id,(SELECTauth.uid()ASuid))'::text,
      'private.is_organization_owner(organization_id,(SELECTauth.uid()ASuid))'::text),
    ('organization_members','organization_members: read own membership','SELECT',
      '(user_id=(SELECTauth.uid()ASuid))',null),
    ('organization_members','organization_members: team managers read roster','SELECT',
      '(SELECTprivate.can_manage_organization_team(organization_members.organization_id)AScan_manage_organization_team)',null),
    ('project_members','project_members: organization members read','SELECT',
      '(SELECTprivate.can_read_project_members(project_members.project_id)AScan_read_project_members)',null),
    ('project_members','project_members: project owners manage','ALL',
      'private.is_project_owner(project_id,(SELECTauth.uid()ASuid))',
      'private.is_project_owner(project_id,(SELECTauth.uid()ASuid))')
  ) v(table_name,policy_name,expected_cmd,expected_qual,expected_check) loop
    select * into strict p from pg_catalog.pg_policies
      where schemaname='public' and tablename=t.table_name and policyname=t.policy_name;
    if p.permissive is distinct from 'PERMISSIVE' or p.cmd is distinct from t.expected_cmd
      or p.roles is distinct from array['authenticated']::name[]
    then raise exception 'Unexpected policy metadata for %.%',t.table_name,t.policy_name; end if;
    q:=pg_catalog.regexp_replace(p.qual,'[[:space:]]+','','g');
    w:=pg_catalog.regexp_replace(p.with_check,'[[:space:]]+','','g');
    if q is distinct from t.expected_qual or w is distinct from t.expected_check
    then raise exception 'Unexpected policy expression for %.%',t.table_name,t.policy_name; end if;
  end loop;
  if (select count(*) from pg_catalog.pg_policies where schemaname='public'
        and tablename='organization_members') is distinct from 3::bigint
    or (select count(*) from pg_catalog.pg_policies where schemaname='public'
        and tablename='project_members') is distinct from 2::bigint
  then raise exception 'Unexpected additional policies on membership tables'; end if;
end $$;

-- Foreign-key covering indexes.
create index if not exists asset_versions_created_by_idx on public.asset_versions (created_by);
create index if not exists assets_created_by_idx on public.assets (created_by);
create index if not exists audit_log_actor_id_idx on public.audit_log (actor_id);
create index if not exists messages_parent_message_id_idx on public.messages (parent_message_id);
create index if not exists messages_sender_id_idx on public.messages (sender_id);
create index if not exists notifications_project_id_idx on public.notifications (project_id);
create index if not exists organizations_created_by_idx on public.organizations (created_by);
create index if not exists projects_created_by_idx on public.projects (created_by);

-- organization_members: SELECT = own row OR team manager OR owner (the owner
-- FOR ALL policy previously contributed to SELECT through its USING clause).
drop policy "organization_members: owners manage members" on public.organization_members;
drop policy "organization_members: read own membership" on public.organization_members;
drop policy "organization_members: team managers read roster" on public.organization_members;

create policy "organization_members: read" on public.organization_members
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or (select private.can_manage_organization_team(organization_members.organization_id))
    or private.is_organization_owner(organization_id,(select auth.uid())) -- redundant with team manager (kept for strict equivalence)
  );
create policy "organization_members: owners insert" on public.organization_members
  for insert to authenticated
  with check (private.is_organization_owner(organization_id,(select auth.uid())));
create policy "organization_members: owners update" on public.organization_members
  for update to authenticated
  using (private.is_organization_owner(organization_id,(select auth.uid())))
  with check (private.is_organization_owner(organization_id,(select auth.uid())));
create policy "organization_members: owners delete" on public.organization_members
  for delete to authenticated
  using (private.is_organization_owner(organization_id,(select auth.uid())));

-- project_members: SELECT = organization-member read OR project owner.
drop policy "project_members: organization members read" on public.project_members;
drop policy "project_members: project owners manage" on public.project_members;

create policy "project_members: read" on public.project_members
  for select to authenticated
  using (
    (select private.can_read_project_members(project_members.project_id))
    or private.is_project_owner(project_id,(select auth.uid()))
  );
create policy "project_members: owners insert" on public.project_members
  for insert to authenticated
  with check (private.is_project_owner(project_id,(select auth.uid())));
create policy "project_members: owners update" on public.project_members
  for update to authenticated
  using (private.is_project_owner(project_id,(select auth.uid())))
  with check (private.is_project_owner(project_id,(select auth.uid())));
create policy "project_members: owners delete" on public.project_members
  for delete to authenticated
  using (private.is_project_owner(project_id,(select auth.uid())));
