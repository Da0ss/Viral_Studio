-- Create these accounts through Supabase Auth (never by inserting raw passwords into auth.users):
--   viral.seed.owner@example.invalid  -> 11111111-1111-4111-8111-111111111111
--   viral.seed.viewer@example.invalid -> 22222222-2222-4222-8222-222222222222
--   viral.seed.outsider@example.invalid -> 33333333-3333-4333-8333-333333333333
-- Replace the UUIDs below with the IDs returned by Auth Admin when running this seed.
-- This file is intended for a disposable local/dev database and must run with a service role.

do $$
declare
  owner_id uuid := '11111111-1111-4111-8111-111111111111';
  viewer_id uuid := '22222222-2222-4222-8222-222222222222';
  outsider_id uuid := '33333333-3333-4333-8333-333333333333';
  organization_id uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  project_one_id uuid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  project_two_id uuid := 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
begin
  if not exists (select 1 from auth.users where id = owner_id) or not exists (select 1 from auth.users where id = viewer_id) or not exists (select 1 from auth.users where id = outsider_id) then
    raise exception 'Create the three documented seed users through Supabase Auth before executing seed.sql';
  end if;

  insert into public.profiles (id, name, email) select id, case id when owner_id then 'Viral Seed Owner' when viewer_id then 'Viral Seed Viewer' else 'Viral Seed Outsider' end, email from auth.users where id in (owner_id, viewer_id, outsider_id) on conflict (id) do nothing;
  insert into public.organizations (id, name, slug, created_by) values (organization_id, 'Viral Studio Test', 'viral-studio-test', owner_id) on conflict (id) do nothing;
  insert into public.organization_members (organization_id, user_id, role) values (organization_id, owner_id, 'owner'), (organization_id, viewer_id, 'member') on conflict do nothing;
  insert into public.projects (id, organization_id, name, description, status, created_by) values (project_one_id, organization_id, 'Seed campaign', 'Тестовая кампания', 'active', owner_id), (project_two_id, organization_id, 'Viewer project', 'Проект для проверки viewer', 'draft', owner_id) on conflict (id) do nothing;
  insert into public.project_members (project_id, user_id, role) values (project_one_id, owner_id, 'owner'), (project_one_id, viewer_id, 'commenter'), (project_two_id, owner_id, 'owner'), (project_two_id, viewer_id, 'viewer') on conflict do nothing;
  insert into public.messages (id, project_id, sender_id, body) values ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', project_one_id, owner_id, 'Добро пожаловать в тестовый проект.'), ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', project_one_id, viewer_id, 'Комментарий участника проекта.') on conflict (id) do nothing;
  insert into public.notifications (id, user_id, kind, title, body, project_id) values ('ffffffff-ffff-4fff-8fff-ffffffffffff', owner_id, 'project', 'Seed готов', 'Тестовые данные созданы.', project_one_id), ('99999999-9999-4999-8999-999999999999', viewer_id, 'message', 'Новое сообщение', 'В проекте есть новое сообщение.', project_one_id) on conflict (id) do nothing;
end $$;
