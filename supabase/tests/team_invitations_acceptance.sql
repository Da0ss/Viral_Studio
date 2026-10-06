-- Invitation links are one-time, email-bound bearer tokens. All writes roll back.
begin;
do $$ begin
  if exists(select 1 from auth.users where email_confirmed_at is null) then
    raise exception 'Invitation acceptance fixtures require verified Auth users';
  end if;
end $$;

insert into public.team_invitations(id, organization_id, project_id, email, organization_role, project_role, token_hash, invited_by, expires_at)
values
  ('12121212-1212-4212-8212-121212121212','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','outsider@example.invalid','member','editor',repeat('a',64),'11111111-1111-4111-8111-111111111111',now()+interval '1 day'),
  ('13131313-1313-4313-8313-131313131313','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','viewer@example.invalid','member','viewer',repeat('b',64),'11111111-1111-4111-8111-111111111111',now()+interval '1 day'),
  ('14141414-1414-4414-8414-141414141414','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',null,'owner@example.invalid','member',null,repeat('c',64),'11111111-1111-4111-8111-111111111111',now()+interval '1 day'),
  ('16161616-1616-4616-8616-161616161616','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',null,'outsider@example.invalid','member',null,repeat('7',64),'11111111-1111-4111-8111-111111111111',now()+interval '1 day');
insert into public.team_invitations(id, organization_id, email, organization_role, token_hash, invited_by, expires_at, created_at)
values ('15151515-1515-4515-8515-151515151515','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','outsider@example.invalid','member',repeat('d',64),'11111111-1111-4111-8111-111111111111',now()-interval '1 day',now()-interval '2 days');

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
do $$ begin
  if (select count(*) from public.list_team_members('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')) <> 2 then
    raise exception 'Organization owner cannot load the team roster';
  end if;
  begin
    insert into public.team_invitations(organization_id,email,organization_role,token_hash,invited_by,expires_at)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','owner-grant@example.invalid','owner',repeat('e',64),auth.uid(),now()+interval '1 day');
    raise exception 'Owner invitation was allowed';
  exception when check_violation then null; end;
  if not public.revoke_team_invitation('15151515-1515-4515-8515-151515151515') then
    raise exception 'Owner could not revoke an expired invitation';
  end if;
  begin
    insert into public.team_invitations(organization_id,email,organization_role,token_hash,invited_by,expires_at)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','too-long@example.invalid','member',repeat('9',64),auth.uid(),now()+interval '8 days');
    raise exception 'Invitation lifetime exceeded seven days';
  exception when check_violation then null; end;
end $$;

-- A regular member cannot inspect another team's roster or issue an invite.
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
do $$ begin
  if exists(select 1 from public.list_team_members('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')) then raise exception 'Member read restricted roster'; end if;
  if exists(select 1 from public.team_invitations where id='12121212-1212-4212-8212-121212121212') then raise exception 'Non-manager read team invitation'; end if;
  begin
    insert into public.team_invitations(organization_id,email,organization_role,token_hash,invited_by,expires_at)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','forged@example.invalid','member',repeat('f',64),auth.uid(),now()+interval '1 day');
    raise exception 'Regular member issued an invitation';
  exception when insufficient_privilege then null; end;
  begin
    perform * from public.accept_team_invitation(repeat('a',64));
    raise exception 'Mismatched email accepted an invitation';
  exception when insufficient_privilege then null; end;
end $$;

-- Managers can inspect invitation state, never bearer hashes. Admins cannot grant admin.
reset role;
update public.organization_members set role='admin'
where organization_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and user_id='22222222-2222-4222-8222-222222222222';
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
do $$ begin
  if not exists(select 1 from public.team_invitations where id='12121212-1212-4212-8212-121212121212') then raise exception 'Organization admin cannot view pending invitations'; end if;
  if has_column_privilege('authenticated','public.team_invitations','token_hash','SELECT') then raise exception 'Invitation bearer hash visible to client'; end if;
  begin
    insert into public.team_invitations(organization_id,email,organization_role,token_hash,invited_by,expires_at)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','forged-admin@example.invalid','admin',repeat('f',64),auth.uid(),now()+interval '1 day');
    raise exception 'Organization admin granted admin role';
  exception when insufficient_privilege then null; end;
  insert into public.team_invitations(organization_id,email,organization_role,token_hash,invited_by,expires_at)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','outsider@example.invalid','member',repeat('8',64),auth.uid(),now()+interval '1 day');
end $$;

reset role;
update public.organization_members set role='member'
where organization_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and user_id='22222222-2222-4222-8222-222222222222';
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
do $$ begin
  insert into public.team_invitations(organization_id,email,organization_role,token_hash,invited_by,expires_at)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','outsider@example.invalid','admin',repeat('e',64),auth.uid(),now()+interval '1 day');
end $$;

-- Verified target accepts exactly once, acquiring organization + scoped project access.
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
do $$ begin
  begin
    perform * from public.accept_team_invitation(repeat('8',64));
    raise exception 'Stale admin invitation remained redeemable';
  exception when insufficient_privilege then null; end;
end $$;
do $$ declare result record; begin
  select * into result from public.accept_team_invitation(repeat('a',64));
  if result.organization_id <> 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid
    or result.project_id <> 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid then
    raise exception 'Accepted invitation returned the wrong scope';
  end if;
  if not exists(select 1 from public.organization_members where organization_id=result.organization_id and user_id=auth.uid() and role='member') then raise exception 'Organization membership missing after acceptance'; end if;
  if not exists(select 1 from public.project_members where project_id=result.project_id and user_id=auth.uid() and role='editor') then raise exception 'Project role missing after acceptance'; end if;
  perform * from public.accept_team_invitation(repeat('e',64));
  if not exists(select 1 from public.organization_members where organization_id=result.organization_id and user_id=auth.uid() and role='admin') then raise exception 'Owner admin invitation did not upgrade organization role'; end if;
  perform * from public.accept_team_invitation(repeat('7',64));
  if not exists(select 1 from public.organization_members where organization_id=result.organization_id and user_id=auth.uid() and role='admin') then raise exception 'Member invitation demoted existing admin'; end if;
  begin
    perform * from public.accept_team_invitation(repeat('a',64));
    raise exception 'Invitation replay succeeded';
  exception when insufficient_privilege then null; end;
  begin
    perform * from public.accept_team_invitation(repeat('d',64));
    raise exception 'Expired invitation succeeded';
  exception when insufficient_privilege then null; end;
end $$;

-- A viewer invitation cannot demote the member's existing commenter role.
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
do $$ declare result record; begin
  select * into result from public.accept_team_invitation(repeat('b',64));
  if not exists(select 1 from public.project_members where project_id=result.project_id and user_id=auth.uid() and role='commenter') then raise exception 'Invitation demoted an existing project role'; end if;
end $$;

-- Owner's existing organization role survives a weaker rejoin token.
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
do $$ begin
  perform * from public.accept_team_invitation(repeat('c',64));
  if not exists(select 1 from public.organization_members where organization_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and user_id=auth.uid() and role='owner') then raise exception 'Invitation demoted organization owner'; end if;
end $$;

reset role;
do $$ begin
  if has_function_privilege('anon','public.accept_team_invitation(text)','EXECUTE')
    or has_function_privilege('anon','private.accept_team_invitation(text)','EXECUTE')
    or has_function_privilege('anon','private.list_team_members(uuid)','EXECUTE') then
    raise exception 'Invitation implementation function exposed';
  end if;
  if has_table_privilege('authenticated','public.team_invitations','SELECT')
    or has_column_privilege('authenticated','public.team_invitations','token_hash','SELECT')
    or has_table_privilege('authenticated','public.team_invitations','UPDATE')
    or has_table_privilege('authenticated','public.team_invitations','DELETE') then
    raise exception 'Clients can rewrite or delete invitations directly';
  end if;
end $$;
rollback;
