-- Keep the database constraint aligned with the chat UI and expose only this
-- already RLS-protected table to Postgres Changes.
alter table public.messages drop constraint if exists messages_body_check;
alter table public.messages add constraint messages_body_4000_check
  check (char_length(trim(body)) between 1 and 4000);

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;
end
$$;
