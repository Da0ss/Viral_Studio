# Real Supabase database acceptance

## Setup

The repository pins Supabase CLI 2.119.0 and supplies `supabase/config.toml`
for a disposable PostgreSQL 17 stack (`viral-studio-test`). Install Docker
Desktop (or a compatible Docker runtime) and PostgreSQL client tools (`psql`)
before running the following from the repository root:

```powershell
pnpm install --frozen-lockfile
pnpm db:local:start
pnpm db:local:reset
pnpm test:db:supabase
pnpm test:db:services
pnpm test:db:concurrency
pnpm supabase stop
```

`db:local:reset` explicitly targets the local database and destroys its data.
Use this stack exclusively for disposable tests. Automatic seeding is disabled:
the SQL runner creates real identities through Auth Admin and maps their UUIDs
into the existing seed and acceptance SQL in memory. No Auth password rows are
inserted directly and the committed fixtures retain their original UUIDs.

## Checks

- `test:db:supabase`: the existing SQL suites against native PostgreSQL after
  CLI migration replay, real Auth fixtures, RLS and cross-tenant permissions.
- `test:db:services`: authenticated clients, private Storage HTTP access,
  forbidden uploads, file restrictions and authorized/unauthorized Realtime
  message delivery.
- `test:db:concurrency`: separate PostgreSQL sessions racing owner removal and
  cleanup job claiming, with bounded connection, statement and lock waits.

All three commands capture CLI credentials without printing status JSON and
restrict their targets to loopback addresses. Passwords are passed to `psql`
through its environment, not command arguments. Fixture cleanup uses recorded
identifiers. A failing check exits nonzero; prerequisites missing is a failure,
not a skipped success.

The `supabase-integration` GitHub Actions job installs the PostgreSQL client,
starts Supabase, replays migrations, executes these commands and stops the
stack even if a test fails. It runs independently from embedded PGlite and
guest browser checks. Its first successful hosted execution is still required.

## Evidence on 2026-10-05

- Pinned CLI installed and `--version` verified as 2.119.0.
- Config generated using `supabase init`; reset and start flags inspected using
  this CLI's help. PostgreSQL major version matches the hosted project's 17.
- Local start failed: Docker and Podman were not found. Native SQL, Storage,
  Realtime and concurrency acceptance have not passed in this environment.
- Embedded acceptance still passes: 20 migrations and 14 SQL suites.
- Remote read-only inspection shows five applied migrations and no staging
  branches. Their timestamps/order differ from the repository baseline.
- Remote security advisors report mutable search path on `set_updated_at` and
  executable `rls_auto_enable` SECURITY DEFINER helper. These remote functions
  have not been modified. Inspect their definitions and callers before changing
  grants; see [search-path advisory](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable)
  and [anonymous definer advisory](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable).
- The subsequent remote SQL inspection was blocked by automatic approval review
  because its selected model was at capacity; no SQL was executed by that call.

## Hosted rollout remains pending

After a full local/CI pass, choose a disposable staging target, compare actual
schema definitions with the first five local migrations, and reconcile migration
history before applying pending changes. Existing hosted data must be preserved.
Creating a hosted project/branch may incur a charge and requires a target/cost
decision. Do not use local fixture runners on a hosted endpoint.

Then repeat service acceptance on a dedicated staging runner with explicit
target validation and test accounts, collect deployed migration history and
security advisors, and review any findings. Local Supabase success cannot certify
the currently hosted project or its migration history.
