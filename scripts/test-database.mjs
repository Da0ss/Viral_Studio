import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

// In-memory PostgreSQL only. These fixtures model Supabase-owned schemas, not
// the HTTP Auth/Storage services. Never accepts a remote database connection.
const db = new PGlite({ extensions: { pgcrypto } });
const root = new URL('../', import.meta.url);
try {
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$
      select (current_setting('request.jwt.claims', true)::jsonb ->> 'sub')::uuid;
    $$;
    grant usage on schema auth to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
    create schema storage;
    create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text not null);
    alter table storage.objects enable row level security;
    create function storage.foldername(name text) returns text[] language sql immutable as $$
      select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1)-1];
    $$;
    grant usage on schema storage to authenticated;
    grant all on storage.objects to authenticated;
    -- Supabase installs default Data API privileges before user migrations.
    alter default privileges in schema public grant all on tables to authenticated;
    grant usage on schema public to authenticated;
    create publication supabase_realtime;
  `);
  const directory = new URL('supabase/migrations/', root);
  const files = (await readdir(directory)).filter(file => file.endsWith('.sql')).sort();
  for (const file of files) {
    await db.exec(await readFile(new URL(file, directory), 'utf8'));
    console.log(`Applied ${file}`);
  }
  await db.exec(`insert into auth.users(id,email) values
    ('11111111-1111-4111-8111-111111111111','owner@example.invalid'),
    ('22222222-2222-4222-8222-222222222222','viewer@example.invalid'),
    ('33333333-3333-4333-8333-333333333333','outsider@example.invalid');`);
  await db.exec(await readFile(new URL('supabase/seed.sql', root), 'utf8'));
  const testDirectory = new URL('supabase/tests/', root);
  const tests = (await readdir(testDirectory)).filter(file => file.endsWith('_acceptance.sql')).sort();
  if (!tests.length) throw new Error('No SQL acceptance files discovered');
  for (const file of tests) {
    await db.exec(await readFile(new URL(file, testDirectory), 'utf8'));
    console.log(`Passed ${file}`);
  }
  console.log(`PASS: ${files.length} unmodified migrations; ${tests.length} SQL acceptance files on fresh PGlite (Supabase services are not exercised).`);
} catch (error) {
  console.error(`FAIL: ${error.message} (${error.code ?? 'no SQLSTATE'})`);
  process.exitCode = 1;
} finally {
  await db.close();
}
