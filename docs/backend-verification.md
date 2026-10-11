# Backend verification

Hosted database repair and rollback-only acceptance completed on 2026-10-11 are recorded in [the database repair plan](database-repair-plan-2026-10-11.md). These checks verify hosted SQL/RLS/RPC behavior; they do not establish browser authentication, Storage HTTP, Realtime, or paid provider success. The commands below are for disposable local regression fixtures, not for the hosted project.

Use the disposable local Supabase stack for backend acceptance. Do not point these commands at a hosted project.

1. Check Docker and start the local stack with `pnpm db:local:start` when it is not already running.
2. Run native database and service checks with `pnpm test:db:supabase`, `pnpm test:db:services`, and `pnpm test:db:concurrency`.
3. Run `pnpm test:e2e:supabase` for the production build plus authenticated browser acceptance. The runner creates and removes its own Auth and application fixtures.

`test:e2e:supabase` sets `E2E_NATIVE_SUPABASE_REQUIRED=1`. In this mode, a missing local URL, key, mail endpoint, or user fixture fails the suite instead of producing a skipped green run. Direct `playwright test` remains the guest suite and skips native authenticated acceptance. To require the separate credential login case, set `E2E_AUTH_REQUIRED=1` together with `E2E_EMAIL` and `E2E_PASSWORD`.

A successful verification requires real pass output from every invoked native runner and cleanup. A skipped authenticated case, unavailable Docker daemon, missing local credentials, build failure, or cleanup failure is not backend verification.
