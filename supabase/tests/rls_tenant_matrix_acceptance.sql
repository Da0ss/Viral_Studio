-- Disposable database only. Run after migrations and seed.sql; every fixture rolls back.
-- This complements focused permission tests by checking the complete exposed-table
-- RLS inventory and representative cross-user / cross-project reads and writes.

begin;

-- Fail closed when a newly added public table is left without RLS or a policy.
do $$
declare
  expected text[] := array[
    'profiles','organizations','organization_members','projects','project_members','team_invitations',
    'assets','asset_versions','messages','notifications','generation_jobs','audit_log'
  ];
  actual text[];
  table_name text;
begin
  select array_agg(c.relname order by c.relname) into actual
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind='r';

  if actual is distinct from (select array_agg(e.table_name order by e.table_name) from unnest(expected) as e(table_name)) then
    raise exception 'Public table inventory changed; extend RLS acceptance: %', actual;
  end if;

  foreach table_name in array expected loop
    if not (select c.relrowsecurity from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname=table_name) then
      raise exception 'RLS is disabled on public.%', table_name;
    end if;
    if not exists(select 1 from pg_catalog.pg_policy p
      join pg_catalog.pg_class c on c.oid=p.polrelid
      join pg_catalog.pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname=table_name) then
      raise exception 'No RLS policy exists on public.%', table_name;
    end if;
  end loop;
end $$;

-- Add private fixture rows to the seeded project. They must be visible only to
-- members of that project / organization, then all changes are rolled back.
insert into public.assets(id,project_id,kind,name,storage_path,mime_type,size_bytes,created_by)
values ('abababab-abab-4bab-8bab-abababababab','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'image','RLS matrix asset','projects/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/abababab-abab-4bab-8bab-abababababab/image.png',
  'image/png',128,'11111111-1111-4111-8111-111111111111');
insert into public.asset_versions(id,asset_id,version_number,storage_path,mime_type,size_bytes,created_by)
values ('acacacac-acac-4cac-8cac-acacacacacac','abababab-abab-4bab-8bab-abababababab',1,
  'projects/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/abababab-abab-4bab-8bab-abababababab/v1.png',
  'image/png',128,'11111111-1111-4111-8111-111111111111');
insert into public.audit_log(id,organization_id,project_id,actor_id,action,entity_type,entity_id)
values ('adadadad-adad-4dad-8dad-adadadadadad','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','11111111-1111-4111-8111-111111111111',
  'asset.created','asset','abababab-abab-4bab-8bab-abababababab');
insert into public.generation_jobs(id,project_id,requested_by,input,client_request_id,reservation_day)
values ('aeaeaeae-aeae-4eae-8eae-aeaeaeaeaeae','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  '11111111-1111-4111-8111-111111111111','{"prompt":"RLS matrix fixture"}',
  'afafafaf-afaf-4faf-8faf-afafafafafaf',(clock_timestamp() at time zone 'UTC')::date);

set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
do $$ begin
  if exists(select 1 from public.profiles where id='11111111-1111-4111-8111-111111111111') then raise exception 'Profile leaked across users'; end if;
  if exists(select 1 from public.organizations where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') then raise exception 'Organization leaked across tenants'; end if;
  if exists(select 1 from public.organization_members where organization_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') then raise exception 'Membership leaked across tenants'; end if;
  if exists(select 1 from public.projects where id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') then raise exception 'Project leaked across tenants'; end if;
  if exists(select 1 from public.project_members where project_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') then raise exception 'Project membership leaked across tenants'; end if;
  if exists(select 1 from public.assets where id='abababab-abab-4bab-8bab-abababababab') then raise exception 'Asset leaked across tenants'; end if;
  if exists(select 1 from public.asset_versions where id='acacacac-acac-4cac-8cac-acacacacacac') then raise exception 'Asset version leaked across tenants'; end if;
  if exists(select 1 from public.messages where project_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') then raise exception 'Messages leaked across tenants'; end if;
  if exists(select 1 from public.notifications where user_id='11111111-1111-4111-8111-111111111111') then raise exception 'Notification leaked across users'; end if;
  if exists(select 1 from public.generation_jobs where id='aeaeaeae-aeae-4eae-8eae-aeaeaeaeaeae') then raise exception 'Generation job leaked across tenants'; end if;
  if exists(select 1 from public.audit_log where id='adadadad-adad-4dad-8dad-adadadadadad') then raise exception 'Audit event leaked across tenants'; end if;
end $$;

-- A project commenter can read project media and discussion, but cannot change
-- project membership, media metadata, or audit history.
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
do $$ declare affected integer; begin
  if not exists(select 1 from public.organizations where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') then raise exception 'Organization member cannot read organization'; end if;
  if not exists(select 1 from public.organization_members where organization_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and user_id=auth.uid()) then raise exception 'Member cannot read own membership'; end if;
  if not exists(select 1 from public.assets where id='abababab-abab-4bab-8bab-abababababab') then raise exception 'Project participant cannot read asset'; end if;
  if not exists(select 1 from public.asset_versions where id='acacacac-acac-4cac-8cac-acacacacacac') then raise exception 'Project participant cannot read asset version'; end if;
  if not exists(select 1 from public.generation_jobs where id='aeaeaeae-aeae-4eae-8eae-aeaeaeaeaeae') then raise exception 'Project participant cannot read generation job'; end if;
  if not exists(select 1 from public.audit_log where id='adadadad-adad-4dad-8dad-adadadadadad') then raise exception 'Organization member cannot read audit event'; end if;

  update public.profiles set name='Other user profile' where id='11111111-1111-4111-8111-111111111111';
  get diagnostics affected=row_count;
  if affected<>0 then raise exception 'User changed another profile'; end if;
  update public.assets set name='Unauthorized change' where id='abababab-abab-4bab-8bab-abababababab';
  get diagnostics affected=row_count;
  if affected<>0 then raise exception 'Commenter changed asset metadata'; end if;
  delete from public.asset_versions where id='acacacac-acac-4cac-8cac-acacacacacac';
  get diagnostics affected=row_count;
  if affected<>0 then raise exception 'Commenter deleted asset version'; end if;
  delete from public.audit_log where id='adadadad-adad-4dad-8dad-adadadadadad';
  get diagnostics affected=row_count;
  if affected<>0 then raise exception 'Client deleted audit history'; end if;

  begin
    insert into public.project_members(project_id,user_id,role)
    values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','33333333-3333-4333-8333-333333333333','owner');
    raise exception 'Commenter granted project membership';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.assets(project_id,kind,name,storage_path,mime_type,size_bytes,created_by)
    values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','image','forged asset',
      'projects/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/forged/image.png','image/png',1,auth.uid());
    raise exception 'Commenter created asset metadata';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.audit_log(organization_id,action,entity_type)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','forged.event','test');
    raise exception 'Client wrote audit history';
  exception when insufficient_privilege then null; end;
end $$;

-- An organization member who is not a project participant must not inherit
-- project-level visibility from organization membership alone.
reset role;
insert into public.organization_members(organization_id,user_id,role)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','33333333-3333-4333-8333-333333333333','member');
set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
do $$ begin
  if not exists(select 1 from public.organizations where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') then raise exception 'Organization member cannot read organization'; end if;
  if exists(select 1 from public.assets where id='abababab-abab-4bab-8bab-abababababab') then raise exception 'Nonparticipant inherited asset access'; end if;
  if exists(select 1 from public.asset_versions where id='acacacac-acac-4cac-8cac-acacacacacac') then raise exception 'Nonparticipant inherited asset version access'; end if;
  if exists(select 1 from public.messages where project_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') then raise exception 'Nonparticipant inherited message access'; end if;
  if exists(select 1 from public.generation_jobs where id='aeaeaeae-aeae-4eae-8eae-aeaeaeaeaeae') then raise exception 'Nonparticipant inherited job access'; end if;
end $$;

rollback;
