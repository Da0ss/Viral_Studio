do $$
declare missing_indexes text[]; t record; n bigint;
begin
  select array_agg(e.name order by e.name) into missing_indexes
  from (values
    ('asset_versions','asset_versions_created_by_idx','created_by'),
    ('assets','assets_created_by_idx','created_by'),
    ('audit_log','audit_log_actor_id_idx','actor_id'),
    ('messages','messages_parent_message_id_idx','parent_message_id'),
    ('messages','messages_sender_id_idx','sender_id'),
    ('notifications','notifications_project_id_idx','project_id'),
    ('organizations','organizations_created_by_idx','created_by'),
    ('projects','projects_created_by_idx','created_by')
  ) e(table_name,name,leading_column)
  where not exists (
    select 1 from pg_catalog.pg_class tc
    join pg_catalog.pg_namespace tn on tn.oid=tc.relnamespace
    join pg_catalog.pg_index i on i.indrelid=tc.oid
    join pg_catalog.pg_class ic on ic.oid=i.indexrelid
    join pg_catalog.pg_am am on am.oid=ic.relam
    join pg_catalog.pg_attribute a on a.attrelid=tc.oid and a.attnum=(i.indkey::smallint[])[0]
    where tn.nspname='public' and tc.relname=e.table_name and a.attname=e.leading_column
      and i.indisvalid and i.indisready and i.indpred is null and am.amname='btree');
  if missing_indexes is not null then raise exception 'Missing FK indexes: %',missing_indexes; end if;

  for t in select * from (values ('organization_members'::text),('project_members')) v(table_name) loop
    select count(*) into n from pg_catalog.pg_policies
      where schemaname='public' and tablename=t.table_name and cmd in ('SELECT','ALL') and permissive='PERMISSIVE'
        and (roles && array['authenticated','public']::name[]);
    if n <> 1 then raise exception 'Expected exactly one authenticated SELECT-applicable policy on %, found %',t.table_name,n; end if;
    if (select array_agg(cmd order by cmd) from pg_catalog.pg_policies
        where schemaname='public' and tablename=t.table_name and cmd not in ('SELECT','ALL'))
      is distinct from array['DELETE','INSERT','UPDATE']::text[]
    then raise exception 'Write policies on % are not exactly DELETE/INSERT/UPDATE',t.table_name; end if;
    if exists (select 1 from pg_catalog.pg_policies
        where schemaname='public' and tablename=t.table_name and cmd not in ('SELECT','ALL')
          and (roles is distinct from array['authenticated']::name[]
            or coalesce(qual,with_check) not like '%is_'||case t.table_name
              when 'organization_members' then 'organization' else 'project' end||'_owner%'))
    then raise exception 'Write policies on % must be authenticated-only and owner-gated',t.table_name; end if;
  end loop;
end $$;

begin;

-- Owner (1111) reads the full rosters and still manages them.
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111"}',true);
do $$ declare affected integer; begin
  if (select count(*) from public.organization_members where organization_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') < 2
  then raise exception 'Organization owner lost roster read'; end if;
  if (select count(*) from public.project_members where project_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') < 2
  then raise exception 'Project owner lost roster read'; end if;
  update public.organization_members set updated_at=updated_at
    where organization_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and user_id='22222222-2222-4222-8222-222222222222';
  get diagnostics affected=row_count;
  if affected<>1 then raise exception 'Organization owner lost update access'; end if;
  update public.project_members set updated_at=updated_at
    where project_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' and user_id='22222222-2222-4222-8222-222222222222';
  get diagnostics affected=row_count;
  if affected<>1 then raise exception 'Project owner lost update access'; end if;
end $$;
reset role;

-- Plain member (2222): reads only own organization row; cannot write.
update public.organization_members set role='member'
  where organization_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and user_id='22222222-2222-4222-8222-222222222222';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"22222222-2222-4222-8222-222222222222"}',true);
do $$ declare affected integer; begin
  if not exists (select 1 from public.organization_members
      where organization_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and user_id='22222222-2222-4222-8222-222222222222')
  then raise exception 'Member cannot read own membership'; end if;
  if exists (select 1 from public.organization_members
      where organization_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and user_id<>'22222222-2222-4222-8222-222222222222')
  then raise exception 'Plain member can read the organization roster'; end if;
  update public.organization_members set updated_at=updated_at
    where organization_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and user_id='22222222-2222-4222-8222-222222222222';
  get diagnostics affected=row_count;
  if affected<>0 then raise exception 'Plain member gained organization writes'; end if;
end $$;
reset role;

-- Team manager (admin 2222) reads the whole roster but cannot write it.
update public.organization_members set role='admin'
  where organization_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and user_id='22222222-2222-4222-8222-222222222222';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"22222222-2222-4222-8222-222222222222"}',true);
do $$ declare affected integer; begin
  if not exists (select 1 from public.organization_members
      where organization_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and user_id='11111111-1111-4111-8111-111111111111')
  then raise exception 'Team manager cannot read the roster'; end if;
  if not exists (select 1 from public.project_members where project_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')
  then raise exception 'Organization member cannot read project roster'; end if;
  update public.organization_members set updated_at=updated_at
    where organization_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and user_id='11111111-1111-4111-8111-111111111111';
  get diagnostics affected=row_count;
  if affected<>0 then raise exception 'Team manager gained organization writes'; end if;
end $$;
reset role;

-- Owner INSERT and DELETE (of non-owner rows) succeed; project insert requires
-- the target to be an organization member (require_project_organization_member).
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111"}',true);
do $$ declare affected integer; begin
  insert into public.organization_members(organization_id,user_id,role)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','33333333-3333-4333-8333-333333333333','member');
  insert into public.project_members(project_id,user_id,role)
    values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','33333333-3333-4333-8333-333333333333','viewer');
  delete from public.project_members where project_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    and user_id='33333333-3333-4333-8333-333333333333';
  get diagnostics affected=row_count;
  if affected<>1 then raise exception 'Project owner could not delete a non-owner member'; end if;
  delete from public.organization_members where organization_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    and user_id='33333333-3333-4333-8333-333333333333';
  get diagnostics affected=row_count;
  if affected<>1 then raise exception 'Organization owner could not delete a non-owner member'; end if;
end $$;
reset role;

-- Non-owners (admin, then member 2222; outsider 3333) cannot INSERT membership rows.
update public.organization_members set role='admin'
  where organization_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and user_id='22222222-2222-4222-8222-222222222222';
update public.project_members set role='editor'
  where project_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' and user_id='22222222-2222-4222-8222-222222222222';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"22222222-2222-4222-8222-222222222222"}',true);
do $$ begin
  begin
    insert into public.organization_members(organization_id,user_id,role)
      values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','33333333-3333-4333-8333-333333333333','member');
    raise exception 'Organization admin inserted a member';
  exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claims','{"sub":"33333333-3333-4333-8333-333333333333"}',true);
do $$ begin
  begin
    insert into public.organization_members(organization_id,user_id,role)
      values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','33333333-3333-4333-8333-333333333333','owner');
    raise exception 'Outsider self-inserted into the organization';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- Make 3333 an organization member (not a project member), then check that a
-- non-owner organization member and a project editor cannot write project rows.
update public.organization_members set role='member'
  where organization_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and user_id='22222222-2222-4222-8222-222222222222';
insert into public.organization_members(organization_id,user_id,role)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','33333333-3333-4333-8333-333333333333','member');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"22222222-2222-4222-8222-222222222222"}',true);
do $$ declare affected integer; begin
  begin
    insert into public.organization_members(organization_id,user_id,role)
      values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','member');
    raise exception 'Organization member inserted a member';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.project_members(project_id,user_id,role)
      values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','33333333-3333-4333-8333-333333333333','viewer');
    raise exception 'Project editor inserted a member';
  exception when insufficient_privilege then null; end;
  delete from public.project_members where project_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    and user_id='11111111-1111-4111-8111-111111111111';
  get diagnostics affected=row_count;
  if affected<>0 then raise exception 'Project editor deleted a project member'; end if;
end $$;
select set_config('request.jwt.claims','{"sub":"33333333-3333-4333-8333-333333333333"}',true);
do $$ declare affected integer; begin
  begin
    insert into public.project_members(project_id,user_id,role)
      values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','33333333-3333-4333-8333-333333333333','owner');
    raise exception 'Non-owner organization member self-inserted into the project';
  exception when insufficient_privilege then null; end;
  update public.project_members set updated_at=updated_at
    where project_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' and user_id='22222222-2222-4222-8222-222222222222';
  get diagnostics affected=row_count;
  if affected<>0 then raise exception 'Non-owner organization member updated project members'; end if;
end $$;
reset role;
delete from public.organization_members
  where organization_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and user_id='33333333-3333-4333-8333-333333333333';

-- Outsider (3333) reads nothing and writes nothing.
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"33333333-3333-4333-8333-333333333333"}',true);
do $$ declare affected integer; begin
  if exists (select 1 from public.organization_members where organization_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
    or exists (select 1 from public.project_members where project_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')
  then raise exception 'Outsider can read tenant membership rows'; end if;
  delete from public.organization_members where organization_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  get diagnostics affected=row_count;
  if affected<>0 then raise exception 'Outsider deleted organization members'; end if;
  delete from public.project_members where project_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  get diagnostics affected=row_count;
  if affected<>0 then raise exception 'Outsider deleted project members'; end if;
end $$;
reset role;

rollback;
