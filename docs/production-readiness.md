# Production readiness: NOT APPROVED

Latest audit and task list: [audit-2026-11-17.md](audit-2026-11-17.md).

This is a current worktree inventory, not a deployment certificate. Latest
root checkpoint on 2026-10-06: 236 full-suite unit/component cases passed.
All 25 migrations and
17 SQL acceptance files passed on fresh PGlite. The approved hosted core package
is deployed, but the new upload/team/generation package is not. A production
build and full lint passed before subsequent UI fixes; rebuild remains required.
See [verification-2026-10-06.md](verification-2026-10-06.md).

Supabase follow-up: native SQL, Storage/Realtime and two-session acceptance
runners and a dedicated CI job are implemented; local start fails because
Docker/Podman is unavailable. Their behavioral results remain unverified. See
[supabase-integration.md](supabase-integration.md).

Historical
evidence: 157 Vitest cases, lint and typecheck pass after project action hardening;
production compilation last passed before that action change;
20 embedded SQL migrations and 14 discovered SQL acceptance suites passed on
2026-10-05, including lease/reference, job/inbox-column, schema security,
ownership/revocation and project-identity checks. Clean Supabase stack and hosted
RLS verification remain pending; see
[`database-verification-2026-10-05.md`](database-verification-2026-10-05.md).
Earlier evidence includes three Node secret-detector cases and 30 Playwright cases.
The Playwright scope is 26 guest browser cases plus four guest HTTP API
checks, not authenticated application acceptance. Hosted CI has not been run.

| Requirement | Evidence / remaining work |
| --- | --- |
| TypeScript / ESLint | Local commands pass |
| Unit/component tests | 236 full-suite cases pass; do not prove hosted RLS |
| Integration / clean migrations | PGlite SQL passes; full clean Supabase stack pending |
| Browser E2E | Guest desktop/mobile pass; authorized business flows pending |
| RLS / permissions | Local tenant/role acceptance passes; hosted migrations and acceptance pending |
| Auth redirects | Guest private-page redirects pass; successful login/callback acceptance pending |
| Upload restrictions | Local policy/handler cases pass; hosted HTTP enforcement, quotas/scan pending |
| Password flow | UI/validation exists; real recovery email and session flow pending |
| Profile persistence | Action/component/CAS cases pass; real browser refresh and cross-tab acceptance pending |
| Project filters | Implementation/unit checks exist; authenticated browser acceptance pending |
| Chat Realtime | Mock reconnect/dedup cases pass; actual two-user/offline verification pending |
| Generation jobs | Durable multi-model jobs (Fal LTX/MiniMax, per-model budget reservation, `/create` UI) exist locally with PGlite and mock tests; migration not applied to hosted; no paid provider acceptance; HF path kept by owner decision |
| Mobile / console / images / overflow | Guest auth pages checked; private rendered surfaces pending |
| Secrets | Only .env.example tracked; env ignore rules present; client-secret check has limited static-bundle scope; full history/SSR scan pending |
| Production build | Local compilation passes; no staging/production deployment verified |
| Safe errors / action auth | Guards and generic errors exist; not a completed exhaustive security audit |
| Private Storage | Hosted avatars + project-media verified private; new upload-intent migration and HTTP acceptance pending |
| Background jobs | No deployed generation, cleanup or notification-delivery worker |

## Generation rollout order (2026-11-17, not started)

Code is uncommitted on `fix/p0-generation-hardening`. Generation stays off in
production until each step below is done:

1. Deploy code with `GENERATION_MULTIMODEL_ENABLED=false`.
2. Owner reviews migrations `20261117120000_fk_indexes_and_policy_consolidation.sql`
   and `20261118090000_multimodel_generation_jobs.sql`.
3. Do NOT use `supabase db push` until `supabase migration repair` is done: hosted migration history is squashed (10 rows vs 28 local files), so it would try to re-apply most local migrations. Instead apply `20261117120000` and then `20261118090000` individually (Supabase SQL editor or MCP `apply_migration`, each in its own transaction) while the cron is quiet. A read-only catalog check on 2026-11-17 found all preconditions met (policy shapes, CHECK constraints, function signatures, empty `generation_jobs`).
4. Confirm `claim_generation_jobs` returns provider and model.
5. Set `FAL_KEY`.
6. Run one paid LTX job.
7. Set `GENERATION_MULTIMODEL_ENABLED=true`.

Before enabling kling or seedance, confirm Fal prices on the invoice, raise the
per-user daily limit (default $0.50), run `set_generation_model_price`, and flip
`priced` in `src/lib/video-models.ts`. Verify real Fal `response_url` prefixes on
staging for each model.

## Remaining completion order

1. Reconcile/apply migrations to authorized disposable staging and verify Auth,
   tenant RLS, Storage HTTP and Realtime with real identities.
2. Verify authenticated project/profile/upload/inbox flows on desktop and mobile.
3. Implement upload idempotency, durable reconciliation/cleanup, quotas and the
   deployment-compatible large-file/scan path. Add asset versions and safe previews.
4. Implement provider-backed generation worker and lifecycle with cost limits,
   atomic claims, retries, cancellation and result persistence.
5. Replace team placeholder with invitations/roles and last-owner safeguards.
6. Finish language/preferences and notification delivery behavior; run the full
   security, browser and clean-stack suite. Deploy staging, validate monitoring,
   backups and rollback before production approval.

Run locally: `pnpm dev`. Build: `pnpm build`. Serve built app: `pnpm start`.
Keep this scope intact: guest success must not be promoted to complete acceptance.
# Latest backend checkpoint

See [2026-10-11 backend implementation](backend-implementation-2026-10-11.md) for current changes, local gate results, read-only hosted schema findings and deployment steps. Earlier dated results below are historical and do not establish acceptance of these changes.
