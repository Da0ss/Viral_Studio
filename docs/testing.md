# Production verification

`pnpm test:client-secrets` runs three detector regression cases and scans the
existing `.next/static` client artifacts after a build. CI runs it immediately
after building. It rejects Supabase secret-key/service-role JWT patterns and
literal, JSON-escaped or URL-encoded values (minimum 12 characters) of configured
sensitive variables from the process and local production environment files.
Findings print paths/names only, never credentials. Local result: 24 client files
passed, with zero configured sensitive variable names to compare. Thus actual
service-role value exclusion was not verified. This check is not a Git-history,
server-rendered HTML, obfuscation, transformed-value or full repository scan.

Latest local run: 71 unit/component cases and 30 Playwright cases passed, with
lint and production build. The 30 include 26 guest browser cases and four HTTP
API-denial cases (two cases repeated under both browser project configurations).
API checks prove JSON 401/no redirect/no-store for guest and foreign-origin guest
uploads; they do not test an authenticated cross-origin request or successful
Storage upload. Proxy now returns JSON 401 for unauthenticated `/api/` requests,
and JSON 503 when public Supabase configuration is absent, instead of login HTML.
Historical counts below describe earlier runs, not current suite totals.

`.github/workflows/ci.yml` defines read-only checks on pushes and pull requests.
It uses pinned action commits, Node 24, pnpm 11.19.0, frozen dependencies and
non-production guest-only public configuration. It runs lint, generated route
types/typecheck, unit/component tests, embedded SQL acceptance, build and desktop/
mobile Chromium E2E. Reports and traces are retained for seven days. It neither
deploys nor applies hosted migrations. GitHub runner execution and required
branch-protection settings have not been verified/configured from this workspace.

Run the following locally:

```powershell
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm test:db
pnpm build
pnpm test:e2e
```

Component tests in `tests/components` run the actual profile and avatar React
components in jsdom with mocked Server Actions and delayed promises. They cover
save/upload mutual exclusion, unlock after rejected requests, preservation of
dirty fields, cancel semantics after a successful avatar upload, pending email
confirmation and oversized-file rejection. These are not authenticated browser
or Storage service tests.

Chat component tests use the actual ProjectChat with a controlled subscription
and mocked Server Action. They verify repeated INSERT deduplication, deterministic
ordering for equal timestamps, a Realtime echo preceding the send response,
draft recovery after rejection, catch-up deduplication and subscription cleanup.
These mocks do not prove real WebSocket delivery, two-user authorization or
offline recovery against hosted Supabase. The local unit/component total is 30.

`pnpm test` runs Vitest unit tests for redirect validation, filter normalization,
profile path validation and chat length limits. Project-action unit tests mock
Supabase and Next cache APIs: guest/role denial, strict delete IDs, zero-row
deletes and updates, safe delete failures, tenant reassignment exclusion and
organization-member creation denial. These mocks do not prove database RLS.
`pnpm test:e2e` rebuilds the app,
starts it on port 3001, and runs 26 Playwright guest-flow cases across desktop
Chromium and mobile Chromium at 390px. Coverage includes login, registration,
password recovery/reset pages; guest redirects for create, projects, profile,
media, team, onboarding, notifications and project chat; console/page errors, framework error
overlays, broken images and horizontal overflow on the four auth pages.
Screenshots are attached to those page cases. This does not test actual password
recovery emails, successful login or authenticated business flows.

On 2026-09-29 the 24-case suite passed and the browser/server process exited
normally outside the desktop filesystem sandbox. Inside the restricted Windows
sandbox the browser run hung; use the app's approved elevated execution when
needed, not a forced-success exit or disabled tests. The standalone
`agent-browser` executable was unavailable in this environment, so automated
verification used the installed Playwright runner.

Database integration requires a disposable Supabase stack. The repository has
no `supabase/config.toml`, and `supabase/seed.sql` expects three Auth users with
fixed UUIDs before it runs. A clean-stack run must initialize configuration in
an isolated disposable copy, reset without seeding, create real Auth users,
align the seed and SQL fixtures to the returned IDs, then apply the seed and
acceptance suites. Never seed production. See
[`database-verification-2026-10-05.md`](database-verification-2026-10-05.md).

`pnpm test:db` applies every discovered migration SQL file unchanged, then loads
the seed and discovers every `*_acceptance.sql` suite in a fresh in-memory
PGlite PostgreSQL. On 2026-10-05, 20 migrations and 14 acceptance suites passed.
See [`database-verification-2026-10-05.md`](database-verification-2026-10-05.md)
for the evidence boundary and clean-Supabase next steps. It found and now
guards against recursive project/project-member policies (SQLSTATE 42P17).
`supabase/tests/tenant_storage_acceptance.sql` adds authenticated onboarding and
owner/project bootstrap, bidirectional A/B project/member isolation, denied
cross-tenant creates/updates/deletes/self-promotion/tenant moves, allowed owner
updates/deletes, own avatar insert/read/delete and denied foreign avatar access.
It checks original rows remain intact after denied writes. Avatar bucket privacy,
size and MIME configuration are asserted in SQL, not their HTTP enforcement.
The harness supplies minimal Supabase-owned auth/storage schemas, Auth UUID
lookup, role grants and a Realtime publication. It inserts identity fixtures,
not real Auth accounts. Passing this suite proves SQL execution only against
those explicit fixtures, not real Supabase Auth, Storage HTTP restrictions,
Realtime delivery, deployed migration history or hosted default privileges.

`message_notifications_acceptance.sql` checks in-app message recipients, sender
exclusion, absence of copied private content, outsider isolation, rollback and
revoked trigger execution privileges. Email/push service delivery is not covered.

Browser acceptance includes desktop and 390px mobile layout, error overlay and
console inspection, image load failures, horizontal overflow, auth redirects,
filters, profile persistence, upload rejection, chat Realtime, and generation
job lifecycle with seeded roles. Authenticated and Realtime cases require a
dedicated disposable Supabase project and test identities.
