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

## Progress update — 2026-10-11 (current hosted run)

This section records the later browser-assisted run. The credential inventory, Vercel metadata, and 503 observations above are historical results from before the server configuration was completed; they should not be read as the current configuration or deployment state.

The Production deployment for commit `main105a9d0`, deployment `dpl_J3fyeEoQGSJVid4c64sabr7aQ1r6`, is `READY`. After the user added the sensitive `SUPABASE_SERVICE_ROLE_KEY`, the project’s server configuration was completed with separate sensitive `CRON_SECRET`, `MEDIA_CLEANUP_SECRET`, and `MEDIA_UPLOAD_RECONCILE_SECRET` values. `WORKER_METRICS_ENABLED` is `true`; `GENERATION_ENABLED`, `MEDIA_CLEANUP_ENABLED`, and `MEDIA_UPLOAD_RECONCILE_ENABLED` are `false`. Secret values are intentionally omitted.

The browser session was already signed in. An isolated project named `Codex HTTP check 20261011-1718` was created for this verification. A 70-byte parent PNG fixture was uploaded successfully through the UI. Its signed download URL was opened through the UI with a 60-second expiry, and the downloaded bytes matched the local fixture: SHA-256 `4ff6ab670a58c14270e034e2090d9a432caa263a14e0a25785386b0c12f880b5`. A first version upload was still in progress when this update was recorded; its completion and verification are pending.

The later internal-metrics probe attempt encountered a script bug and aborted before producing complete endpoint evidence. A wrong-secret request was observed returning HTTP 401 with `Cache-Control: no-store`. The expected metrics HTTP 200 and disabled cleanup/reconciliation HTTP 503 results have **not** been verified in this run, so the earlier 503 observations above remain historical only. Do not infer current worker endpoint behavior from those earlier responses.

At that point, version verification, cleanup, reconciliation, additional HTTP roles and Realtime remained pending. The following completion record supersedes that intermediate state.

### Completed Storage roundtrip and cleanup

Both version uploads completed through the production UI. The history showed versions 1 and 2, each 70 bytes. All three downloads matched their source fixtures:

| File | SHA-256 |
| --- | --- |
| parent.png | `4ff6ab670a58c14270e034e2090d9a432caa263a14e0a25785386b0c12f880b5` |
| version-1.png | `619b0e8b0c8741604b8628c64323444df334846a0dfe13963662586a3603f14c` |
| version-2.png | `6a34118ba2e0bf5da5ab14cb63b121e2e8b2987a876668a9b2f9c30e1357470b` |

Browser delays caused signed URLs to expire before some download attempts; Supabase returned HTTP 400 `InvalidJWT` with an expired `exp` claim. Fresh links downloaded successfully. This is expected expiry behavior, not evidence of corrupted version data. The original and first version were downloaded once successfully; second-version verification used a fresh link after expiry. No provider requests were dispatched.

Before cleanup, the global deletion queue was empty. `MEDIA_CLEANUP_ENABLED` was enabled and deployment `dpl_4nFeR49EQbvkosLLrg7SAzg8dL1r` became READY with the same commit. Only the exact fixture parent was deleted through the Supabase connector (the app's delete action was **not** browser-tested). The database cascaded both version rows and queued three Storage paths while retaining 210 bytes in quota until cleanup.

`scripts/verify-hosted-cleanup.mjs` called the protected cleanup endpoint exactly once per queued object: all three returned HTTP 200 with `outcome=completed`. A subsequent database check confirmed zero Storage objects under the fixture project, zero pending deletions, three completed outbox entries, and zero quota usage. The empty fixture project was then removed using an exact ID/name guard and checks for zero usage and no Storage objects.

The newly deployed metrics endpoint returned HTTP 200 with `Cache-Control: no-store`, the expected aggregate schema, and no checked private fields. Generation, cleanup and upload-reconcile queue depths were all zero; reserved and spent generation budget were zero. The internal daily budget limit exists, but its presence does not authorize enabling paid generation.

Current Production flags: cleanup enabled; metrics enabled; generation and upload reconciliation disabled. Cron remains daily, so this does not meet any sub-minute cleanup target. The temporary local credentials file was deleted. `node --check` passed for the cleanup and worker verification scripts. Existing full unit/build checks were not repeated for a configuration-only deployment. The worker verification script now gathers all settled results so one failing check cannot discard evidence from other requests; its entire disabled-worker suite was not rerun after enabling cleanup.

Remaining checks: viewer/outsider HTTP authorization (SQL role checks already passed in the separate DB report), upload idempotency over HTTP, app delete UI, stale-upload reconciliation, browser Realtime, and provider-backed generation with an explicit budget. Do not describe these as verified. Existing users, profiles and organizations were not changed.
