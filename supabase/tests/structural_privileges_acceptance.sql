begin;
do $$ declare relation record; role_name text; capability text; checked integer:=0; begin
  for relation in select c.oid,c.relname from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind='r'
  loop
    checked:=checked+1;
    foreach role_name in array array['anon','authenticated'] loop
      foreach capability in array array['TRUNCATE','REFERENCES','TRIGGER'] loop
        if has_table_privilege(role_name,relation.oid,capability) then raise exception 'Client structural privilege remains'; end if;
      end loop;
      if exists(select 1 from pg_catalog.pg_attribute a where a.attrelid=relation.oid and a.attnum>0 and not a.attisdropped
        and has_column_privilege(role_name,relation.oid,a.attnum,'REFERENCES')) then raise exception 'Client column REFERENCES remains'; end if;
    end loop;
  end loop;
  if checked<>12 then raise exception 'Unexpected public table inventory; extend acceptance'; end if;
end $$;
set local role authenticated;
do $$ declare table_name text; begin
  foreach table_name in array array['profiles','organizations','organization_members','projects','project_members','assets','asset_versions','messages','notifications','generation_jobs','audit_log','team_invitations'] loop
    begin
      execute format('truncate public.%I cascade',table_name);
      raise exception 'Client TRUNCATE allowed';
    exception when insufficient_privilege then null; end;
  end loop;
end $$;
rollback;
