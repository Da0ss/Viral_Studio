-- Run after the migration and seed in a disposable database. Every block rolls back.
-- auth.uid() reads `request.jwt.claims`; these IDs match supabase/seed.sql.

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
do $$ begin
  if (select count(*) from public.projects) <> 2 then raise exception 'owner must see both organization projects'; end if;
end $$;
rollback;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
do $$ declare affected integer; begin
  update public.projects set name = 'viewer must not edit' where id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'viewer updated a project'; end if;
  insert into public.messages(project_id, sender_id, body) values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '22222222-2222-4222-8222-222222222222', 'RLS commenter check');
end $$;
rollback;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
do $$ begin
  if exists (select 1 from public.projects) then raise exception 'outsider can read another organization project'; end if;
  if exists (select 1 from public.assets) then raise exception 'outsider can read another organization asset'; end if;
end $$;
rollback;

-- Inspect required indexes after apply:
select indexname from pg_indexes where schemaname = 'public' and tablename in ('organization_members', 'projects', 'project_members', 'assets', 'asset_versions', 'messages', 'notifications', 'generation_jobs', 'audit_log') order by tablename, indexname;
