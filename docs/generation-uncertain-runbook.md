# Resolving an uncertain generation

A job gets `dispatch_state = 'uncertain'` when the provider submit may have
reached fal.ai but the acknowledgement was lost. The worker never resends it
automatically, because a second submit can be billed twice. Users see the job
as "Outcome unknown" in `/generations` and are told not to resubmit.

Only an operator with service-role access resolves it, one job at a time.

1. Find the job. In the Supabase SQL editor:

   ```sql
   select id, project_id, requested_by, created_at, uncertain_at, last_error_code
   from public.generation_jobs
   where status = 'running' and dispatch_state = 'uncertain'
   order by uncertain_at;
   ```

2. Check the provider dashboard for a request created around `uncertain_at`
   for this job. Do not submit anything to the provider while checking.

3. Record the outcome with the existing RPC (service role only):

   - The provider accepted it and you have its request path:

     ```sql
     select public.reconcile_generation_submission(
       '<job id>', true, '/fal-ai/ltx-video-13b-distilled/requests/<request id>');
     ```

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

If the provider state cannot be determined, leave the job uncertain. Do not
guess `false`: if the request was in fact accepted, the result would arrive
for a job already marked failed.
