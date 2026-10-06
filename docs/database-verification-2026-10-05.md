# Database and RLS verification — 2026-10-05

Follow-up implementation: CLI 2.119.0 and local configuration are now present,
with native SQL, HTTP/Realtime and concurrency runners plus a dedicated CI job.
See [supabase-integration.md](supabase-integration.md) for current commands and
evidence. The prerequisite observations below describe the earlier audit;
Docker/Podman and psql remain unavailable and full-stack acceptance is pending.

## Result

The repository has local SQL acceptance evidence, but clean-database verification
against a real Supabase stack and hosted RLS verification are still incomplete.
Do not mark database/RLS acceptance complete or use this report as a deployment
certificate.

`pnpm test:db` passed on 2026-10-05: 20 migration files were applied unchanged
and 14 SQL acceptance files ran in a fresh in-memory PGlite database. The test
harness in `scripts/test-database.mjs` dynamically sorts every `.sql` file in
`supabase/migrations/` and discovers every `*_acceptance.sql` file in
`supabase/tests/`, then loads the seed and runs the discovered suites. The new
`schema_security_acceptance.sql` checks catalog invariants including RLS on all
11 public tables, view security-invoker settings, security-definer exposure and
fixed search paths, and private avatar/project-media buckets.

On 2026-10-05, command discovery found no `supabase`, `docker`, or `psql`
executable on PATH, and the repository has no `supabase/config.toml`.
Therefore this environment could not start a clean Supabase stack, run
migration history commands, or submit the acceptance SQL to real PostgreSQL.
No migration was applied to a hosted project during this check.

## What the PGlite result establishes

The runner provides disposable PostgreSQL-compatible execution for the current
migrations and SQL invariants. Its explicit fixture defines minimal `auth` and
`storage` schemas, `auth.uid()`, application roles, a Realtime publication, and
the default public table grants assumed by the migrations. The identity rows
are inserted directly into the fixture; they are not accounts created through
Supabase Auth.

The 14 SQL suites in the passing run cover RLS and tenant isolation, onboarding
and Storage metadata, message notifications, project media, deletion outbox and
cleanup leases, generation-job and notification permissions, structural
privileges, owner membership, organization revocation, protected project
identity, and schema-level security catalog invariants. The tenant matrix suite
checks the complete eleven-table RLS inventory, representative cross-user and
cross-project reads/writes, and rollback of its fixtures.
Passing them demonstrates that these migration/test SQL scripts execute and
that their asserted cases hold under the modeled roles and schemas.

PGlite does not provide the Supabase Auth, Storage HTTP, Realtime, Data API, or
hosted migration services. This run does not establish that:

- migrations apply cleanly with Supabase-managed schemas, extensions, grants,
  database version, and migration history on an empty Supabase installation;
- hosted RLS, Storage object policies, bucket MIME/size enforcement, Auth
  sessions, or Realtime authorization/delivery work through their actual APIs;
- multi-connection locking, deadlock retries, or concurrent owner/admission/
  revocation flows behave correctly;
- hosted default privileges and existing project grants match the local model.

Migration and acceptance suite counts are discovered dynamically by the runner;
the count above records this run only. See `docs/database.md` and
`docs/testing.md` for the runner contract and this report for the current
verification boundary.

## Remaining verification steps

1. Prepare an isolated disposable copy of the repository, install/use the
   project-compatible Supabase CLI and Docker Desktop, then verify availability
   with `supabase --version`, `docker version`, and `psql --version`. Consult
   `supabase --help` and `supabase db --help` before choosing CLI commands.
   The repository has no `supabase/config.toml`; initialize/configure Supabase
   only in that disposable copy so setup does not silently change this project.
2. Review the seed prerequisite before resetting. `supabase/seed.sql` expects
   three Auth identities with fixed documented UUIDs, but a normal Auth API
   user creation returns its own ID. Do not run a default reset that executes
   this seed before those users exist. In the disposable copy, confirm from the
   installed CLI help how to reset without seeding, apply migrations to the
   empty local database, create test users through local Auth, then update the
   seed and SQL acceptance fixtures consistently to use the returned UUIDs
   before running the seed and acceptance suites. Never insert password-bearing
   Auth rows directly. A local DB reset destroys data in that disposable DB;
   never point it at production.
3. Inspect `supabase migration list --local` and confirm every repository
   migration appears in order with no failed or missing entries. Capture the
   CLI/Postgres version and the full reset result in the report.
4. After the identity mapping is consistent across `seed.sql` and every SQL
   acceptance fixture, run all discovered SQL acceptance files against the
   local PostgreSQL endpoint using `psql` with the local database credentials.
   Confirm role switching and rollback semantics in the real Supabase database;
   do not treat direct fixture inserts into `auth.users` as Auth acceptance.
5. Add service-level checks for Storage HTTP upload/download restrictions and
   bucket limits, Auth/session behavior, and Realtime subscription authorization
   and delivery. SQL assertions about bucket metadata alone do not prove HTTP
   enforcement.
6. Only after local-stack acceptance, reconcile the historical hosted migration
   history documented in `docs/database.md` on a disposable staging project.
   Apply pending migrations there using the approved deployment workflow, then
   repeat RLS, Auth, Storage, and Realtime checks with real test identities.
   Hosted changes are not complete until this succeeds and the deployed
   migration list and grants are captured.
7. Add at least two-session PostgreSQL acceptance for owner transfer/removal,
   organization admission/revocation, and cleanup/job claiming, including
   serialization failures, deadlocks, and retry behavior.
8. Update `docs/database.md`, `docs/testing.md`, and
   `docs/production-readiness.md` with the verified environment, command output,
   migration history, and remaining failures. Preserve this distinction between
   PGlite, local Supabase, and hosted acceptance.

## Safe local command outline

Run only against a disposable local Supabase database after confirming the CLI
target and inspecting the available command help:

```powershell
supabase --version
docker version
psql --version
```

The remaining Supabase commands intentionally depend on the CLI version and
local configuration: read `supabase start --help`, `supabase db reset --help`,
and `supabase migration list --help`; configure only the disposable copy, reset
without running the seed, create Auth users, align the seed/test UUIDs, then
apply the seed and run suites using the connection details from `supabase
status`. Never paste database passwords or service keys into logs or reports.

## Final status

**Partially verified.** Local PGlite SQL acceptance passed today for 20
migrations and 14 SQL suites. Clean Supabase migration application, real Auth,
hosted RLS/permissions, Storage HTTP enforcement, Realtime, multi-session
concurrency, and staging verification remain outstanding.
