-- Project owners need one narrowly-scoped profile lookup for managing project
-- membership. Direct membership changes continue to use authenticated DML/RLS.
create function private.list_project_team_members(target_project_id uuid)
returns table (user_id uuid, name text, email text, role public.project_role, joined_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select m.user_id, p.name, p.email, m.role, m.created_at
  from public.project_members m
  join public.profiles p on p.id = m.user_id
  where m.project_id = target_project_id
    and exists (
      select 1 from public.project_members caller
      join public.projects parent_project on parent_project.id = caller.project_id
      join public.organization_members organization_member
        on organization_member.organization_id = parent_project.organization_id
       and organization_member.user_id = caller.user_id
      where caller.project_id = target_project_id
        and caller.user_id = (select auth.uid())
        and caller.role = 'owner'
    )
  order by case m.role when 'owner' then 0 when 'editor' then 1 when 'commenter' then 2 else 3 end, lower(p.name), m.user_id;
$$;
revoke all on function private.list_project_team_members(uuid) from public, anon;
grant execute on function private.list_project_team_members(uuid) to authenticated;

create function public.list_project_team_members(target_project_id uuid)
returns table (user_id uuid, name text, email text, role public.project_role, joined_at timestamptz)
language sql security invoker set search_path = '' as $$
  select * from private.list_project_team_members(target_project_id);
$$;
revoke all on function public.list_project_team_members(uuid) from public, anon;
grant execute on function public.list_project_team_members(uuid) to authenticated;
