begin;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111"}',true);
do $$ declare statement text; begin
  foreach statement in array array[
    'delete from public.organization_members where organization_id=''aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'' and user_id=''11111111-1111-4111-8111-111111111111''',
    'update public.organization_members set role=''member'' where organization_id=''aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'' and user_id=''11111111-1111-4111-8111-111111111111''',
    'delete from public.project_members where project_id=''bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'' and user_id=''11111111-1111-4111-8111-111111111111''',
    'update public.project_members set role=''editor'' where project_id=''bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'' and user_id=''11111111-1111-4111-8111-111111111111''',
    'update public.project_members set project_id=''cccccccc-cccc-4ccc-8ccc-cccccccccccc'' where project_id=''bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'' and user_id=''22222222-2222-4222-8222-222222222222'''
  ] loop
    begin execute statement; raise exception 'Owner/identity invariant bypassed';
    exception when check_violation then null; end;
  end loop;
  if has_function_privilege('authenticated','private.guard_membership_owner()','EXECUTE') then raise exception 'Internal trigger exposed'; end if;
end $$;
reset role;
update public.organization_members set role='owner' where organization_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and user_id='22222222-2222-4222-8222-222222222222';
update public.project_members set role='owner' where project_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' and user_id='22222222-2222-4222-8222-222222222222';
update public.organization_members set role='member' where organization_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and user_id='11111111-1111-4111-8111-111111111111';
delete from public.project_members where project_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' and user_id='11111111-1111-4111-8111-111111111111';
do $$ begin
  if (select count(*) from public.organization_members where organization_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and role='owner')<>1
    or (select count(*) from public.project_members where project_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' and role='owner')<>1 then
    raise exception 'Owner transfer failed';
  end if;
end $$;
-- Parent removal is allowed; child invariants must not block FK cascades.
delete from public.projects where id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
delete from public.organizations where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
do $$ begin
  if exists(select 1 from public.organization_members where organization_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') then raise exception 'Organization cascade blocked'; end if;
end $$;
rollback;
