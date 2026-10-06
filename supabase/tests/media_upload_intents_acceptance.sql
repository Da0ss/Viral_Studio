begin;
do $$ begin
  if has_table_privilege('authenticated','private.media_upload_intents','SELECT')
    or has_table_privilege('authenticated','private.media_project_quotas','SELECT')
    or has_function_privilege('anon','public.begin_media_upload(uuid,uuid,text,text,text,bigint)','EXECUTE')
    or has_function_privilege('authenticated','public.finish_media_upload(uuid,uuid,text,bigint)','EXECUTE')
    or has_function_privilege('authenticated','public.claim_media_upload_cleanup()','EXECUTE')
    or (select prosecdef from pg_proc where oid='public.begin_media_upload(uuid,uuid,text,text,text,bigint)'::regprocedure)
    or (select prosecdef from pg_proc where oid='public.assert_media_upload_lease(uuid,uuid)'::regprocedure)
    or (select prosecdef from pg_proc where oid='public.get_media_upload_status(uuid,uuid,text)'::regprocedure)
    or (select prosecdef from pg_proc where oid='public.finish_media_upload(uuid,uuid,text,bigint)'::regprocedure)
  then raise exception 'Upload intent internals exposed'; end if;
end $$;
create temp table upload_acceptance_state(intent_id uuid, object_path text, lease_token uuid, asset_id uuid);
grant all on upload_acceptance_state to authenticated, service_role;

set local role service_role;
select public.set_project_media_quota('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',52428801);
reset role;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111"}',true);

do $$ declare first record; replay record; conflict record; quota record; begin
  select * into first from public.begin_media_upload(
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','21212121-2121-4212-8212-212121212121',repeat('a',64),'image/png','photo.png',8);
  if first.outcome<>'upload' or first.intent_id is null or first.lease_token is null or first.object_path !~ '^projects/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/[0-9a-f-]{36}/photo\.png$' then
    raise exception 'Initial intent reservation failed: %',coalesce(first.outcome,'<null>'); end if;
  select * into replay from public.begin_media_upload(
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','21212121-2121-4212-8212-212121212121',repeat('a',64),'image/png','photo.png',8);
  if replay.outcome<>'upload' or replay.intent_id<>first.intent_id or replay.object_path<>first.object_path or replay.lease_token<>first.lease_token then raise exception 'Idempotent replay changed reservation'; end if;
  if not public.assert_media_upload_lease(first.intent_id,first.lease_token) then raise exception 'Valid upload lease rejected'; end if;
  begin
    insert into public.assets(project_id,kind,name,storage_path,mime_type,size_bytes,created_by)
    values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','image','Premature',first.object_path,'image/png',1,'11111111-1111-4111-8111-111111111111');
    raise exception 'Metadata created before upload verification';
  exception when check_violation then null; end;
  if (select outcome from public.get_media_upload_status('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','21212121-2121-4212-8212-212121212121',repeat('a',64)))<>'pending' then raise exception 'Pending upload status missing'; end if;
  begin
    insert into storage.objects(bucket_id,name) values ('project-media',first.object_path);
    raise exception 'Authenticated client bypassed trusted Storage write';
  exception when insufficient_privilege then null; end;
  select * into conflict from public.begin_media_upload(
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','21212121-2121-4212-8212-212121212121',repeat('b',64),'image/png','photo.png',8);
  if conflict.outcome<>'conflict' then raise exception 'Key reuse with different bytes accepted'; end if;
  select * into quota from public.begin_media_upload(
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','22222222-2222-4222-8222-222222222222',repeat('c',64),'image/png','second.png',1);
  if quota.outcome<>'quota' then raise exception 'Concurrent reservation exceeded project quota'; end if;
  insert into upload_acceptance_state(intent_id,object_path,lease_token) values(first.intent_id,first.object_path,first.lease_token);
end $$;
reset role;
insert into storage.objects(bucket_id,name) select 'project-media',object_path from upload_acceptance_state limit 1;
set local role service_role;
do $$ declare asset uuid; begin
  if public.finish_media_upload((select intent_id from upload_acceptance_state limit 1),gen_random_uuid(),repeat('a',64),8) is not null then raise exception 'Wrong upload token finalized'; end if;
  select public.finish_media_upload(intent_id,lease_token,repeat('a',64),8) into asset from upload_acceptance_state where asset_id is null limit 1;
  if asset is null or not exists(select 1 from public.assets where id=asset and size_bytes=8) then raise exception 'Reservation did not finalize atomically'; end if;
  update upload_acceptance_state set asset_id=asset where lease_token is not null and asset_id is null;
end $$;
reset role;
set local role authenticated;
do $$ declare replay record; asset uuid; begin
  select asset_id into asset from upload_acceptance_state where lease_token is not null;
  select * into replay from public.begin_media_upload(
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','21212121-2121-4212-8212-212121212121',repeat('a',64),'image/png','photo.png',8);
  if replay.outcome<>'completed' or replay.asset_id<>asset then raise exception 'Completed request did not replay'; end if;
  if (select outcome from public.get_media_upload_status('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','21212121-2121-4212-8212-212121212121',repeat('a',64)))<>'completed' then raise exception 'Completed status query failed'; end if;
end $$;

reset role;
set local role service_role;
select public.set_project_media_quota('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',104857600);
reset role;
set local role authenticated;
do $$ declare created record; begin
  select * into created from public.begin_media_upload(
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','23232323-2323-4232-8232-232323232323',repeat('d',64),'image/png','abandoned.png',1);
  if created.outcome<>'upload' then raise exception 'Cleanup test intent reservation failed'; end if;
  insert into upload_acceptance_state(intent_id,object_path) values(created.intent_id,created.object_path);
end $$;
reset role;
update private.media_upload_intents set created_at=clock_timestamp()-interval '4 hours', reconcile_after=clock_timestamp()-interval '1 second', lease_until=clock_timestamp()-interval '1 second'
where id=(select id from private.media_upload_intents where idempotency_key='23232323-2323-4232-8232-232323232323');
set local role service_role;
do $$ declare claim record; expected uuid; begin
  select id into expected from private.media_upload_intents where idempotency_key='23232323-2323-4232-8232-232323232323';
  select * into claim from public.claim_media_upload_cleanup();
  if claim.intent_id<>expected or claim.bucket_id<>'project-media' or claim.lease_token is null then raise exception 'Abandoned upload was not claimed'; end if;
  if not exists(select 1 from private.media_retired_upload_paths where object_path=claim.object_path) then raise exception 'Retired upload path tombstone missing'; end if;
  if not public.finish_media_upload_cleanup(claim.intent_id,claim.lease_token,true,60) then raise exception 'Cleanup completion lost lease'; end if;
end $$;
reset role;
set local role authenticated;
do $$ declare created record; begin
  select * into created from public.begin_media_upload(
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','23232323-2323-4232-8232-232323232323',repeat('d',64),'image/png','abandoned.png',1);
  if created.outcome<>'expired' then raise exception 'Cleaned request was incorrectly reused'; end if;
end $$;
rollback;
