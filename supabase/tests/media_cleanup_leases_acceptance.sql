begin;
insert into private.media_deletion_outbox(asset_id,project_id,object_path) values
('16161616-1616-4616-8616-161616161616','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
'projects/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/16161616-1616-4616-8616-161616161616/cleanup.png');
do $$ begin
  if has_function_privilege('authenticated','public.claim_media_cleanup()','EXECUTE')
    or has_function_privilege('anon','public.inspect_media_cleanup(uuid,uuid)','EXECUTE')
    or has_function_privilege('authenticated','public.finish_media_cleanup(uuid,uuid,text,integer)','EXECUTE')
  then raise exception 'Worker RPC exposed to clients'; end if;
end $$;
set local role service_role;
do $$ declare first_claim record; second_claim record; begin
  select * into first_claim from public.claim_media_cleanup();
  if first_claim.id is null or first_claim.attempts <> 1 then raise exception 'Claim failed'; end if;
  if exists(select 1 from public.claim_media_cleanup()) then raise exception 'Live lease claimed twice'; end if;
  if public.inspect_media_cleanup(first_claim.id,gen_random_uuid()) <> 'stale' then raise exception 'Wrong token accepted'; end if;
  if public.inspect_media_cleanup(first_claim.id,first_claim.lease_token) <> 'ready' then raise exception 'Reference check failed'; end if;
  if public.finish_media_cleanup(first_claim.id,gen_random_uuid()) then raise exception 'Wrong token completed'; end if;
  update private.media_deletion_outbox set lease_until=clock_timestamp()-interval '1 second' where id=first_claim.id;
  if public.finish_media_cleanup(first_claim.id,first_claim.lease_token) then raise exception 'Expired lease completed'; end if;
  select * into second_claim from public.claim_media_cleanup();
  if second_claim.attempts<>2 or second_claim.lease_token=first_claim.lease_token then raise exception 'Reclaim did not fence old worker'; end if;
  if public.finish_media_cleanup(first_claim.id,first_claim.lease_token) then raise exception 'Old worker completed new lease'; end if;
  if not public.finish_media_cleanup(second_claim.id,second_claim.lease_token,'storage_failed',60) then raise exception 'Retry failed'; end if;
  if exists(select 1 from public.claim_media_cleanup()) then raise exception 'Backoff ignored'; end if;
  update private.media_deletion_outbox set available_at=clock_timestamp()-interval '1 second' where id=first_claim.id;
  select * into second_claim from public.claim_media_cleanup();
  if not public.finish_media_cleanup(second_claim.id,second_claim.lease_token) then raise exception 'Completion failed'; end if;
  if exists(select 1 from public.claim_media_cleanup()) then raise exception 'Completed work reclaimed'; end if;
end $$;
reset role;
-- Seed references before retirement to model legacy/shared-file records.
insert into public.assets(id,project_id,kind,name,storage_path,mime_type,size_bytes,created_by) values
('17171717-1717-4717-8717-171717171717','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','image','Referenced',
'projects/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/17171717-1717-4717-8717-171717171717/original.png','image/png',8,
'11111111-1111-4111-8111-111111111111');
insert into public.asset_versions(asset_id,version_number,storage_path,mime_type,size_bytes,created_by) values
('17171717-1717-4717-8717-171717171717',1,
'projects/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/18181818-1818-4818-8818-181818181818/version.png','image/png',8,
'11111111-1111-4111-8111-111111111111');
insert into private.media_deletion_outbox(asset_id,project_id,object_path,lease_token,lease_until)
select a.id,a.project_id,a.storage_path,'19191919-1919-4919-8919-191919191919',clock_timestamp()+interval '120 seconds'
from public.assets a where a.id='17171717-1717-4717-8717-171717171717'
union all
select v.asset_id,'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid,v.storage_path,'19191919-1919-4919-8919-191919191919'::uuid,clock_timestamp()+interval '120 seconds'
from public.asset_versions v where v.asset_id='17171717-1717-4717-8717-171717171717';
set local role service_role;
do $$ declare queued record; begin
  for queued in select * from private.media_deletion_outbox where asset_id='17171717-1717-4717-8717-171717171717' loop
    if public.inspect_media_cleanup(queued.id,queued.lease_token)<>'referenced' then raise exception 'Live reference ignored'; end if;
  end loop;
end $$;
rollback;
