-- Media metadata writes must pass through quota- and path-validating RPCs.
-- Keep client reads and parent-asset deletion; grant the trusted upload worker
-- the INSERT rights used by the verified upload finalizers.
revoke insert, update on public.assets, public.asset_versions
  from public, anon, authenticated;
-- Version removal goes through the parent asset so all stored paths enter the
-- cleanup outbox atomically. Keep DELETE on public.assets itself enabled.
revoke delete on public.asset_versions from public, anon, authenticated;

-- REVOKE on the table does not remove narrower column grants. Clear any that
-- may have been introduced by an earlier hosted grant or operator change.
do $$
declare
  relation record;
  columns text;
begin
  for relation in
    select c.oid, c.relname
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in ('assets', 'asset_versions')
      and c.relkind in ('r', 'p')
  loop
    select string_agg(pg_catalog.quote_ident(a.attname), ', ' order by a.attnum)
      into columns
    from pg_catalog.pg_attribute a
    where a.attrelid = relation.oid
      and a.attnum > 0
      and not a.attisdropped;

    execute pg_catalog.format(
      'revoke insert (%1$s), update (%1$s) on public.%2$I from public, anon, authenticated',
      columns,
      relation.relname
    );
  end loop;
end
$$;

grant insert on public.assets, public.asset_versions to service_role;
