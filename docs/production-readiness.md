# Production readiness: NOT APPROVED

This is a current worktree inventory, not a deployment certificate. Latest
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
| Unit/component tests | 157 mocked/local cases pass; do not prove hosted RLS |
| Integration / clean migrations | PGlite SQL passes; full clean Supabase stack pending |
| Browser E2E | Guest desktop/mobile pass; authorized business flows pending |
| RLS / permissions | Local tenant/role acceptance passes; hosted migrations and acceptance pending |
| Auth redirects | Guest private-page redirects pass; successful login/callback acceptance pending |
| Upload restrictions | Local policy/handler cases pass; hosted HTTP enforcement, quotas/scan pending |
| Password flow | UI/validation exists; real recovery email and session flow pending |
| Profile persistence | Action/component/CAS cases pass; real browser refresh and cross-tab acceptance pending |
| Project filters | Implementation/unit checks exist; authenticated browser acceptance pending |
| Chat Realtime | Mock reconnect/dedup cases pass; actual two-user/offline verification pending |
| Generation jobs | Schema only; provider/model/budget decision and worker/UI/API needed |
| Mobile / console / images / overflow | Guest auth pages checked; private rendered surfaces pending |
| Secrets | Only .env.example tracked; env ignore rules present; client-secret check has limited static-bundle scope; full history/SSR scan pending |
| Production build | Local compilation passes; no staging/production deployment verified |
| Safe errors / action auth | Guards and generic errors exist; not a completed exhaustive security audit |
| Private Storage | avatars + project-media declared private; media migration local only |
| Background jobs | No deployed generation, cleanup or notification-delivery worker |

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
