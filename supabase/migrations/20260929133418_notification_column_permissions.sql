-- Owners may mark their own inbox rows read, not forge producer content.
revoke all on public.notifications from public, anon, authenticated;
revoke insert (id,user_id,kind,title,body,project_id,read_at,created_at,updated_at,message_id),
  update (id,user_id,kind,title,body,project_id,read_at,created_at,updated_at,message_id),
  references (id,user_id,kind,title,body,project_id,read_at,created_at,updated_at,message_id)
on public.notifications from public, anon, authenticated;
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;
grant select, insert, update on public.notifications to service_role;
