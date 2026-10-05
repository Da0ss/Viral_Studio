begin;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111"}',true);
-- Belonging to both tenants must not turn ordinary edit rights into transfer rights.
insert into public.organizations(id,name,slug,created_by)
values ('21212121-2121-4121-8121-212121212121','Second owned organization','identity-fixture','11111111-1111-4111-8111-111111111111');
do $$ declare statement text; protected_column text; affected integer; begin
  foreach protected_column in array array['id','organization_id','created_by','created_at','updated_at'] loop
    if has_column_privilege('authenticated','public.projects',protected_column,'UPDATE') then raise exception 'Project identity column writable'; end if;
  end loop;
  foreach statement in array array[
    'update public.projects set organization_id=''21212121-2121-4121-8121-212121212121'' where id=''bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb''',
    'update public.projects set id=id where id=''bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb''',
    'update public.projects set created_by=created_by where id=''bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb''',
    'update public.projects set created_at=created_at where id=''bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb''',
    'update public.projects set updated_at=updated_at where id=''bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'''
  ] loop
    begin execute statement; raise exception 'Protected project UPDATE accepted';
    exception when insufficient_privilege then null; end;
  end loop;
  update public.projects set name='Edited safely',description='Fixture',status='review'
  where id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  get diagnostics affected=row_count;
  if affected<>1 then raise exception 'Ordinary project edit broken'; end if;
  if not exists(select 1 from public.projects where id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' and organization_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and name='Edited safely') then raise exception 'Project tenant changed'; end if;
end $$;
rollback;
