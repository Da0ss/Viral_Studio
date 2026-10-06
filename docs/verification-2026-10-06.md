# Verification checkpoint — not production approval

The approved core rollout was applied to hosted Supabase `Viral_Studio`
(`sytjbknfwwbombypwfhc`) under migration version `20261005202352`, name
`production_core_security_and_media_rollout`. The remote history contains five
older baseline records and this bundled rollout. Canonical local/remote history
reconciliation is still pending: do not blindly replay the local baseline DDL.

Post-application queries confirmed private `avatars` (5 MiB) and `project-media`
(50 MiB) buckets, the private deletion outbox, a pinned `pg_catalog` search path
for `public.set_updated_at()`, and denied anonymous execution of the platform
`public.rls_auto_enable()` helper. Security advisors returned no WARN/ERROR;
the remaining INFO concerns deliberately policy-less client-denied private
deletion-outbox RLS.

New upload-intent, team-invitation, and generation-lifecycle migrations are not
part of that deployed package. They remain under local implementation/security
review. Review found and requested fixes for invitation role escalation,
revoked-inviter acceptance, browser-callable premature upload finalization,
direct Storage writes bypassing quota, and upload lock ordering.

Focused root-owned checks:

- Latest root full Vitest run: 32 files and 236 cases passed, including
  generation-status network/HTTP failures and abort-on-unmount, immediate chat
  offline/online recovery, and RU/EN/KK media control/validation regressions.
  Generation-advance route checks cover origin rejection, ignored forwarded
  host claims, verified Auth identity, RLS-hidden records and redacted failures.
  A new full run is needed after subsequent UI edits.
- Root rerun on 2026-10-06: all 25 unmodified migrations and 17 SQL acceptance
  files passed on fresh PGlite. Supabase Auth, Storage and Realtime services are
  not exercised by this embedded run.
- Nine focused Auth-action tests pass, including safe transport failure handling,
  non-enumerating recovery response and successful redirects outside catch blocks.
  Focused ESLint and TypeScript pass after these changes; full-suite snapshot
  above predates this follow-up and in-progress asset-version/team changes.
- Production build passed again after the Auth and Storage redirect fixes.
  Ten subsequent cron-aggregator tests pass: incomplete generation transitions,
  invalid counters, stale/unknown queue outcomes fail closed instead of reporting
  confirmed success. Focused ESLint passes; rebuild after this follow-up remains
  required. The deployed scheduler is still unverified.
- Full production build and ESLint passed before the subsequent polling fix;
  focused ESLint passed for that fix and its tests.
- Fresh repository/SSR scan passed: 246 historical blobs, 274 workspace paths,
  447 server build files. The build predates the subsequent polling fix.

- 19 callback/proxy/Hugging Face adapter regressions passed before the scheduler
  authorization addition; 15 callback/scheduler authorization cases passed after it.
- Four secret-detector cases passed, including Hugging Face token detection.
- Repository/SSR audit passed across 246 historical blobs, 254 workspace paths,
  and 389 server build files. Its scope is known configured values and explicit
  Supabase/Hugging Face token patterns, not unknown/obfuscated credentials.
- ESLint passed for the root-owned callback, scheduler authorization, detector,
  repository audit and associated unit-test files.

The SSR build scanned here predates the newest in-progress team/upload/generation
changes; rebuild and rescan are required for the final artifact. Native clean
Supabase, hosted Auth/Storage/Realtime identities, authenticated browser scenarios,
provider-backed generation, deployed scheduling and deployment acceptance remain
unproven. No real paid provider request was made. This checkpoint does not imply
that numbered readiness items 2–5 are complete.

Root feature audit found missing user-facing asset versions and team role/removal
management. Implementation is in progress; schema existence is not acceptance.
Safe decoded previews still require a private scan/derivative pipeline; header
matching and attachment-only downloads do not complete that requirement.

Subsequent root checkpoint: 250 unit/component cases passed before the application
origin validation change. Twelve origin-validation cases plus nine Auth-action
cases subsequently pass; focused ESLint passes. Production Auth callback origin
must be configured explicitly and use HTTPS (loopback HTTP remains allowed for
disposable local acceptance). New version/team migration edits are in progress;
The missing baseline upload RPC and basename regression were repaired. A fresh
root PGlite run subsequently passed 26 unmodified migrations and 18 SQL acceptance
files, including team member management. TypeScript also passed at that snapshot.
Asset-version UI and new concurrency-specific coverage remain in progress; this
SQL result does not exercise real Storage or prove hosted rollout readiness.
