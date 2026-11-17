-- Multi-model generation: private catalog, per-model reservations, idempotency
-- across models, provider request ids, claim outputs and operator pricing.
begin;

-- Catalog shape and seeds (database owner).
do $$ begin
  if (select count(*) from private.generation_models) <> 5 then raise exception 'Unexpected catalog seed count'; end if;
  if not exists(select 1 from private.generation_models where model_key='Lightricks/LTX-Video-0.9.7-distilled' and provider='fal-ai'
      and request_path_prefix='/fal-ai/ltx-video-13b-distilled' and cost_micro_usd=50000 and enabled) then raise exception 'Legacy model seed wrong'; end if;
  if not exists(select 1 from private.generation_models where model_key='ltx' and provider='fal' and endpoint='fal-ai/ltx-video'
      and request_path_prefix='/fal-ai/ltx-video' and cost_micro_usd=50000 and enabled) then raise exception 'ltx seed wrong'; end if;
  if not exists(select 1 from private.generation_models where model_key='minimax' and provider='fal' and endpoint='fal-ai/minimax/video-01'
      and request_path_prefix='/fal-ai/minimax' and cost_micro_usd=50000 and enabled) then raise exception 'minimax seed wrong'; end if;
  if not exists(select 1 from private.generation_models where model_key='kling' and provider='fal' and endpoint='fal-ai/kling-video/v3/standard/text-to-video'
      and request_path_prefix='/fal-ai/kling-video' and cost_micro_usd is null and not enabled) then raise exception 'kling seed wrong'; end if;
  if not exists(select 1 from private.generation_models where model_key='seedance' and provider='fal' and endpoint='bytedance/seedance-2.0/text-to-video'
      and request_path_prefix='/bytedance/seedance-2.0' and cost_micro_usd is null and not enabled) then raise exception 'seedance seed wrong'; end if;
  if not (select relrowsecurity from pg_class where oid='private.generation_models'::regclass) then raise exception 'Catalog RLS is off'; end if;
end $$;

-- Catalog constraints (each statement must be rejected).
do $$ declare statement text; begin
  foreach statement in array array[
    'insert into private.generation_models(model_key,provider,endpoint,request_path_prefix,cost_micro_usd) values (''x1'',''other'',''a/b'',''/a/b'',1)',
    'insert into private.generation_models(model_key,provider,endpoint,request_path_prefix,cost_micro_usd) values (''x2'',''fal'',''a/b'',''/a'',1)',
    'insert into private.generation_models(model_key,provider,endpoint,request_path_prefix,cost_micro_usd) values (''x3'',''fal'',''a/b'',''/a/../b'',1)',
    'insert into private.generation_models(model_key,provider,endpoint,request_path_prefix,cost_micro_usd) values (''x4'',''fal'',''a/b'',''/a/b'',5000001)',
    'insert into private.generation_models(model_key,provider,endpoint,request_path_prefix,cost_micro_usd) values (''x5'',''fal'',''a/b'',''/a/b'',0)',
    'insert into private.generation_models(model_key,provider,endpoint,request_path_prefix,enabled) values (''x6'',''fal'',''a/b'',''/a/b'',true)'
  ] loop
    begin
      execute statement;
      raise exception 'Invalid catalog row accepted: %', statement;
    exception when check_violation then null; end;
  end loop;
end $$;

-- Table-level guarantees on generation_jobs.
do $$ begin
  if (select count(*) from public.generation_jobs where (provider_request_path is null) <> (provider_request_id is null)) <> 0 then
    raise exception 'provider_request_id backfill inconsistent'; end if;
  if not has_column_privilege('authenticated','public.generation_jobs','model','SELECT') then raise exception 'Model not readable by participants'; end if;
  if has_column_privilege('authenticated','public.generation_jobs','provider','SELECT')
    or has_column_privilege('authenticated','public.generation_jobs','provider_request_id','SELECT')
    or has_column_privilege('authenticated','public.generation_jobs','provider_request_path','SELECT') then raise exception 'Provider internals readable by clients'; end if;
  if has_column_privilege('authenticated','public.generation_jobs','model','INSERT') or has_column_privilege('authenticated','public.generation_jobs','model','UPDATE')
    or has_column_privilege('authenticated','public.generation_jobs','provider_request_id','UPDATE') then raise exception 'Client can write model internals'; end if;
  -- Function privileges.
  if has_function_privilege('anon','public.create_generation_job(uuid,uuid,text,text)','EXECUTE')
    or has_function_privilege('anon','private.create_generation_job_internal(uuid,uuid,text,text)','EXECUTE')
    or not has_function_privilege('authenticated','public.create_generation_job(uuid,uuid,text,text)','EXECUTE')
    or not has_function_privilege('authenticated','private.create_generation_job_internal(uuid,uuid,text,text)','EXECUTE') then
    raise exception 'create_generation_job grants wrong'; end if;
  if not has_function_privilege('authenticated','public.create_generation_job(uuid,uuid,text)','EXECUTE')
    or has_function_privilege('anon','public.create_generation_job(uuid,uuid,text)','EXECUTE') then raise exception '3-arg create grants changed'; end if;
  if has_function_privilege('anon','public.claim_generation_jobs(integer)','EXECUTE') or has_function_privilege('authenticated','public.claim_generation_jobs(integer)','EXECUTE')
    or has_function_privilege('anon','public.claim_generation_job_for_view(uuid,uuid)','EXECUTE') or has_function_privilege('authenticated','public.claim_generation_job_for_view(uuid,uuid)','EXECUTE')
    or not has_function_privilege('service_role','public.claim_generation_jobs(integer)','EXECUTE')
    or not has_function_privilege('service_role','public.claim_generation_job_for_view(uuid,uuid)','EXECUTE') then raise exception 'claim grants wrong'; end if;
  if has_function_privilege('anon','public.set_generation_model_price(text,bigint,boolean)','EXECUTE')
    or has_function_privilege('authenticated','public.set_generation_model_price(text,bigint,boolean)','EXECUTE')
    or not has_function_privilege('service_role','public.set_generation_model_price(text,bigint,boolean)','EXECUTE') then raise exception 'set_generation_model_price grants wrong'; end if;
  if pg_get_function_result('public.claim_generation_jobs(integer)'::regprocedure) not like '%output_storage_path text, provider text, model text)'
    or pg_get_function_result('public.claim_generation_job_for_view(uuid,uuid)'::regprocedure) not like '%output_storage_path text, provider text, model text)' then
    raise exception 'Claim outputs lack provider/model'; end if;
  if has_table_privilege('anon','private.generation_models','SELECT') or has_table_privilege('authenticated','private.generation_models','SELECT')
    or has_table_privilege('authenticated','private.generation_models','INSERT') or has_table_privilege('authenticated','private.generation_models','UPDATE')
    or not has_table_privilege('service_role','private.generation_models','SELECT') or not has_table_privilege('service_role','private.generation_models','UPDATE') then
    raise exception 'Catalog table privileges wrong'; end if;
end $$;

-- The catalog is invisible to clients.
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111"}',true);
do $$ begin
  begin perform 1 from private.generation_models; raise exception 'Authenticated read the catalog';
  exception when insufficient_privilege then null; end;
  begin perform public.set_generation_model_price('ltx',1,true); raise exception 'Authenticated priced a model';
  exception when insufficient_privilege then null; end;
end $$;
set local role anon;
do $$ begin
  begin perform 1 from private.generation_models; raise exception 'Anon read the catalog';
  exception when insufficient_privilege then null; end;
end $$;

-- Authenticated enqueue: priced models, idempotency, unavailable models.
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111"}',true);
do $$ declare first_id uuid; replay_id uuid; replayed boolean; created boolean; msg text; model_name text; begin
  select job_id, was_reused into first_id, replayed from public.create_generation_job(
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','c0c0c001-0000-4000-8000-000000000001','Multimodel ltx prompt one','ltx');
  if first_id is null or replayed then raise exception 'ltx job not created'; end if;
  select job_id, was_reused into replay_id, replayed from public.create_generation_job(
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','c0c0c001-0000-4000-8000-000000000001','  Multimodel ltx prompt one  ','ltx');
  if replay_id <> first_id or not replayed then raise exception 'Same-model replay was not idempotent'; end if;
  -- Same key with another model, project or prompt is a conflict.
  msg := null;
  begin perform * from public.create_generation_job('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','c0c0c001-0000-4000-8000-000000000001','Multimodel ltx prompt one','minimax');
  exception when unique_violation then msg := sqlerrm; end;
  if msg is distinct from 'Idempotency key conflict' then raise exception 'Idempotency key reused across models: %', msg; end if;
  msg := null;
  begin perform * from public.create_generation_job('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','c0c0c001-0000-4000-8000-000000000001','Multimodel ltx prompt one','Lightricks/LTX-Video-0.9.7-distilled');
  exception when unique_violation then msg := sqlerrm; end;
  if msg is distinct from 'Idempotency key conflict' then raise exception 'Idempotency key reused across ltx and legacy model: %', msg; end if;
  -- 3-arg legacy replay of a 4-arg ltx key conflicts too.
  msg := null;
  begin perform * from public.create_generation_job('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','c0c0c001-0000-4000-8000-000000000001','Multimodel ltx prompt one');
  exception when unique_violation then msg := sqlerrm; end;
  if msg is distinct from 'Idempotency key conflict' then raise exception '3-arg replay of a model-specific key accepted: %', msg; end if;

  perform * from public.create_generation_job('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','c0c0c002-0000-4000-8000-000000000002','Multimodel minimax prompt','minimax');
  perform * from public.create_generation_job('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','c0c0c003-0000-4000-8000-000000000003','Multimodel legacy prompt');
  perform * from public.create_generation_job('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','c0c0c004-0000-4000-8000-000000000004','Multimodel ltx prompt two','ltx');

  -- Participants can read the model name but not provider internals.
  select model into model_name from public.generation_jobs where id=first_id;
  if model_name is distinct from 'ltx' then raise exception 'Participant cannot read model'; end if;
  begin perform provider from public.generation_jobs; raise exception 'Client read provider column';
  exception when insufficient_privilege then null; end;
  begin perform provider_request_id from public.generation_jobs; raise exception 'Client read provider_request_id column';
  exception when insufficient_privilege then null; end;

  -- Unknown, disabled, unpriced and NULL models are unavailable and reserve nothing.
  foreach model_name in array array['nope','kling','seedance','LTX','','Lightricks/LTX-Video-0.9.7-distilled-x'] loop
    msg := null;
    begin perform * from public.create_generation_job('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','c0c0c0ff-0000-4000-8000-0000000000ff','Unavailable model prompt',model_name);
    exception when invalid_parameter_value then msg := sqlerrm; end;
    if msg is distinct from 'Generation model unavailable' then raise exception 'Model % was not rejected as unavailable: %', model_name, msg; end if;
  end loop;
  msg := null;
  begin perform * from public.create_generation_job('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','c0c0c0ff-0000-4000-8000-0000000000ff','Unavailable model prompt',null);
  exception when invalid_parameter_value then msg := sqlerrm; end;
  if msg is distinct from 'Generation model unavailable' then raise exception 'NULL model not rejected: %', msg; end if;
end $$;
-- Outsiders fail authorization before any catalog decision.
select set_config('request.jwt.claims','{"sub":"33333333-3333-4333-8333-333333333333"}',true);
do $$ begin
  begin perform * from public.create_generation_job('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','c0c0c0aa-0000-4000-8000-0000000000aa','Outsider model prompt','ltx');
    raise exception 'Outsider created a multimodel job';
  exception when insufficient_privilege then null; end;
end $$;

-- Persisted rows, reservations and budget (service role).
set local role service_role;
do $$ begin
  if (select count(*) from public.generation_jobs where client_request_id::text like 'c0c0c0%') <> 4 then raise exception 'Unavailable models or replays created jobs'; end if;
  if not exists(select 1 from public.generation_jobs where client_request_id='c0c0c001-0000-4000-8000-000000000001' and provider='fal' and model='ltx' and reservation_micro_usd=50000 and dispatch_state='queued') then raise exception 'ltx job row wrong'; end if;
  if not exists(select 1 from public.generation_jobs where client_request_id='c0c0c002-0000-4000-8000-000000000002' and provider='fal' and model='minimax' and reservation_micro_usd=50000) then raise exception 'minimax job row wrong'; end if;
  if not exists(select 1 from public.generation_jobs where client_request_id='c0c0c003-0000-4000-8000-000000000003' and provider='fal-ai' and model='Lightricks/LTX-Video-0.9.7-distilled' and reservation_micro_usd=50000) then raise exception '3-arg job did not map to the legacy model'; end if;
  if (select reserved_micro_usd from private.generation_budget_daily where bucket_user='11111111-1111-4111-8111-111111111111' and usage_day=(clock_timestamp() at time zone 'UTC')::date)<>200000 then raise exception 'Per-job reservations not summed'; end if;
  if (select count(*) from private.generation_output_reservations r join public.generation_jobs j on j.id=r.job_id where j.client_request_id::text like 'c0c0c0%')<>4 then raise exception 'Output reservations missing'; end if;
  -- Integrity constraints on the jobs table.
  begin update public.generation_jobs set provider='bogus' where client_request_id='c0c0c001-0000-4000-8000-000000000001'; raise exception 'Unknown provider accepted';
  exception when foreign_key_violation then null; end;
  begin update public.generation_jobs set model='minimax' where client_request_id='c0c0c003-0000-4000-8000-000000000003'; raise exception 'Provider/model mismatch accepted';
  exception when foreign_key_violation then null; end;
  begin update public.generation_jobs set reservation_micro_usd=5000001 where client_request_id='c0c0c001-0000-4000-8000-000000000001'; raise exception 'Reservation above cap accepted';
  exception when check_violation then null; end;
  update public.generation_jobs set reservation_micro_usd=5000000,charged_micro_usd=5000000 where client_request_id='c0c0c004-0000-4000-8000-000000000004';
  update public.generation_jobs set reservation_micro_usd=50000,charged_micro_usd=0 where client_request_id='c0c0c004-0000-4000-8000-000000000004';
  begin update public.generation_jobs set provider_request_id='orphan' where client_request_id='c0c0c001-0000-4000-8000-000000000001'; raise exception 'Request id without path accepted';
  exception when check_violation then null; end;
  begin update public.generation_jobs set provider_request_path='/fal-ai/ltx-video/requests/x' where client_request_id='c0c0c001-0000-4000-8000-000000000001'; raise exception 'Path without request id accepted';
  exception when check_violation then null; end;
  begin delete from private.generation_models where model_key='ltx'; raise exception 'Referenced catalog delete accepted';
  exception when foreign_key_violation then null; end;
end $$;

-- Claim: outputs carry provider/model; submissions are validated per catalog entry.
do $$ declare r record; ltx_job uuid; ltx_job2 uuid; mm_job uuid; legacy_job uuid; lease uuid; saw_ltx boolean:=false; saw_legacy boolean:=false; msg text; begin
  select id into ltx_job from public.generation_jobs where client_request_id='c0c0c001-0000-4000-8000-000000000001';
  select id into mm_job from public.generation_jobs where client_request_id='c0c0c002-0000-4000-8000-000000000002';
  select id into legacy_job from public.generation_jobs where client_request_id='c0c0c003-0000-4000-8000-000000000003';
  select id into ltx_job2 from public.generation_jobs where client_request_id='c0c0c004-0000-4000-8000-000000000004';
  for r in select * from public.claim_generation_jobs(8) loop
    if r.job_id=ltx_job then saw_ltx := (r.provider='fal' and r.model='ltx'); end if;
    if r.job_id=legacy_job then saw_legacy := (r.provider='fal-ai' and r.model='Lightricks/LTX-Video-0.9.7-distilled'); end if;
  end loop;
  if not saw_ltx or not saw_legacy then raise exception 'claim_generation_jobs did not return provider/model'; end if;

  -- ltx job: wrong prefix and malformed paths rejected, correct prefix stores the id.
  select lease_token into lease from public.generation_jobs where id=ltx_job;
  foreach msg in array array['/fal-ai/minimax/requests/abc123','/fal-ai/ltx-video-13b-distilled/requests/abc123','/fal-ai/ltx-video/requests/','/fal-ai/ltx-video/requests/a/b','/fal-ai/ltx-video/../requests/abc','/requests/abc123','/fal-ai/ltx-videoX/requests/abc123'] loop
    begin perform public.record_generation_submission(ltx_job,lease,msg); raise exception 'Bad provider path accepted: %', msg;
    exception when invalid_parameter_value then null; end;
  end loop;
  if exists(select 1 from public.generation_jobs where id=ltx_job and provider_request_path is not null) then raise exception 'Rejected path was persisted'; end if;
  if not public.record_generation_submission(ltx_job,lease,'/fal-ai/ltx-video/requests/req_ltx-1') then raise exception 'Valid ltx path rejected'; end if;
  if not exists(select 1 from public.generation_jobs where id=ltx_job and provider_request_id='req_ltx-1' and dispatch_state='submitted' and provider_request_path='/fal-ai/ltx-video/requests/req_ltx-1') then raise exception 'provider_request_id not stored'; end if;

  -- Another job cannot reuse the same provider request id.
  select lease_token into lease from public.generation_jobs where id=ltx_job2;
  begin perform public.record_generation_submission(ltx_job2,lease,'/fal-ai/ltx-video/requests/req_ltx-1'); raise exception 'Duplicate provider request id accepted';
  exception when unique_violation then null; end;
  if not public.record_generation_submission(ltx_job2,lease,'/fal-ai/ltx-video/requests/req_ltx-2') then raise exception 'Second ltx path rejected'; end if;

  -- Legacy job keeps its original prefix and cannot take a Fal one.
  select lease_token into lease from public.generation_jobs where id=legacy_job;
  begin perform public.record_generation_submission(legacy_job,lease,'/fal-ai/ltx-video/requests/legacy1'); raise exception 'Legacy job accepted a Fal path';
  exception when invalid_parameter_value then null; end;
  if not public.record_generation_submission(legacy_job,lease,'/fal-ai/ltx-video-13b-distilled/requests/legacy1') then raise exception 'Legacy path rejected'; end if;
  if not exists(select 1 from public.generation_jobs where id=legacy_job and provider_request_id='legacy1') then raise exception 'Legacy request id not stored'; end if;

  -- minimax job: ack lost -> uncertain -> reconcile by catalog-validated path.
  update public.generation_jobs set lease_until=clock_timestamp()-interval '1 second' where id=mm_job;
  perform * from public.claim_generation_jobs(1);
  if not exists(select 1 from public.generation_jobs where id=mm_job and status='running' and dispatch_state='uncertain' and provider_request_path is null and provider_request_id is null) then raise exception 'minimax job did not become uncertain'; end if;
  begin perform public.reconcile_generation_submission(mm_job,true,'/fal-ai/ltx-video/requests/mm1'); raise exception 'Reconcile accepted another model prefix';
  exception when invalid_parameter_value then null; end;
  begin perform public.reconcile_generation_submission(mm_job,true,null); raise exception 'Reconcile accepted a null path';
  exception when invalid_parameter_value then null; end;
  if not exists(select 1 from public.generation_jobs where id=mm_job and dispatch_state='uncertain' and provider_request_path is null) then raise exception 'Rejected reconcile changed the job'; end if;
  if not public.reconcile_generation_submission(mm_job,true,'/fal-ai/minimax/requests/mm-123_x') then raise exception 'Valid minimax reconcile rejected'; end if;
  if not exists(select 1 from public.generation_jobs where id=mm_job and dispatch_state='submitted' and provider_request_id='mm-123_x' and provider_request_path='/fal-ai/minimax/requests/mm-123_x') then raise exception 'Reconcile did not set provider_request_id'; end if;
end $$;

-- Operator pricing: validation, enabling and per-model reservations.
do $$ declare msg text; begin
  foreach msg in array array['kling:0:true','kling:5000001:true','kling::true','nope:1:true','kling:100:'] loop
    begin
      perform public.set_generation_model_price(split_part(msg,':',1), nullif(split_part(msg,':',2),'')::bigint, nullif(split_part(msg,':',3),'')::boolean);
      raise exception 'Invalid price call accepted: %', msg;
    exception when invalid_parameter_value or no_data_found then null; end;
  end loop;
  perform public.set_generation_model_price('kling',70000,true);
  perform public.set_generation_model_price('ltx',120000,true);
  if not exists(select 1 from private.generation_models where model_key='kling' and cost_micro_usd=70000 and enabled) then raise exception 'Price not stored'; end if;
  begin perform public.set_generation_model_price('nope',1,true); raise exception 'Unknown model priced';
  exception when no_data_found then null; end;
end $$;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111"}',true);
do $$ begin
  perform * from public.create_generation_job('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','c0c0c005-0000-4000-8000-000000000005','Multimodel kling prompt','kling');
  perform * from public.create_generation_job('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','c0c0c006-0000-4000-8000-000000000006','Multimodel repriced ltx','ltx');
  perform * from public.create_generation_job('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','c0c0c007-0000-4000-8000-000000000007','Multimodel view claim prompt','minimax');
end $$;
set local role service_role;
do $$ declare r record; view_job uuid; saw boolean := false; begin
  if not exists(select 1 from public.generation_jobs where client_request_id='c0c0c005-0000-4000-8000-000000000005' and model='kling' and reservation_micro_usd=70000) then raise exception 'kling reservation not the catalog price'; end if;
  if not exists(select 1 from public.generation_jobs where client_request_id='c0c0c006-0000-4000-8000-000000000006' and model='ltx' and reservation_micro_usd=120000) then raise exception 'Repriced ltx reservation wrong'; end if;
  if not exists(select 1 from public.generation_jobs where client_request_id='c0c0c001-0000-4000-8000-000000000001' and reservation_micro_usd=50000) then raise exception 'Repricing changed an existing reservation'; end if;
  if (select reserved_micro_usd from private.generation_budget_daily where bucket_user='11111111-1111-4111-8111-111111111111' and usage_day=(clock_timestamp() at time zone 'UTC')::date)<>440000 then raise exception 'Budget reservation total wrong after repricing'; end if;
  select id into view_job from public.generation_jobs where client_request_id='c0c0c007-0000-4000-8000-000000000007';
  for r in select * from public.claim_generation_job_for_view(view_job,'11111111-1111-4111-8111-111111111111') loop
    saw := (r.job_id=view_job and r.provider='fal' and r.model='minimax');
  end loop;
  if not saw then raise exception 'claim_generation_job_for_view did not return provider/model'; end if;
  -- Disabling a model stops new jobs but not replays of existing keys.
  perform public.set_generation_model_price('minimax',50000,false);
end $$;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111"}',true);
do $$ declare msg text; replayed boolean; begin
  begin perform * from public.create_generation_job('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','c0c0c008-0000-4000-8000-000000000008','Multimodel disabled prompt','minimax');
    raise exception 'Disabled model accepted';
  exception when invalid_parameter_value then null; end;
  select was_reused into replayed from public.create_generation_job('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','c0c0c007-0000-4000-8000-000000000007','Multimodel view claim prompt','minimax');
  if not replayed then raise exception 'Replay of an existing job failed after the model was disabled'; end if;
  -- A model priced above the remaining personal budget is refused with the budget error.
end $$;
set local role service_role;
select public.set_generation_model_price('kling',5000000,true);
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111"}',true);
do $$ declare msg text; begin
  begin perform * from public.create_generation_job('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','c0c0c009-0000-4000-8000-000000000009','Multimodel too expensive','kling');
  exception when sqlstate 'P0001' then msg := sqlerrm; end;
  if msg is distinct from 'Personal daily generation limit reached' and msg is distinct from 'Daily generation budget exhausted' then
    raise exception 'Expensive model not refused by the budget: %', msg; end if;
end $$;

-- Cancelling after a reprice releases the stored reservation, not the catalog price.
set local role service_role;
select public.set_generation_model_price('ltx',50000,true);
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111"}',true);
select * from public.cancel_generation_job((select id from public.generation_jobs where input->>'prompt'='Multimodel repriced ltx'));
set local role service_role;
do $$ begin
  if (select reserved_micro_usd from private.generation_budget_daily where bucket_user='11111111-1111-4111-8111-111111111111' and usage_day=(clock_timestamp() at time zone 'UTC')::date)<>320000 then
    raise exception 'Cancel did not release the stored 120000 reservation'; end if;
  if not exists(select 1 from public.generation_jobs where client_request_id='c0c0c006-0000-4000-8000-000000000006' and status='cancelled' and reservation_micro_usd=0 and charged_micro_usd=0) then
    raise exception 'Repriced cancelled job not settled'; end if;
end $$;

-- A queued/leased job whose model was disabled is closed without charge at dispatch authorization
-- (the view-claimed minimax job above is leased and its model is now disabled).
do $$ declare j uuid; lease uuid; begin
  select id,lease_token into j,lease from public.generation_jobs where client_request_id='c0c0c007-0000-4000-8000-000000000007';
  if public.authorize_generation_dispatch(j,lease) then raise exception 'Disabled model was authorized for dispatch'; end if;
  if not exists(select 1 from public.generation_jobs where id=j and status='failed' and dispatch_state='finalized' and last_error_code='model_disabled' and reservation_micro_usd=0 and charged_micro_usd=0 and lease_token is null) then
    raise exception 'Disabled-model job not finalized without charge'; end if;
  if exists(select 1 from private.generation_output_reservations where job_id=j) then raise exception 'Disabled-model job kept its output reservation'; end if;
  if (select reserved_micro_usd from private.generation_budget_daily where bucket_user='11111111-1111-4111-8111-111111111111' and usage_day=(clock_timestamp() at time zone 'UTC')::date)<>270000 then
    raise exception 'Disabled-model job kept its budget reservation'; end if;
  -- Submitted jobs are unaffected by disabling (ltx job already has a request path; claim state untouched).
  if not exists(select 1 from public.generation_jobs where client_request_id='c0c0c001-0000-4000-8000-000000000001' and provider_request_id='req_ltx-1' and status='running') then
    raise exception 'Submitted job was disturbed'; end if;
end $$;

-- The private 4-arg entry point is not callable by anon or by outsiders.
set local role anon;
do $$ begin
  begin perform * from private.create_generation_job_internal('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','c0c0c0bb-0000-4000-8000-0000000000bb','Direct anon call prompt','ltx');
    raise exception 'Anon called the private 4-arg function';
  exception when insufficient_privilege then null; end;
end $$;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"33333333-3333-4333-8333-333333333333"}',true);
do $$ begin
  begin perform * from private.create_generation_job_internal('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','c0c0c0bc-0000-4000-8000-0000000000bc','Direct outsider call prompt','ltx');
    raise exception 'Outsider called the private 4-arg function';
  exception when insufficient_privilege then null; end;
end $$;
rollback;
