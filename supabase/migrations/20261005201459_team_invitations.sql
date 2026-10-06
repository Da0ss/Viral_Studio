create table public.team_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  email text not null check (email = lower(btrim(email)) and email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  organization_role public.organization_role not null default 'member' check (organization_role <> 'owner'),
  project_role public.project_role check (project_role is null or project_role <> 'owner'),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  invited_by uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint team_invitation_lifetime check (expires_at > created_at and expires_at <= created_at + interval '7 days'),
  constraint team_invitation_terminal_state check (accepted_at is null or revoked_at is null),
  constraint team_invitation_scope_roles check (
    (project_id is null and project_role is null)
    or (project_id is not null and project_role is not null and organization_role = 'member')
  )
);

create index team_invitations_pending_org_idx
  on public.team_invitations (organization_id, created_at desc)
  where accepted_at is null and revoked_at is null;

alter table public.team_invitations enable row level security;
revoke all on public.team_invitations from public, anon, authenticated;
revoke select on public.team_invitations from authenticated;
grant select (id, organization_id, project_id, email, organization_role, project_role, invited_by, expires_at, accepted_at, revoked_at, created_at)
  on public.team_invitations to authenticated;
grant insert (organization_id, project_id, email, organization_role, project_role, token_hash, invited_by, expires_at)
  on public.team_invitations to authenticated;

create function private.can_manage_organization_team(target_organization_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = target_organization_id
      and m.user_id = (select auth.uid())
      and m.role in ('owner', 'admin')
  );
$$;
revoke all on function private.can_manage_organization_team(uuid) from public, anon;
grant execute on function private.can_manage_organization_team(uuid) to authenticated;

create policy "organization_members: team managers read roster" on public.organization_members
  for select to authenticated
  using ((select private.can_manage_organization_team(organization_id)));

create policy "team invitations: managers read" on public.team_invitations
  for select to authenticated
  using ((select private.can_manage_organization_team(organization_id)));

create policy "team invitations: managers create limited roles" on public.team_invitations
  for insert to authenticated
  with check (
    invited_by = (select auth.uid())
    and (select private.can_manage_organization_team(organization_id))
    and (organization_role <> 'admin' or (select private.is_organization_owner(organization_id, (select auth.uid()))))
    and (
      project_id is null
      or exists (
        select 1 from public.projects p
        where p.id = public.team_invitations.project_id
          and p.organization_id = public.team_invitations.organization_id
      )
    )
  );

create function private.accept_team_invitation(target_token_hash text)
returns table (organization_id uuid, project_id uuid)
language plpgsql security definer set search_path = '' as $$
declare
  invitation public.team_invitations%rowtype;
  verified_email text;
begin
  if auth.uid() is null or target_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invitation unavailable' using errcode = '42501';
  end if;

  select lower(u.email) into verified_email
  from auth.users u
  where u.id = (select auth.uid()) and u.email_confirmed_at is not null;
  if verified_email is null then
    raise exception 'A verified email is required' using errcode = '42501';
  end if;

  select i.* into invitation
  from public.team_invitations i
  where i.token_hash = target_token_hash
    and i.email = verified_email
    and i.accepted_at is null
    and i.revoked_at is null
    and i.expires_at > now()
  for update;
  if not found then
    raise exception 'Invitation unavailable or expired' using errcode = '42501';
  end if;

  -- Re-check the inviter at redemption time. A stale link stops working if
  -- its owner/admin loses organization access before the recipient accepts.
  perform 1 from public.organization_members m
  where m.organization_id = invitation.organization_id
    and m.user_id = invitation.invited_by
    and m.role in ('owner', 'admin')
  for share;
  if not found then
    raise exception 'Invitation issuer no longer has team access' using errcode = '42501';
  end if;
  if invitation.organization_role = 'admin' then
    perform 1 from public.organization_members m
    where m.organization_id = invitation.organization_id
      and m.user_id = invitation.invited_by
      and m.role = 'owner'
    for share;
    if not found then
      raise exception 'Invitation issuer can no longer grant admin access' using errcode = '42501';
    end if;
  end if;

  insert into public.organization_members (organization_id, user_id, role)
  values (invitation.organization_id, (select auth.uid()), invitation.organization_role)
  on conflict on constraint organization_members_pkey do update
    set role = case
      when public.organization_members.role = 'owner' then 'owner'::public.organization_role
      when public.organization_members.role = 'admin' then 'admin'::public.organization_role
      else excluded.role
    end;

  if invitation.project_id is not null then
    insert into public.project_members (project_id, user_id, role)
    values (invitation.project_id, (select auth.uid()), invitation.project_role)
    on conflict on constraint project_members_pkey do update
      set role = case
        when public.project_members.role = 'owner' then 'owner'::public.project_role
        when public.project_members.role = 'editor' then 'editor'::public.project_role
        when public.project_members.role = 'commenter' and excluded.role = 'viewer' then 'commenter'::public.project_role
        else excluded.role
      end;
  end if;

  update public.team_invitations set accepted_at = now() where id = invitation.id;
  return query select invitation.organization_id, invitation.project_id;
end;
$$;
revoke all on function private.accept_team_invitation(text) from public, anon;
grant execute on function private.accept_team_invitation(text) to authenticated;

create function public.accept_team_invitation(target_token_hash text)
returns table (organization_id uuid, project_id uuid)
language sql security invoker set search_path = '' as $$
  select * from private.accept_team_invitation(target_token_hash);
$$;
revoke all on function public.accept_team_invitation(text) from public, anon;
grant execute on function public.accept_team_invitation(text) to authenticated;

create function private.revoke_team_invitation(target_invitation_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare invitation_organization_id uuid;
begin
  select i.organization_id into invitation_organization_id
  from public.team_invitations i where i.id = target_invitation_id;
  if invitation_organization_id is null
    or not (select private.can_manage_organization_team(invitation_organization_id)) then
    return false;
  end if;
  update public.team_invitations i set revoked_at = now()
  where i.id = target_invitation_id and i.accepted_at is null and i.revoked_at is null;
  return found;
end;
$$;
revoke all on function private.revoke_team_invitation(uuid) from public, anon;
grant execute on function private.revoke_team_invitation(uuid) to authenticated;

create function public.revoke_team_invitation(target_invitation_id uuid)
returns boolean language sql security invoker set search_path = '' as $$
  select private.revoke_team_invitation(target_invitation_id);
$$;
revoke all on function public.revoke_team_invitation(uuid) from public, anon;
grant execute on function public.revoke_team_invitation(uuid) to authenticated;

create function private.list_team_members(target_organization_id uuid)
returns table (user_id uuid, name text, email text, role public.organization_role, joined_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select m.user_id, p.name, p.email, m.role, m.created_at
  from public.organization_members m
  join public.profiles p on p.id = m.user_id
  where m.organization_id = target_organization_id
    and (select private.can_manage_organization_team(target_organization_id))
  order by case m.role when 'owner' then 0 when 'admin' then 1 else 2 end, lower(p.name), m.user_id;
$$;
revoke all on function private.list_team_members(uuid) from public, anon;
grant execute on function private.list_team_members(uuid) to authenticated;

create function public.list_team_members(target_organization_id uuid)
returns table (user_id uuid, name text, email text, role public.organization_role, joined_at timestamptz)
language sql security invoker set search_path = '' as $$
  select * from private.list_team_members(target_organization_id);
$$;
revoke all on function public.list_team_members(uuid) from public, anon;
grant execute on function public.list_team_members(uuid) to authenticated;
