-- Extends the initial profile schema without rewriting an earlier migration.
alter table public.profiles rename column display_name to name;
alter table public.profiles rename column avatar_url to avatar_path;
alter table public.profiles rename column locale to language;
alter table public.profiles drop constraint if exists profiles_avatar_url_check;
alter table public.profiles drop constraint if exists profiles_locale_check;

alter table public.profiles add column email text;
update public.profiles p set email = u.email from auth.users u where u.id = p.id and p.email is null;
alter table public.profiles alter column email set not null;
alter table public.profiles add constraint profiles_email_check check (email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$');
create unique index profiles_email_lower_unique_idx on public.profiles (lower(email));

alter table public.profiles add column role text not null default 'Участник' check (char_length(trim(role)) between 2 and 100);
alter table public.profiles alter column language set default 'ru';
alter table public.profiles add constraint profiles_language_check check (language in ('ru', 'en', 'kk'));
update public.profiles set timezone = 'Asia/Qyzylorda' where timezone = 'UTC';
alter table public.profiles alter column timezone set default 'Asia/Qyzylorda';
alter table public.profiles add constraint profiles_timezone_check check (timezone in ('Asia/Qyzylorda', 'Asia/Almaty', 'Europe/Moscow', 'Europe/Berlin'));
alter table public.profiles add constraint profiles_avatar_path_check check (avatar_path is null or (avatar_path !~ '^/' and avatar_path !~ '(^|/)\.\.(/|$)'));
alter table public.profiles add column notification_email boolean not null default true;
alter table public.profiles add column notification_browser boolean not null default true;
alter table public.profiles add column notification_marketing boolean not null default false;

-- This trigger only bootstraps a personal row. It does not grant roles or use
-- mutable user metadata for authorization.
create or replace function private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  insert into public.profiles (id, name, email, role)
  values (new.id, coalesce(nullif(trim(new.raw_user_meta_data ->> 'name'), ''), 'Пользователь'), new.email, 'Участник')
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;
revoke all on function private.handle_new_auth_user() from public;

create or replace function private.sync_profile_email()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  update public.profiles set email = new.email where id = new.id;
  return new;
end;
$$;
revoke all on function private.sync_profile_email() from public;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile after insert on auth.users for each row execute function private.handle_new_auth_user();
drop trigger if exists on_auth_user_email_changed_profile on auth.users;
create trigger on_auth_user_email_changed_profile after update of email on auth.users for each row when (old.email is distinct from new.email) execute function private.sync_profile_email();
