# Resolving an uncertain generation

A job gets `dispatch_state = 'uncertain'` when the provider submit may have
reached fal.ai but the acknowledgement was lost. The worker never resends it
automatically, because a second submit can be billed twice. Users see the job
as "Outcome unknown" in `/generations` and are told not to resubmit.

Only an operator with service-role access resolves it, one job at a time.

1. Find the job. In the Supabase SQL editor:

   ```sql
   select id, project_id, requested_by, provider, model, created_at, uncertain_at, last_error_code
   from public.generation_jobs
   where status = 'running' and dispatch_state = 'uncertain'
   order by uncertain_at;
   ```

2. Check the provider dashboard for a request created around `uncertain_at`
   for this job's `provider`/`model`. Do not submit anything to the provider
   while checking. The model catalog (`private.generation_models`, service
   role only) gives the expected path prefix for the model:

   ```sql
   select model_key, provider, endpoint, request_path_prefix, cost_micro_usd, enabled
   from private.generation_models order by model_key;
   ```

   The request path is `<request_path_prefix>/requests/<request id>`, for
   example `/fal-ai/minimax/requests/<request id>` for `minimax`. The worker
   logs `{jobId, model, requestId}` before it persists a submission, so a
   request id found in the provider dashboard or the logs can be matched to a
   job. After reconciliation `generation_jobs.provider_request_id` holds the
   id; to check whether an id is already attached to a job:

   ```sql
   select id, status, dispatch_state from public.generation_jobs
   where provider = '<provider>' and provider_request_id = '<request id>';
   ```

3. Record the outcome with the existing RPC (service role only):

   - The provider accepted it and you have its request path:

     ```sql
     select public.reconcile_generation_submission(
       '<job id>', true, '<request_path_prefix>/requests/<request id>');
     ```

     The path must start with the job's catalog prefix (a mismatch is
     rejected with `Invalid provider request path`), and the same request id
     cannot be attached to two jobs of one provider. Legacy jobs use
     `/fal-ai/ltx-video-13b-distilled/requests/<request id>`.

     The job returns to `submitted` (or `cancelling` if the user asked to
     cancel) and the worker resumes polling it.

   - The provider has no such request:

     ```sql
     select public.reconcile_generation_submission('<job id>', false);
     ```

     The job becomes `failed`, its budget reservation is released with zero
     spend and its output reservation is removed. The user may then start a
     new generation themselves.

4. The function returns `false` if the job is no longer `running` +
   `uncertain` (someone resolved it already). Re-run step 1 instead of
   retrying.

A duplicate `provider_request_id` is a different problem: if
`record_generation_submission` fails with a unique violation (23505) the worker
marks the job uncertain with `submit_ack_persist_failed`. That means the
provider returned a request id already attached to another job. Escalate; do
not force-reconcile it with that id.

If the provider state cannot be determined, leave the job uncertain. Do not
guess `false`: if the request was in fact accepted, the result would arrive
for a job already marked failed.
