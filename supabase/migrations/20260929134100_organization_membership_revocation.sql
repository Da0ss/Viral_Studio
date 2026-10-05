-- Admission holds the target organization membership against concurrent DELETE.
create function private.require_project_organization_member() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.organization_members m
  join public.projects p on p.organization_id=m.organization_id
  where p.id=new.project_id and m.user_id=new.user_id for key share of m;
  if not found then raise exception 'Membership unavailable' using errcode='42501'; end if;
  return new;
end $$;
revoke all on function private.require_project_organization_member() from public, anon, authenticated;
create trigger project_members_require_organization before insert or update on public.project_members
for each row execute function private.require_project_organization_member();

create function private.revoke_organization_project_memberships() returns trigger
language plpgsql security definer set search_path = '' as $$
declare membership record;
begin
  -- Deleting the entire organization cascades projects independently.
  if not exists(select 1 from public.organizations o where o.id=old.organization_id) then return old; end if;
  -- Deterministic project order; each DELETE invokes the last-project-owner guard.
  for membership in select m.project_id,m.user_id from public.project_members m
    join public.projects p on p.id=m.project_id
    where p.organization_id=old.organization_id and m.user_id=old.user_id
    order by m.project_id for update of m
  loop
    delete from public.project_members where project_id=membership.project_id and user_id=membership.user_id;
  end loop;
  return old;
end $$;
revoke all on function private.revoke_organization_project_memberships() from public, anon, authenticated;
-- Alphabetical ordering runs the organization last-owner guard first.
create trigger organization_members_z_revoke_projects before delete on public.organization_members
for each row execute function private.revoke_organization_project_memberships();
