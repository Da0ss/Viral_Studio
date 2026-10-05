-- Catalog invariants after all migrations, executed as the database owner.
-- Behavioral authorization is exercised by the other acceptance files.
do $$
declare missing text;
begin
  select string_agg(c.relname, ', ' order by c.relname) into missing
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind in ('r','p') and not c.relrowsecurity;
  if missing is not null then raise exception 'Public tables without RLS: %', missing; end if;

  if (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relkind in ('r','p')) <> 11 then
    raise exception 'Application table inventory changed; review security coverage';
  end if;

  if exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relkind='v'
      and not coalesce(c.reloptions @> array['security_invoker=true'],false)) then
    raise exception 'Public view can bypass caller RLS';
  end if;

  if exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname in ('public','private') and p.prosecdef
      and (has_function_privilege('anon',p.oid,'EXECUTE')
        or not exists (select 1 from unnest(p.proconfig) setting where setting like 'search_path=%'))) then
    raise exception 'Security definer function is callable by anon or lacks fixed search_path';
  end if;

  if exists (select 1 from storage.buckets where id in ('avatars','project-media') and public)
      or (select count(*) from storage.buckets where id in ('avatars','project-media')) <> 2 then
    raise exception 'Expected private Storage buckets absent or public';
  end if;
end $$;
