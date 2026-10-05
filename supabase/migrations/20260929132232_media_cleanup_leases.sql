-- Worker RPCs are invoker functions: only the trusted service role can use them.
grant usage on schema private to service_role;
grant select, update on private.media_deletion_outbox to service_role;
grant select on public.assets, public.asset_versions to service_role;

create function public.claim_media_cleanup()
returns table(id uuid, project_id uuid, lease_token uuid, bucket_id text, object_path text, attempts integer)
language sql volatile security invoker set search_path = '' as $$
  update private.media_deletion_outbox q
  set lease_token = gen_random_uuid(), lease_until = clock_timestamp() + interval '120 seconds',
      attempts = q.attempts + 1
  where q.id = (
    select candidate.id from private.media_deletion_outbox candidate
    where candidate.completed_at is null and candidate.available_at <= clock_timestamp()
      and (candidate.lease_until is null or candidate.lease_until <= clock_timestamp())
      and candidate.attempts < 2147483647
    order by candidate.available_at, candidate.created_at, candidate.id
    limit 1 for update skip locked
  )
  returning q.id, q.project_id, q.lease_token, q.bucket_id, q.object_path, q.attempts;
$$;

create function public.inspect_media_cleanup(job_id uuid, token uuid)
returns text language plpgsql volatile security invoker set search_path = '' as $$
declare queued private.media_deletion_outbox;
begin
  select * into queued from private.media_deletion_outbox q
  where q.id = job_id and q.lease_token = token and q.completed_at is null
    and q.lease_until > clock_timestamp() for update;
  if not found then return 'stale'; end if;
  if exists(select 1 from public.assets a where a.storage_path = queued.object_path)
    or exists(select 1 from public.asset_versions v where v.storage_path = queued.object_path)
  then return 'referenced'; end if;
  update private.media_deletion_outbox set lease_until = clock_timestamp() + interval '120 seconds'
  where id = job_id;
  return 'ready';
end $$;

create function public.finish_media_cleanup(job_id uuid, token uuid, failure text default null, delay_seconds integer default 30)
returns boolean language plpgsql volatile security invoker set search_path = '' as $$
begin
  if failure is not null and failure not in ('referenced','storage_failed','verification_failed') then
    raise exception 'Invalid cleanup failure code' using errcode = '22023';
  end if;
  if delay_seconds is null or delay_seconds < 30 or delay_seconds > 3600 then
    raise exception 'Invalid retry delay' using errcode = '22023';
  end if;
  update private.media_deletion_outbox q
  set completed_at = case when failure is null then clock_timestamp() else null end,
      available_at = case when failure is not null then clock_timestamp() + make_interval(secs => delay_seconds) else q.available_at end,
      last_error = failure, lease_token = null, lease_until = null
  where q.id = job_id and q.lease_token = token and q.completed_at is null
    and q.lease_until > clock_timestamp();
  return found;
end $$;

revoke all on function public.claim_media_cleanup() from public, anon, authenticated;
revoke all on function public.inspect_media_cleanup(uuid, uuid) from public, anon, authenticated;
revoke all on function public.finish_media_cleanup(uuid, uuid, text, integer) from public, anon, authenticated;
grant execute on function public.claim_media_cleanup() to service_role;
grant execute on function public.inspect_media_cleanup(uuid, uuid) to service_role;
grant execute on function public.finish_media_cleanup(uuid, uuid, text, integer) to service_role;
