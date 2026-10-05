-- The ordinary editor is not a cross-tenant migration API.
revoke update on public.projects from public, anon, authenticated;
revoke update (id,organization_id,name,description,status,created_by,created_at,updated_at,type)
on public.projects from public, anon, authenticated;
grant update (name,description,status,type) on public.projects to authenticated;
-- Membership guards update parent timestamps as internal owner-only triggers.
