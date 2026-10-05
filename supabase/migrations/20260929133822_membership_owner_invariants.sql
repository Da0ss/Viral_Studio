-- Internal trigger only; the original membership operation remains RLS-gated.
create function private.guard_membership_owner() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op='UPDATE' then
    if new.user_id<>old.user_id
      or (tg_table_name='organization_members' and to_jsonb(new)->>'organization_id'<>to_jsonb(old)->>'organization_id')
      or (tg_table_name='project_members' and to_jsonb(new)->>'project_id'<>to_jsonb(old)->>'project_id') then
      raise exception 'Membership identity is immutable' using errcode='23514';
    end if;
    if new.role::text='owner' then return new; end if;
  end if;
  if old.role::text<>'owner' then
    if tg_op='DELETE' then return old; else return new; end if;
  end if;

  -- Write the parent row, not just a lock: concurrent Repeatable Read writers
  -- must serialize/fail rather than both inspecting an obsolete owner snapshot.
  -- Parent updated_at also reflects a successful owner removal/demotion.
  if tg_table_name='organization_members' then
    update public.organizations set updated_at=updated_at where id=old.organization_id;
    if not found then return old; end if; -- Parent DELETE cascade.
    if not exists(select 1 from public.organization_members m
      where m.organization_id=old.organization_id and m.role='owner' and m.user_id<>old.user_id) then
      raise exception 'Assign another owner first' using errcode='23514';
    end if;
  elsif tg_table_name='project_members' then
    update public.projects set updated_at=updated_at where id=old.project_id;
    if not found then return old; end if;
    if not exists(select 1 from public.project_members m
      where m.project_id=old.project_id and m.role='owner' and m.user_id<>old.user_id) then
      raise exception 'Assign another owner first' using errcode='23514';
    end if;
  else raise exception 'Invalid membership trigger';
  end if;
  if tg_op='DELETE' then return old; else return new; end if;
end $$;
revoke all on function private.guard_membership_owner() from public, anon, authenticated;
create trigger organization_members_guard_owner before update or delete on public.organization_members
for each row execute function private.guard_membership_owner();
create trigger project_members_guard_owner before update or delete on public.project_members
for each row execute function private.guard_membership_owner();
