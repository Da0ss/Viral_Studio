# Hosted HTTP verification — 2026-10-11

Project: `Viral_Studio` (`sytjbknfwwbombypwfhc`). This records the safe HTTP checks for Step C of [the database repair plan](database-repair-plan-2026-10-11.md).

## Credential and runtime review

The local environment was inspected without printing values. Present: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and `NEXT_PUBLIC_APP_URL`. Absent: `SUPABASE_SERVICE_ROLE_KEY`, `E2E_SUPABASE_SERVICE_ROLE_KEY`, E2E owner/viewer emails and password, E2E fixture identifiers, `CRON_SECRET`, `MEDIA_CLEANUP_SECRET`, `MEDIA_UPLOAD_RECONCILE_SECRET`, and `HF_TOKEN`. No existing usable hosted test login or service credential is configured.

`vercel.json` schedules `/api/internal/workers` daily. The route requires `CRON_SECRET`; cleanup and upload reconciliation each have their own secret and feature flag. Metrics also use `CRON_SECRET` and an enable flag. The app's generation detail UI POSTs `/api/generations/{id}/advance` immediately and every 15 seconds while the job is queued or running. Chat has Realtime subscription behavior. The current public API proxy denies unauthenticated API requests before route-level validation.

The existing `scripts/test-supabase-e2e.mjs` is explicitly local-only: it obtains the disposable local CLI credentials, creates four Auth identities, and creates organizations, projects, media, messages, and other fixtures. It must not be repointed to the hosted project. No browser fixture is configured in `.env.local`.

## Read-only checks completed

`node scripts/verify-hosted-backend.mjs` probes the configured Supabase HTTP API and app base URL. The script loads `.env.local` in memory, never prints environment values, sends only anonymous GETs plus unauthenticated POSTs to guarded internal routes, and creates no database or Storage rows. The first run used a local Next dev server pointed at the hosted Supabase project.

Observed results:

| Probe | Result | Meaning |
| --- | --- | --- |
| Supabase Auth health | HTTP 200 | Hosted Auth HTTP endpoint reachable |
| Anonymous `projects` REST query | HTTP 200, zero rows | Anonymous role cannot see existing projects through this query |
| Guest `/api/generations` | HTTP 401 | App API requires a session |
| Malformed guest generation query | HTTP 401 | Proxy authentication runs before route parameter validation |
| Worker and metrics without credential | HTTP 503 | No configured worker credential/availability |
| Cleanup and upload reconcile without credential | HTTP 503 | No configured worker credential/availability |

These checks do not establish signed Storage upload/download behavior, owner/viewer/outsider authorization, browser Realtime delivery, cleanup completion, or generation worker execution. HTTP 503 does not establish whether the Vercel cron has been configured in the deployed project; only repository schedule configuration was inspected. No provider request was made.

## Production alias verification

The same script was run once with `HOSTED_APP_BASE_URL=https://viral-studio-azure.vercel.app`, so app probes reached the READY production deployment while direct Supabase health/RLS probes used the configured hosted Supabase project. Results matched the local-app run: Auth and REST 200 (anonymous projects remained empty), guest API 401, and guarded internal endpoints 503. The deployment did not return a Vercel Authentication or Deployment Protection page. The 401/503 responses therefore came from the app routes. This confirms the production alias is reachable, but does not prove that its app and the local environment point at the same Supabase project by secret-value comparison.

The Vercel environment metadata for Production lists `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_SUPABASE_URL`, and `NEXT_PUBLIC_SUPABASE_ANON_KEY`; `hiddenProductionEnvCount` is 0. No server-only credentials are configured. Consequently, no hosted writes can be safely executed yet: there is no configured `SUPABASE_SERVICE_ROLE_KEY`, dedicated test owner/viewer login, or worker/cleanup machine credential. Existing Auth users and passwords must remain untouched. The user has already authorized bounded verification; missing server and test credentials are the blocker.

## Server configuration checklist

Configure these in the Vercel project's Production environment. Keep all values server-only; do not use a `NEXT_PUBLIC_` prefix for secrets.

| Variable | Requirement | Enablement |
| --- | --- | --- |
| `SUPABASE_SERVICE_ROLE_KEY` | Project's server-side service-role/secret key; required for admin Storage signing, upload verification, and worker operations | Needed for the signed upload and cleanup implementation |
| `CRON_SECRET` | Separate cryptographically random 32-byte lowercase hex bearer token; must differ from Supabase and provider keys | Needed for `/api/internal/workers` and `/api/internal/worker-metrics` |
| `MEDIA_CLEANUP_SECRET` | Separate 32-byte lowercase hex token | Only when directly invoking the cleanup endpoint |
| `MEDIA_UPLOAD_RECONCILE_SECRET` | Separate 32-byte lowercase hex token | Only when directly invoking upload reconciliation |
| `MEDIA_CLEANUP_ENABLED` | `true` only during authorized cleanup verification | Keep disabled until fixture exists and cleanup path is ready |
| `MEDIA_UPLOAD_RECONCILE_ENABLED` | `true` only during authorized reconciliation verification | Keep disabled until explicitly exercised |
| `WORKER_METRICS_ENABLED` | `true` only if metrics endpoint verification is needed | Keep disabled otherwise |
| `GENERATION_ENABLED` | `false` for this verification | Do not enable provider-backed generation; no paid request is authorized |

The repository's `vercel.json` cron entry calls `/api/internal/workers` daily. Configure `CRON_SECRET` for the Production deployment before expecting that endpoint to run. Supabase Dashboard verification by the coordinator found the current Free plan does not include leaked-password protection; enabling that feature requires Pro. No plan change is part of this verification.

## Bounded fixture procedure after server config exists

Once the service key and dedicated test identities are available, proceed with the already authorized isolated verification; do not change either existing user's password/profile and do not use the local-only fixture runner against production. Use a unique run UUID in all fixture labels and keep a private run ledger of generated IDs and object paths.

1. Sign in as the dedicated test owner and viewer; use a separate outsider identity for cross-tenant checks. Confirm the test owner has a dedicated organization/project or create uniquely named temporary ones.
2. Through the production UI/API, upload a deterministic tiny PNG using the signed upload flow, finalize it, download it, and compare its SHA-256 and byte count locally.
3. Upload two versions through the app, list versions, verify sequence numbers 1 and 2, and retry the same request key to confirm idempotency. Confirm viewer access and outsider denial for roster, asset, version, and direct API reads.
4. Delete the parent asset through the app. Invoke the authorized cleanup worker using its dedicated credential, then verify the exact fixture paths are absent from Storage and quota usage has been released. If any step fails, stop new work and reconcile/clean only recorded fixture IDs and paths.
5. Verify the HTTP `submitGeneration` action rejects submission while `GENERATION_ENABLED=false` or `HF_TOKEN` is absent; it returns before creating a job. Separately, with the dedicated authenticated test owner, call the authorized `create_generation_job` and `cancel_generation_job` RPCs directly to verify reservation and release without dispatching a provider request. Inspect that fixture's final status and zero remaining reservation. Keep `GENERATION_ENABLED=false`, do not supply `HF_TOKEN`, and do not interpret the disabled HTTP rejection as a queued create/cancel test.
6. Remove temporary organization/project rows and dedicated temporary Auth identities after verifying all associated Storage paths are gone. Record cleanup results without prompts, email addresses, keys, or other user identifiers.

Owner/viewer/outsider HTTP checks and the Storage roundtrip remain pending until those prerequisites are configured. Paid provider lifecycle remains out of scope without a separate budget decision.

## Reproduction

Run the Next app locally with the intended public Supabase URL/key and `NEXT_PUBLIC_APP_URL` in `.env.local`, then run:

```powershell
node scripts/verify-hosted-backend.mjs
```

Set `HOSTED_APP_BASE_URL` when the local app listens on a different origin. The script asserts the expected HTTP statuses and fails if the anonymous project query exposes rows.
