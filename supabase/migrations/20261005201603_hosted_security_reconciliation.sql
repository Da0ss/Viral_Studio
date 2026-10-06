-- Align the hosted bootstrap helpers with the local security contract.
-- The hosted auto-RLS event trigger is platform-installed; preserve it and its
-- event-trigger caller while revoking client execution of its function.
alter function public.set_updated_at() set search_path = pg_catalog;
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    execute 'revoke execute on function public.rls_auto_enable() from public, anon, authenticated';
  end if;
end $$;
