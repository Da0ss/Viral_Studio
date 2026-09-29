create extension if not exists pgcrypto;

create type public.organization_role as enum ('owner', 'admin', 'member');
create type public.project_role as enum ('owner', 'editor', 'commenter', 'viewer');
create type public.project_status as enum ('draft', 'active', 'review', 'completed', 'archived');
create type public.asset_kind as enum ('video', 'image', 'audio', 'document');
create type public.generation_status as enum ('queued', 'running', 'completed', 'failed', 'cancelled');
create type public.notification_kind as enum ('project', 'asset', 'message', 'generation', 'system');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(trim(display_name)) between 2 and 80),
  avatar_url text check (avatar_url is null or avatar_url ~ '^https?://'),
  timezone text not null default 'UTC' check (char_length(timezone) between 1 and 64),
  locale text not null default 'ru' check (locale ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 2 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.organization_role not null default 'member',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 2 and 160),
  description text not null default '' check (char_length(description) <= 5000),
  status public.project_status not null default 'draft',
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.project_members (
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.project_role not null default 'viewer',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (project_id, user_id)
);

create table public.assets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  kind public.asset_kind not null,
  name text not null check (char_length(trim(name)) between 1 and 255),
  storage_path text not null unique check (storage_path !~ '^/' and storage_path !~ '(^|/)\.\.(/|$)'),
  mime_type text not null check (mime_type ~ '^[a-z0-9.+-]+/[a-z0-9.+-]+$'),
  size_bytes bigint not null check (size_bytes >= 0),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.asset_versions (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.assets(id) on delete cascade,
  version_number integer not null check (version_number > 0),
  storage_path text not null unique check (storage_path !~ '^/' and storage_path !~ '(^|/)\.\.(/|$)'),
  mime_type text not null check (mime_type ~ '^[a-z0-9.+-]+/[a-z0-9.+-]+$'),
  size_bytes bigint not null check (size_bytes >= 0),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (asset_id, version_number)
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete restrict,
  body text not null check (char_length(trim(body)) between 1 and 5000),
  parent_message_id uuid references public.messages(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind public.notification_kind not null,
  title text not null check (char_length(trim(title)) between 1 and 200),
  body text not null default '' check (char_length(body) <= 2000),
  project_id uuid references public.projects(id) on delete cascade,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.generation_jobs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  requested_by uuid not null references auth.users(id) on delete restrict,
  status public.generation_status not null default 'queued',
  input jsonb not null default '{}'::jsonb check (jsonb_typeof(input) = 'object'),
  output jsonb not null default '{}'::jsonb check (jsonb_typeof(output) = 'object'),
  error_message text check (error_message is null or char_length(error_message) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  check ((status <> 'completed') or completed_at is not null)
);

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null check (action ~ '^[a-z][a-z0-9_.-]{2,100}$'),
  entity_type text not null check (entity_type ~ '^[a-z][a-z0-9_.-]{1,100}$'),
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  check (organization_id is not null or project_id is not null)
);

-- These helpers are only callable through RLS. Keeping them in a non-exposed
-- schema avoids recursive policies on membership tables.
create schema if not exists private;
revoke all on schema private from public;

create function private.is_organization_owner(target_organization_id uuid, target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from public.organization_members
    where organization_id = target_organization_id
      and user_id = target_user_id
      and role = 'owner'
  ) and target_user_id = (select auth.uid());
$$;

create function private.is_project_owner(target_project_id uuid, target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from public.project_members
    where project_id = target_project_id
      and user_id = target_user_id
      and role = 'owner'
  ) and target_user_id = (select auth.uid());
$$;

revoke all on function private.is_organization_owner(uuid, uuid) from public;
revoke all on function private.is_project_owner(uuid, uuid) from public;
grant usage on schema private to authenticated;
grant execute on function private.is_organization_owner(uuid, uuid) to authenticated;
grant execute on function private.is_project_owner(uuid, uuid) to authenticated;

create index organization_members_user_id_idx on public.organization_members(user_id, organization_id);
create index projects_organization_id_updated_at_idx on public.projects(organization_id, updated_at desc);
create index project_members_user_id_idx on public.project_members(user_id, project_id);
create index assets_project_id_created_at_idx on public.assets(project_id, created_at desc);
create index asset_versions_asset_id_version_number_idx on public.asset_versions(asset_id, version_number desc);
create index messages_project_id_created_at_idx on public.messages(project_id, created_at);
create index notifications_user_id_read_at_created_at_idx on public.notifications(user_id, read_at, created_at desc);
create index generation_jobs_project_id_status_created_at_idx on public.generation_jobs(project_id, status, created_at desc);
create index audit_log_organization_id_created_at_idx on public.audit_log(organization_id, created_at desc);
create index audit_log_project_id_created_at_idx on public.audit_log(project_id, created_at desc);

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

create trigger profiles_updated_at before update on public.profiles for each row execute function public.set_updated_at();
create trigger organizations_updated_at before update on public.organizations for each row execute function public.set_updated_at();
create trigger organization_members_updated_at before update on public.organization_members for each row execute function public.set_updated_at();
create trigger projects_updated_at before update on public.projects for each row execute function public.set_updated_at();
create trigger project_members_updated_at before update on public.project_members for each row execute function public.set_updated_at();
create trigger assets_updated_at before update on public.assets for each row execute function public.set_updated_at();
create trigger messages_updated_at before update on public.messages for each row execute function public.set_updated_at();
create trigger notifications_updated_at before update on public.notifications for each row execute function public.set_updated_at();
create trigger generation_jobs_updated_at before update on public.generation_jobs for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.projects enable row level security;
alter table public.project_members enable row level security;
alter table public.assets enable row level security;
alter table public.asset_versions enable row level security;
alter table public.messages enable row level security;
alter table public.notifications enable row level security;
alter table public.generation_jobs enable row level security;
alter table public.audit_log enable row level security;

create policy "profiles: select own" on public.profiles for select to authenticated using ((select auth.uid()) = id);
create policy "profiles: insert own" on public.profiles for insert to authenticated with check ((select auth.uid()) = id);
create policy "profiles: update own" on public.profiles for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

create policy "organizations: members can read" on public.organizations for select to authenticated using (exists (select 1 from public.organization_members m where m.organization_id = id and m.user_id = (select auth.uid())));
create policy "organizations: authenticated can create" on public.organizations for insert to authenticated with check (created_by = (select auth.uid()));
create policy "organizations: owners can update" on public.organizations for update to authenticated using (exists (select 1 from public.organization_members m where m.organization_id = id and m.user_id = (select auth.uid()) and m.role = 'owner')) with check (exists (select 1 from public.organization_members m where m.organization_id = id and m.user_id = (select auth.uid()) and m.role = 'owner'));

create policy "organization_members: read own membership" on public.organization_members for select to authenticated using (user_id = (select auth.uid()));
create policy "organization_members: owners manage members" on public.organization_members for all to authenticated using ((select private.is_organization_owner(organization_id, auth.uid()))) with check ((select private.is_organization_owner(organization_id, auth.uid())));

create policy "projects: organization members read" on public.projects for select to authenticated using (exists (select 1 from public.organization_members m where m.organization_id = organization_id and m.user_id = (select auth.uid())));
create policy "projects: organization owners and admins create" on public.projects for insert to authenticated with check (created_by = (select auth.uid()) and exists (select 1 from public.organization_members m where m.organization_id = organization_id and m.user_id = (select auth.uid()) and m.role in ('owner', 'admin')));
create policy "projects: project owners and editors update" on public.projects for update to authenticated using (exists (select 1 from public.project_members m where m.project_id = id and m.user_id = (select auth.uid()) and m.role in ('owner', 'editor'))) with check (exists (select 1 from public.project_members m where m.project_id = id and m.user_id = (select auth.uid()) and m.role in ('owner', 'editor')));
create policy "projects: project owners delete" on public.projects for delete to authenticated using (exists (select 1 from public.project_members m where m.project_id = id and m.user_id = (select auth.uid()) and m.role = 'owner'));

create policy "project_members: organization members read" on public.project_members for select to authenticated using (exists (select 1 from public.projects p join public.organization_members om on om.organization_id = p.organization_id where p.id = project_id and om.user_id = (select auth.uid())));
create policy "project_members: project owners manage" on public.project_members for all to authenticated using ((select private.is_project_owner(project_id, auth.uid()))) with check ((select private.is_project_owner(project_id, auth.uid())));

create policy "assets: project participants read" on public.assets for select to authenticated using (exists (select 1 from public.project_members m where m.project_id = assets.project_id and m.user_id = (select auth.uid())));
create policy "assets: owners and editors create" on public.assets for insert to authenticated with check (created_by = (select auth.uid()) and exists (select 1 from public.project_members m where m.project_id = assets.project_id and m.user_id = (select auth.uid()) and m.role in ('owner', 'editor')));
create policy "assets: owners and editors update" on public.assets for update to authenticated using (exists (select 1 from public.project_members m where m.project_id = assets.project_id and m.user_id = (select auth.uid()) and m.role in ('owner', 'editor'))) with check (exists (select 1 from public.project_members m where m.project_id = assets.project_id and m.user_id = (select auth.uid()) and m.role in ('owner', 'editor')));
create policy "assets: owners and editors delete" on public.assets for delete to authenticated using (exists (select 1 from public.project_members m where m.project_id = assets.project_id and m.user_id = (select auth.uid()) and m.role in ('owner', 'editor')));

create policy "asset_versions: project participants read" on public.asset_versions for select to authenticated using (exists (select 1 from public.assets a join public.project_members m on m.project_id = a.project_id where a.id = asset_id and m.user_id = (select auth.uid())));
create policy "asset_versions: owners and editors create" on public.asset_versions for insert to authenticated with check (created_by = (select auth.uid()) and exists (select 1 from public.assets a join public.project_members m on m.project_id = a.project_id where a.id = asset_id and m.user_id = (select auth.uid()) and m.role in ('owner', 'editor')));
create policy "asset_versions: owners and editors delete" on public.asset_versions for delete to authenticated using (exists (select 1 from public.assets a join public.project_members m on m.project_id = a.project_id where a.id = asset_id and m.user_id = (select auth.uid()) and m.role in ('owner', 'editor')));

create policy "messages: project participants read" on public.messages for select to authenticated using (exists (select 1 from public.project_members m where m.project_id = messages.project_id and m.user_id = (select auth.uid())));
create policy "messages: commenters can create" on public.messages for insert to authenticated with check (sender_id = (select auth.uid()) and exists (select 1 from public.project_members m where m.project_id = messages.project_id and m.user_id = (select auth.uid()) and m.role in ('owner', 'editor', 'commenter')));
create policy "messages: sender can update" on public.messages for update to authenticated using (sender_id = (select auth.uid())) with check (sender_id = (select auth.uid()) and exists (select 1 from public.project_members m where m.project_id = messages.project_id and m.user_id = (select auth.uid()) and m.role in ('owner', 'editor', 'commenter')));
create policy "messages: sender can delete" on public.messages for delete to authenticated using (sender_id = (select auth.uid()));

create policy "notifications: owner can read" on public.notifications for select to authenticated using (user_id = (select auth.uid()));
create policy "notifications: owner can update" on public.notifications for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "generation_jobs: project participants read" on public.generation_jobs for select to authenticated using (exists (select 1 from public.project_members m where m.project_id = generation_jobs.project_id and m.user_id = (select auth.uid())));
create policy "generation_jobs: owners and editors create" on public.generation_jobs for insert to authenticated with check (requested_by = (select auth.uid()) and exists (select 1 from public.project_members m where m.project_id = generation_jobs.project_id and m.user_id = (select auth.uid()) and m.role in ('owner', 'editor')));
create policy "generation_jobs: owners and editors update" on public.generation_jobs for update to authenticated using (exists (select 1 from public.project_members m where m.project_id = generation_jobs.project_id and m.user_id = (select auth.uid()) and m.role in ('owner', 'editor'))) with check (exists (select 1 from public.project_members m where m.project_id = generation_jobs.project_id and m.user_id = (select auth.uid()) and m.role in ('owner', 'editor')));

create policy "audit_log: organization members read" on public.audit_log for select to authenticated using ((organization_id is not null and exists (select 1 from public.organization_members om where om.organization_id = audit_log.organization_id and om.user_id = (select auth.uid()))) or (project_id is not null and exists (select 1 from public.project_members pm where pm.project_id = audit_log.project_id and pm.user_id = (select auth.uid()))));
