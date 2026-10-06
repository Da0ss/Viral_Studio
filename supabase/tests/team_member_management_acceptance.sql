begin;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111"}',true);

do $$ declare member_count integer; member_row record; affected integer; begin
  select count(*) into member_count from public.list_project_team_members('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
  if member_count <> 2 then raise exception 'Project owner cannot load the project roster'; end if;
  select * into member_row from public.list_project_team_members('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')
    where user_id='22222222-2222-4222-8222-222222222222';
  if member_row.email <> 'viewer@example.invalid' or member_row.role <> 'commenter' then
    raise exception 'Project roster returned incorrect member data';
  end if;

  update public.organization_members set role='admin'
  where organization_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and user_id='22222222-2222-4222-8222-222222222222';
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'Organization owner could not promote a member'; end if;
  update public.organization_members set role='member'
  where organization_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and user_id='22222222-2222-4222-8222-222222222222';
  update public.project_members set role='editor'
  where project_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' and user_id='22222222-2222-4222-8222-222222222222';
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'Project owner could not change a project role'; end if;
  update public.project_members set role='commenter'
  where project_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' and user_id='22222222-2222-4222-8222-222222222222';

  -- A project owner sees the roster only for an owned project and while still
  -- retaining organization membership.
  update public.project_members set role='owner'
  where project_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' and user_id='22222222-2222-4222-8222-222222222222';
  perform set_config('request.jwt.claims','{"sub":"22222222-2222-4222-8222-222222222222"}',true);
  select count(*) into member_count from public.list_project_team_members('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
  if member_count <> 2 then raise exception 'Project owner lost valid roster access'; end if;
  select count(*) into member_count from public.list_project_team_members('cccccccc-cccc-4ccc-8ccc-cccccccccccc');
  if member_count <> 0 then raise exception 'Project owner read another project roster'; end if;
  perform set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111"}',true);
  update public.project_members set role='commenter'
  where project_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' and user_id='22222222-2222-4222-8222-222222222222';

  -- Organization removal revokes all project memberships transactionally.
  delete from public.organization_members
  where organization_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and user_id='22222222-2222-4222-8222-222222222222';
  if exists(select 1 from public.project_members where user_id='22222222-2222-4222-8222-222222222222') then
    raise exception 'Organization removal did not revoke project memberships';
  end if;
  perform set_config('request.jwt.claims','{"sub":"22222222-2222-4222-8222-222222222222"}',true);
  if exists(select 1 from public.list_project_team_members('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')) then
    raise exception 'Revoked organization member retained project roster access';
  end if;
  perform set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111"}',true);
  insert into public.organization_members(organization_id,user_id,role)
  values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','22222222-2222-4222-8222-222222222222','member');
  insert into public.project_members(project_id,user_id,role)
  values('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','22222222-2222-4222-8222-222222222222','commenter');

  begin
    delete from public.organization_members
    where organization_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and user_id='11111111-1111-4111-8111-111111111111';
    raise exception 'Last organization owner removal was allowed';
  exception when check_violation then null; end;
end $$;

-- An organization admin cannot mutate membership rows; RLS returns zero rows.
update public.organization_members set role='admin'
where organization_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and user_id='22222222-2222-4222-8222-222222222222';
select set_config('request.jwt.claims','{"sub":"22222222-2222-4222-8222-222222222222"}',true);
do $$ declare affected integer; member_count integer; begin
  update public.organization_members set role='member'
  where organization_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and user_id='11111111-1111-4111-8111-111111111111';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'Organization admin changed a member role'; end if;
  select count(*) into member_count from public.list_project_team_members('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
  if member_count <> 0 then raise exception 'Non-project-owner read a project roster'; end if;
  update public.project_members set role='editor'
  where project_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' and user_id='22222222-2222-4222-8222-222222222222';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'Non-project-owner changed a project role'; end if;
end $$;

reset role;
-- Transfer first, then prove both owner guards prevent transient ownerlessness.
update public.organization_members set role='owner'
where organization_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and user_id='22222222-2222-4222-8222-222222222222';
update public.organization_members set role='member'
where organization_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and user_id='11111111-1111-4111-8111-111111111111';
update public.project_members set role='owner'
where project_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' and user_id='22222222-2222-4222-8222-222222222222';
update public.project_members set role='commenter'
where project_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' and user_id='11111111-1111-4111-8111-111111111111';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"22222222-2222-4222-8222-222222222222"}',true);
do $$ begin
  begin
    update public.organization_members set role='member'
    where organization_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and user_id='22222222-2222-4222-8222-222222222222';
    raise exception 'Last organization owner demotion was allowed';
  exception when check_violation then null; end;
  begin
    delete from public.project_members
    where project_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' and user_id='22222222-2222-4222-8222-222222222222';
    raise exception 'Last project owner removal was allowed';
  exception when check_violation then null; end;
end $$;
rollback;
