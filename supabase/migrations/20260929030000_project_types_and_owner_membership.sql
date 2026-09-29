create type public.project_type as enum ('ai', 'agency');
alter table public.projects add column type public.project_type not null default 'ai';
create index projects_organization_type_status_updated_idx on public.projects(organization_id, type, status, updated_at desc);
create or replace function private.add_project_owner() returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$ begin insert into public.project_members (project_id, user_id, role) values (new.id, new.created_by, 'owner') on conflict do nothing; return new; end; $$;
revoke all on function private.add_project_owner() from public;
create trigger projects_add_creator_as_owner after insert on public.projects for each row execute function private.add_project_owner();
