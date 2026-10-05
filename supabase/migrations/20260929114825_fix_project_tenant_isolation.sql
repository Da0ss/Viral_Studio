-- Qualify the outer row: unqualified organization_id resolves to the
-- membership table inside EXISTS and does not enforce tenant isolation.
drop policy "projects: organization members read" on public.projects;
create policy "projects: organization members read" on public.projects
for select to authenticated using (exists (
  select 1 from public.organization_members m
  where m.organization_id = projects.organization_id
    and m.user_id = (select auth.uid())
));

drop policy "projects: organization owners and admins create" on public.projects;
create policy "projects: organization owners and admins create" on public.projects
for insert to authenticated with check (
  created_by = (select auth.uid()) and exists (
    select 1 from public.organization_members m
    where m.organization_id = projects.organization_id
      and m.user_id = (select auth.uid()) and m.role in ('owner', 'admin')
  )
);
