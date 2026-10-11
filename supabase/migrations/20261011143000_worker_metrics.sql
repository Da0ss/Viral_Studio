-- Aggregate queue health only. This RPC must never expose per-job data.
create function public.get_worker_metrics()
returns jsonb
language sql stable security invoker set search_path = '' as $$
with clock as (
  select statement_timestamp() as captured_at, (statement_timestamp() at time zone 'UTC')::date as utc_day
), cleanup as (
  select
    count(*) filter (where q.completed_at is null) as depth,
    count(*) filter (where q.completed_at is null and q.available_at <= c.captured_at
      and (q.lease_until is null or q.lease_until <= c.captured_at) and q.attempts < 2147483647) as ready,
    count(*) filter (where q.completed_at is null and q.attempts > 0) as retry,
    min(q.created_at) filter (where q.completed_at is null and q.available_at <= c.captured_at
      and (q.lease_until is null or q.lease_until <= c.captured_at) and q.attempts < 2147483647) as oldest_ready
  from private.media_deletion_outbox q cross join clock c
), upload_reconcile as (
  select
    count(*) filter (where i.state in ('uploading','cleanup_pending')) as depth,
    count(*) filter (where i.reconcile_after <= c.captured_at and (i.lease_until is null or i.lease_until <= c.captured_at)
      and (i.state = 'uploading' or (i.state = 'cleanup_pending' and i.available_at <= c.captured_at))) as ready,
    count(*) filter (where i.state = 'cleanup_pending') as retry,
    min(i.created_at) filter (where i.reconcile_after <= c.captured_at and (i.lease_until is null or i.lease_until <= c.captured_at)
      and (i.state = 'uploading' or (i.state = 'cleanup_pending' and i.available_at <= c.captured_at))) as oldest_ready
  from private.media_upload_intents i cross join clock c
), generation as (
  select
    count(*) filter (where j.status in ('queued','running')) as depth,
    count(*) filter (where
      (j.status = 'queued' and j.dispatch_state = 'queued' and j.next_attempt_at <= c.captured_at and j.lease_token is null)
      or (j.status = 'running' and j.dispatch_state in ('submitted','polling','cancelling')
        and j.next_attempt_at <= c.captured_at and (j.lease_until is null or j.lease_until <= c.captured_at))) as ready,
    count(*) filter (where j.status = 'running' and j.dispatch_state in ('submitted','polling','cancelling')
      and j.attempt_count > 0) as retry,
    count(*) filter (where j.status = 'running' and j.dispatch_state = 'uncertain') as uncertain,
    min(j.created_at) filter (where
      (j.status = 'queued' and j.dispatch_state = 'queued' and j.next_attempt_at <= c.captured_at and j.lease_token is null)
      or (j.status = 'running' and j.dispatch_state in ('submitted','polling','cancelling')
        and j.next_attempt_at <= c.captured_at and (j.lease_until is null or j.lease_until <= c.captured_at))) as oldest_ready
  from public.generation_jobs j cross join clock c
), budget as (
  select s.daily_global_micro_usd as daily_limit_micro_usd,
    coalesce(d.reserved_micro_usd, 0) as reserved_micro_usd,
    coalesce(d.spent_micro_usd, 0) as spent_micro_usd
  from private.generation_budget_settings s cross join clock c
  left join private.generation_budget_daily d on d.usage_day = c.utc_day
    and d.bucket_user = '00000000-0000-0000-0000-000000000000'::uuid
  where s.singleton
), stamp as (
  select captured_at from clock
)
select jsonb_build_object(
  'generated_at', stamp.captured_at,
  'queues', jsonb_build_object(
    'media_cleanup', jsonb_build_object(
      'depth', cleanup.depth, 'ready', cleanup.ready, 'retry', cleanup.retry, 'uncertain', 0,
      'oldest_ready_age_seconds', case when cleanup.oldest_ready is null then null
        else greatest(0, floor(extract(epoch from (stamp.captured_at - cleanup.oldest_ready))))::bigint end),
    'media_upload_reconcile', jsonb_build_object(
      'depth', upload_reconcile.depth, 'ready', upload_reconcile.ready, 'retry', upload_reconcile.retry, 'uncertain', 0,
      'oldest_ready_age_seconds', case when upload_reconcile.oldest_ready is null then null
        else greatest(0, floor(extract(epoch from (stamp.captured_at - upload_reconcile.oldest_ready))))::bigint end),
    'generation', jsonb_build_object(
      'depth', generation.depth, 'ready', generation.ready, 'retry', generation.retry,
      'uncertain', generation.uncertain,
      'oldest_ready_age_seconds', case when generation.oldest_ready is null then null
        else greatest(0, floor(extract(epoch from (stamp.captured_at - generation.oldest_ready))))::bigint end)
  ),
  'generation_budget', jsonb_build_object(
    'utc_day', (stamp.captured_at at time zone 'UTC')::date,
    'daily_limit_micro_usd', budget.daily_limit_micro_usd,
    'reserved_micro_usd', budget.reserved_micro_usd,
    'spent_micro_usd', budget.spent_micro_usd,
    'remaining_micro_usd', greatest(0, budget.daily_limit_micro_usd - budget.reserved_micro_usd - budget.spent_micro_usd)
  )
)
from cleanup cross join upload_reconcile cross join generation cross join budget cross join stamp;
$$;

revoke all on function public.get_worker_metrics() from public, anon, authenticated;
grant execute on function public.get_worker_metrics() to service_role;
