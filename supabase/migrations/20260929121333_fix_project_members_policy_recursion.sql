-- Reading project_members previously selected projects through its RLS, while
-- project UPDATE/DELETE policies selected project_members, causing rewrite
-- recursion (42P17). This narrow internal predicate preserves the same tenant
-- membership rule without recursively evaluating either table's policies.
create function private.can_read_project_members(target_project_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.projects p
    join public.organization_members m on m.organization_id = p.organization_id
    where p.id = target_project_id and m.user_id = (select auth.uid())
  );
$$;
revoke all on function private.can_read_project_members(uuid) from public, anon;
grant execute on function private.can_read_project_members(uuid) to authenticated;

drop policy "project_members: organization members read" on public.project_members;
create policy "project_members: organization members read" on public.project_members
for select to authenticated
using ((select private.can_read_project_members(project_id)));
