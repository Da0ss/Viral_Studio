begin;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111"}',true);
do $$ begin
  begin
    insert into public.project_members(project_id,user_id,role)
    values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','33333333-3333-4333-8333-333333333333','editor');
    raise exception 'Non-organization project participant admitted';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
-- Another organization owner alone is insufficient: project ownership also needs transfer.
update public.organization_members set role='owner' where organization_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and user_id='22222222-2222-4222-8222-222222222222';
do $$ begin
  begin
    delete from public.organization_members where organization_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and user_id='11111111-1111-4111-8111-111111111111';
    raise exception 'Revocation stranded projects';
  exception when check_violation then null; end;
  if not exists(select 1 from public.organization_members where organization_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and user_id='11111111-1111-4111-8111-111111111111') then raise exception 'Failed revocation lost org membership'; end if;
  if (select count(*) from public.project_members where user_id='11111111-1111-4111-8111-111111111111')<>2 then raise exception 'Failed revocation partially removed projects'; end if;
end $$;
update public.project_members set role='owner' where user_id='22222222-2222-4222-8222-222222222222';
delete from public.organization_members where organization_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and user_id='11111111-1111-4111-8111-111111111111';
do $$ begin
  if exists(select 1 from public.project_members where user_id='11111111-1111-4111-8111-111111111111') then raise exception 'Revocation retained project roles'; end if;
end $$;
insert into public.organization_members(organization_id,user_id,role)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','member');
do $$ begin
  if exists(select 1 from public.project_members where user_id='11111111-1111-4111-8111-111111111111') then raise exception 'Rejoin restored stale project roles'; end if;
end $$;
rollback;
