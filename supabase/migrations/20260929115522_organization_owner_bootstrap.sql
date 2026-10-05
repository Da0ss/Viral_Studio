-- Membership creation is part of the same transaction as organization creation.
create or replace function private.add_organization_owner()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.organization_members (organization_id, user_id, role)
  values (new.id, new.created_by, 'owner');
  return new;
end;
$$;
revoke all on function private.add_organization_owner() from public, anon, authenticated;
create trigger organizations_add_creator_as_owner
after insert on public.organizations for each row
execute function private.add_organization_owner();
