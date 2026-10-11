# Backend implementation — 2026-10-11

Subsequent hosted database changes and live SQL acceptance are recorded in the [database repair journal](database-repair-plan-2026-10-11.md). The no-hosted-DDL statements below describe the earlier code-only checkpoint.

This checkpoint covers backend work from the audit plan. It does not certify a deployed release. No hosted DDL, deployment, scheduler activation, or paid provider request was performed.

## Implemented contracts

- `GET /api/generations?page=1&projectId=<uuid>&status=queued`: caller-JWT/RLS history, 24 records per page, optional project/status filters, deterministic descending creation-time/ID ordering. Statuses: queued, running, completed, failed, cancelled. `dispatch_state=uncertain` remains visible separately from the lifecycle status.
- `GET /api/media/<assetId>/versions?page=1`: caller-JWT/RLS version metadata, 24 records per page, descending version-number/ID ordering. Storage paths are excluded. An inaccessible asset produces the same empty list as an asset without visible versions.
- Both list endpoints reject unknown or repeated parameters, malformed UUIDs, and pages outside 1–10000 with 400. They return 401 for missing authentication and generic 503 for unavailable Auth/database services. Successful responses contain `items`, `page`, `pageSize`, `total`, `totalPages`; every response is `private, no-store`.
- Team server loading now distinguishes a query/RPC failure from a real empty team or organization list. Failures use the existing error boundary instead of sending users to onboarding or presenting an empty roster.
- Worker scheduler behavior and recovery are documented in [background jobs](background-jobs.md). Exact machine routes bypass user-cookie authentication and enforce their own bearer authentication; similarly named paths remain protected.
- `GET /api/internal/worker-metrics`: aggregate service-role-only queue/budget health; requires the independent `CRON_SECRET` and `WORKER_METRICS_ENABLED=true`. The new migration is `20261011143000_worker_metrics.sql`. The environment example leaves metrics disabled.
- Native browser acceptance requires its fixtures instead of silently skipping them. See [backend verification](backend-verification.md).

The frontend version controls and generation-history screen remain separate work. Existing upload, download, create/cancel, membership and reconciliation contracts were preserved.

## Hosted database inspection

Read-only inspection of the connected `Viral_Studio` project on 2026-10-11 found six migration-history entries: five September bootstrap entries and `20261005202352_production_core_security_and_media_rollout`. This history differs from the local migration filenames.

The hosted `generation_jobs` has its original columns but lacks `dispatch_state` and the other lifecycle columns. The only relevant hosted media/generation/invitation routines reported by the public-schema catalog are `claim_media_cleanup`, `finish_media_cleanup`, and `inspect_media_cleanup`. `team_invitations` is absent. `assets` and `asset_versions` exist. New history queries and lifecycle/upload/team features require schema reconciliation before hosted use; schema errors are surfaced rather than treated as empty data.

Do not blindly replay the local baseline or mark all local migrations applied. The hosted core migration bundles earlier changes under different versions.

## Staging deployment sequence

1. Use an isolated staging project and take a verified backup of the target before a production rollout. Keep generation and media worker flags disabled.
2. Export migration history and schema-only catalogs through the approved database tooling. Compare tables, enum values, functions, grants, policies, triggers, indexes and Storage policies with the local clean schema; compare definitions, not just object names.
3. Prepare forward migrations for the differences. Follow-up sources include upload intents, team invitations, hosted helper security reconciliation, generation lifecycle, asset-version uploads, team roster and worker metrics. Respect their dependencies; do not replay the bundled September core. Review grants/RLS and existing-data compatibility before application.
4. Apply the reviewed forward package to staging. Run native SQL, Auth/Storage/Realtime and two-session concurrency suites against a disposable local stack, then controlled staging smoke checks with dedicated identities and objects. Do not run destructive fixture/reset commands against production.
5. Build and deploy the application with staging configuration. Verify both read APIs as an owner, viewer and outsider; revoked access must remove visibility. Verify team schema failures remain explicit and that no storage paths, keys or lease/billing internals appear in public responses.
6. Verify the host's supported function duration and actual scheduler cadence. The repository's daily fallback does not meet a proposed 60-second queue-start target. Configure a suitable frequent scheduler for the exact authenticated endpoint, observe queue age/backlog and repeated/concurrent invocations before enabling workers.
7. Paid generation acceptance requires a chosen model/provider, verified account spending controls and an explicit test budget. Local mocks do not establish provider billing, cancellation, or output persistence. Enable generation only after this acceptance.
8. Review staging evidence and recovery procedures, then apply the reviewed package and application release to production. Observe reservations, retries, uncertain submissions and oldest-ready age. Keep a rollback plan for the application; recover schema changes through reviewed forward fixes or verified backup restoration.

## Uncertain provider submission runbook

1. Identify the job in the privileged operator tooling. Do not ask a user to retry an uncertain submission and do not automatically resubmit it.
2. Check the provider's account/request records using the original request time and operator-accessible correlation. A timeout or absent local acknowledgement is not proof of rejection.
3. If acceptance is proven, obtain the canonical provider request path. The current RPC accepts only `/fal-ai/ltx-video-13b-distilled/requests/<request-id>`. Confirm the provider/model contract before using it.
4. Call service-role-only `reconcile_generation_submission(target_job, provider_accepted, request_path)` once with the proven outcome. For accepted work, pass its verified path; for proven non-acceptance, pass false and no path. `false` return means no matching uncertain running job was transitioned; investigate rather than forcing state.
5. Accepted work resumes submitted/cancelling processing. Proven non-acceptance finalizes failed and releases its reservation through existing SQL accounting. If the provider outcome remains unknown, leave uncertain and retain conservative accounting.
6. Record the evidence and resulting state in operator-controlled records, excluding credentials and private prompts from public logs. Recheck provider costs and output reservations; never edit job state or budget rows ad hoc.

## Outstanding environment acceptance

Docker is unavailable on this workstation, so native Supabase service, concurrency and authenticated browser acceptance cannot be completed here. Existing CI has a disposable Supabase integration job; its remote result has not been claimed. Hosted migrations, scheduler activation, provider billing acceptance, backup restoration and remote branch protection still require their own evidence.

Supabase's read-only security advisor reports leaked-password protection disabled. Review [password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). Its no-policy notice on `private.media_deletion_outbox` is consistent with a service-only private queue; adding client policies merely to silence that notice would weaken the intended boundary.

## Local integrated gate

Commands use direct Node entry points because the installed Windows package-manager executable shims could not locate Vitest/TypeScript; no dependencies were reinstalled.

- `node node_modules/eslint/bin/eslint.js .`: passed.
- `node node_modules/next/dist/bin/next typegen` and `node node_modules/typescript/bin/tsc --noEmit --incremental false`: passed.
- `node node_modules/vitest/vitest.mjs run`: 41 files, 299 tests passed.
- `node scripts/test-database.mjs`: 27 migrations and 19 SQL acceptance suites passed in fresh in-memory PGlite, including worker metrics.
- `node node_modules/next/dist/bin/next build --webpack`: passed, including all three new read-only API routes. This verifies the webpack production artifact; Turbopack was not separately certified.
- Client-secret detector: 4 tests passed; client bundle scan: 58 files passed. No configured sensitive values were present for value comparison, so this scan establishes only its documented pattern boundary.
- Repository/history/SSR secret scan after the build: 381 historical blobs, 299 workspace paths and 113 server build files passed its documented checks.
- `git diff --check`: passed.
- Guest Playwright on the built app: 46 passed, 20 skipped (16 intentional duplicate viewport cases and 4 authenticated cases without fixtures). The Windows runner stalled while stopping its own Next server; stopping only that server process allowed the runner to return exit 0 and its totals. This teardown intervention is recorded and is not authenticated backend acceptance.

The integrated Vitest gate ran once after the last implementation changes. An earlier agent gate ran before the final API/metrics/deadline integration; it is not used as final evidence. Targeted retries only addressed concrete failures or new changes.
