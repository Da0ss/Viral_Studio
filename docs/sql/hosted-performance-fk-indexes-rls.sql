-- Apply as one apply_migration request; the runner supplies the transaction.
-- In SQL Editor, wrap this complete file in explicit BEGIN/COMMIT.
-- Fail closed if the reviewed hosted baseline has drifted.
do $$
declare p record; q text; w text; expected_expression text; t record; table_oid oid; column_number smallint;
begin
  for t in select * from (values
    ('public'::text,'organization_members'::text,'organization_members: owners manage members'::text,'private.is_organization_owner'::text,'organization_id'::text),
    ('public','project_members','project_members: project owners manage','private.is_project_owner','project_id')
  ) v(schema_name,table_name,policy_name,helper_name,row_column) loop
    select * into strict p from pg_catalog.pg_policies
      where schemaname=t.schema_name and tablename=t.table_name and policyname=t.policy_name;
    if p.permissive is distinct from 'PERMISSIVE' or p.cmd is distinct from 'ALL'
      or p.roles is distinct from array['authenticated']::name[]
    then raise exception 'Unexpected policy metadata for %.%',t.table_name,t.policy_name; end if;
    q:=pg_catalog.regexp_replace(p.qual,'[[:space:]]+','','g');
    w:=pg_catalog.regexp_replace(p.with_check,'[[:space:]]+','','g');
    expected_expression:='(SELECT'||t.helper_name||'('||t.table_name||'.'||t.row_column||',auth.uid())AS'||
      pg_catalog.split_part(t.helper_name,'.',2)||')';
    if q is distinct from expected_expression
      or w is distinct from q
    then raise exception 'Unexpected policy expression for %.%',t.table_name,t.policy_name; end if;
  end loop;

  for t in select * from (values
    ('private'::text,'generation_output_reservations'::text,'project_id'::text,'generation_output_reservations_project_id_fkey'::text,'generation_output_reservations_project_id_idx'::text),
    ('public','team_invitations','project_id','team_invitations_project_id_fkey','team_invitations_project_id_idx'),
    ('public','team_invitations','invited_by','team_invitations_invited_by_fkey','team_invitations_invited_by_idx')
  ) v(schema_name,table_name,column_name,constraint_name,index_name) loop
    select c.oid,a.attnum into strict table_oid,column_number from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid=c.relnamespace
      join pg_catalog.pg_attribute a on a.attrelid=c.oid and a.attname=t.column_name
      where n.nspname=t.schema_name and c.relname=t.table_name and c.relkind in ('r','p') and not a.attisdropped;
    if not exists(select 1 from pg_catalog.pg_constraint f where f.conrelid=table_oid
      and f.conname=t.constraint_name and f.contype='f' and f.convalidated
      and f.conkey=array[column_number]::smallint[])
    then raise exception 'Expected validated FK % is absent or changed',t.constraint_name; end if;
    if exists(select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
      where n.nspname=t.schema_name and c.relname=t.index_name)
    then raise exception 'Target index name %.% already exists',t.schema_name,t.index_name; end if;
    if not exists(select 1 from pg_catalog.pg_index i join pg_catalog.pg_class c on c.oid=i.indexrelid
      join pg_catalog.pg_am am on am.oid=c.relam where i.indrelid=table_oid and i.indisvalid and i.indisready
      and i.indpred is null and am.amname='btree' and (i.indkey::smallint[])[0]=column_number)
    then execute pg_catalog.format('create index %I on %I.%I (%I)',t.index_name,t.schema_name,t.table_name,t.column_name); end if;
  end loop;
end $$;

-- Keep the row-dependent helper correlated; cache only request identity.
alter policy "organization_members: owners manage members" on public.organization_members
  using (private.is_organization_owner(organization_id,(select auth.uid())))
  with check (private.is_organization_owner(organization_id,(select auth.uid())));
alter policy "project_members: project owners manage" on public.project_members
  using (private.is_project_owner(project_id,(select auth.uid())))
  with check (private.is_project_owner(project_id,(select auth.uid())));
