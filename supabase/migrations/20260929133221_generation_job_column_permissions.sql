-- RLS chooses eligible projects; column privileges protect worker-owned fields.
revoke all on public.generation_jobs from public, anon, authenticated;
revoke insert (id,project_id,requested_by,status,input,output,error_message,created_at,updated_at,completed_at),
  update (id,project_id,requested_by,status,input,output,error_message,created_at,updated_at,completed_at),
  references (id,project_id,requested_by,status,input,output,error_message,created_at,updated_at,completed_at)
on public.generation_jobs from public, anon, authenticated;
grant select on public.generation_jobs to authenticated;
grant insert (project_id,requested_by,input) on public.generation_jobs to authenticated;
grant select, insert, update on public.generation_jobs to service_role;
drop policy "generation_jobs: owners and editors update" on public.generation_jobs;
-- Cancellation will need its own authorized state-transition RPC, not row UPDATE.
