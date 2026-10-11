begin;

-- Queue records are deliberately populated with private fields that must never
-- appear in the aggregate response.
insert into private.media_deletion_outbox(id,asset_id,project_id,object_path,created_at,available_at,attempts,lease_token,lease_until,completed_at)
values
('a1000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000001','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','private/cleanup-ready','now'::timestamptz-interval '10 minutes','now'::timestamptz-interval '1 minute',2,null,null,null),
('a1000000-0000-4000-8000-000000000002','a2000000-0000-4000-8000-000000000002','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','private/cleanup-retry','now'::timestamptz-interval '30 minutes','now'::timestamptz+interval '1 hour',1,null,null,null),
('a1000000-0000-4000-8000-000000000003','a2000000-0000-4000-8000-000000000003','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','private/cleanup-leased','now'::timestamptz-interval '1 hour','now'::timestamptz-interval '1 minute',0,'a3000000-0000-4000-8000-000000000003','now'::timestamptz+interval '1 hour',null),
('a1000000-0000-4000-8000-000000000004','a2000000-0000-4000-8000-000000000004','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','private/cleanup-done','now'::timestamptz-interval '2 hours','now'::timestamptz-interval '1 hour',3,null,null,'now'::timestamptz);

insert into private.media_upload_intents(id,requested_by,project_id,idempotency_key,content_sha256,mime_type,original_name,size_bytes,object_path,state,reconcile_after,available_at,created_at)
values
('a4000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','a5000000-0000-4000-8000-000000000001',repeat('a',64),'image/png','private-upload.png',100,'private/upload-ready','uploading',now()-interval '1 minute',now()-interval '1 minute',now()-interval '5 minutes'),
('a4000000-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','a5000000-0000-4000-8000-000000000002',repeat('b',64),'image/png','private-upload-retry.png',100,'private/upload-retry','cleanup_pending',now()-interval '1 minute',now()+interval '1 hour',now()-interval '20 minutes');

insert into public.generation_jobs(project_id,requested_by,status,input,client_request_id,reservation_day,dispatch_state,next_attempt_at,attempt_count,lease_token,lease_until,uncertain_at,created_at)
values
('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','11111111-1111-4111-8111-111111111111','queued','{"prompt":"do not leak fixture prompt"}'::jsonb,'a6000000-0000-4000-8000-000000000001',(now() at time zone 'UTC')::date,'queued',now()-interval '1 minute',0,null,null,null,now()-interval '20 minutes'),
('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','11111111-1111-4111-8111-111111111111','running','{"prompt":"another private fixture prompt"}'::jsonb,'a6000000-0000-4000-8000-000000000002',(now() at time zone 'UTC')::date,'polling',now()-interval '1 minute',2,'a7000000-0000-4000-8000-000000000002',now()-interval '1 second',null,now()-interval '10 minutes'),
('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','11111111-1111-4111-8111-111111111111','running','{"prompt":"uncertain private fixture prompt"}'::jsonb,'a6000000-0000-4000-8000-000000000003',(now() at time zone 'UTC')::date,'uncertain',now(),1,null,null,now(),now()-interval '1 minute');

insert into private.generation_budget_daily(usage_day,bucket_user,reserved_micro_usd,spent_micro_usd)
values ((now() at time zone 'UTC')::date,'00000000-0000-0000-0000-000000000000',100000,25000)
on conflict (usage_day,bucket_user) do update set reserved_micro_usd=excluded.reserved_micro_usd,spent_micro_usd=excluded.spent_micro_usd;

do $$ begin
  if has_function_privilege('anon','public.get_worker_metrics()','EXECUTE')
    or has_function_privilege('authenticated','public.get_worker_metrics()','EXECUTE')
    or not has_function_privilege('service_role','public.get_worker_metrics()','EXECUTE') then
    raise exception 'Worker metrics RPC privileges are incorrect';
  end if;
  if has_table_privilege('authenticated','private.media_deletion_outbox','SELECT')
    or has_table_privilege('authenticated','private.media_upload_intents','SELECT')
    or has_table_privilege('authenticated','private.generation_budget_daily','SELECT') then
    raise exception 'Queue tables are exposed to authenticated clients';
  end if;
end $$;

set local role service_role;
do $$ declare metrics jsonb; begin
  metrics := public.get_worker_metrics();
  if metrics->'queues'->'media_cleanup'->>'depth' <> '3'
    or metrics->'queues'->'media_cleanup'->>'ready' <> '1'
    or metrics->'queues'->'media_cleanup'->>'retry' <> '2'
    or metrics->'queues'->'media_cleanup'->>'uncertain' <> '0' then
    raise exception 'Media cleanup aggregate counts are incorrect';
  end if;
  if (metrics->'queues'->'media_cleanup'->>'oldest_ready_age_seconds')::bigint not between 550 and 650 then
    raise exception 'Media cleanup oldest-ready age is incorrect';
  end if;
  if metrics->'queues'->'media_upload_reconcile'->>'depth' <> '2'
    or metrics->'queues'->'media_upload_reconcile'->>'ready' <> '1'
    or metrics->'queues'->'media_upload_reconcile'->>'retry' <> '1'
    or metrics->'queues'->'media_upload_reconcile'->>'uncertain' <> '0' then
    raise exception 'Upload reconciliation aggregate counts are incorrect';
  end if;
  if metrics->'queues'->'generation'->>'depth' <> '3'
    or metrics->'queues'->'generation'->>'ready' <> '2'
    or metrics->'queues'->'generation'->>'retry' <> '1'
    or metrics->'queues'->'generation'->>'uncertain' <> '1' then
    raise exception 'Generation aggregate counts are incorrect';
  end if;
  if (metrics->'queues'->'generation'->>'oldest_ready_age_seconds')::bigint < 1100 then
    raise exception 'Generation oldest-ready age is incorrect';
  end if;
  if metrics->'generation_budget'->>'daily_limit_micro_usd' <> '1000000'
    or metrics->'generation_budget'->>'reserved_micro_usd' <> '100000'
    or metrics->'generation_budget'->>'spent_micro_usd' <> '25000'
    or metrics->'generation_budget'->>'remaining_micro_usd' <> '875000' then
    raise exception 'Generation budget aggregate is incorrect';
  end if;
  if metrics::text ~ 'a1000000|a2000000|a4000000|a6000000|a7000000|cleanup-ready|upload-ready|fixture prompt|object_path|requested_by' then
    raise exception 'Worker metrics leaked private queue data';
  end if;
end $$;
reset role;
rollback;
