-- RLS does not protect whole-table operations. Clients need DML, not DDL helpers.
revoke truncate, references, trigger on
  public.profiles, public.organizations, public.organization_members,
  public.projects, public.project_members, public.assets, public.asset_versions,
  public.messages, public.notifications, public.generation_jobs, public.audit_log
from public, anon, authenticated;

-- Remove any prior column-level REFERENCES grants too.
do $$ declare relation record; columns text; begin
  for relation in select c.oid,c.relname from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname in (
      'profiles','organizations','organization_members','projects','project_members',
      'assets','asset_versions','messages','notifications','generation_jobs','audit_log')
  loop
    select string_agg(quote_ident(a.attname),', ' order by a.attnum) into columns
    from pg_catalog.pg_attribute a where a.attrelid=relation.oid and a.attnum>0 and not a.attisdropped;
    execute format('revoke references (%s) on public.%I from public, anon, authenticated',columns,relation.relname);
  end loop;
end $$;
-- Applies to future tables created by the migration role, not every possible owner.
alter default privileges in schema public revoke truncate, references, trigger on tables from public, anon, authenticated;
