begin;
do $$
declare config text[];
begin
  select proconfig into config from pg_proc where oid = 'public.set_updated_at()'::regprocedure;
  if config is null or not ('search_path=pg_catalog' = any(config)) then
    raise exception 'set_updated_at must have a pinned search path';
  end if;
  if to_regprocedure('public.rls_auto_enable()') is not null then
    if has_function_privilege('anon', 'public.rls_auto_enable()', 'EXECUTE')
      or has_function_privilege('authenticated', 'public.rls_auto_enable()', 'EXECUTE') then
      raise exception 'Client roles must not execute platform RLS event helper';
    end if;
  end if;
end $$;
rollback;
