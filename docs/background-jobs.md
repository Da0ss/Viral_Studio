# Background jobs

## Inbox column permissions

The local notification-column migration restricts authenticated mutation to
read_at only, keeping RLS ownership checks. Producer fields and client
INSERT/DELETE/TRUNCATE are denied. SQL verifies own mark-read works, foreign
updates affect zero rows, and title/body/recipient forgery fails. Server message
notification creation still passes existing trigger acceptance.

## Media deletion outbox (hosted core schema; worker acceptance pending)

The follow-up path-tombstone migration coordinates metadata INSERT/path UPDATE
with deletion enqueue using transaction-scoped path advisory locks. Queue paths
remain reserved after completion; assets and versions cannot recycle them.
Enqueue acquires multiple path locks in sorted order. Sequential rollback and
completed-path reuse acceptance passes; true multi-connection concurrency and
deadlock/retry behavior are not yet verified. A local restrictive Storage INSERT
policy rejects queued/completed paths, even alongside broader permissive policies.
It uses an authenticated membership-checked private helper, not a trigger or
ownership change on the managed Storage schema. This is a snapshot check, not
cross-system concurrency fencing; real Storage HTTP and concurrent acceptance
remain pending. Service-role operations bypass RLS and need worker-side guards.

The local `media_deletion_outbox` migration adds an RLS-enabled private table
with immutable source identifiers/path, scheduling, attempts, lease and completion
fields. A non-callable private BEFORE DELETE asset trigger snapshots canonical
original/version paths in the same transaction as deletion; no parent FK can
erase queued work. Client roles have no table privileges. Rollback and cascading
version deletion are verified in embedded SQL acceptance. Noncanonical legacy
paths fail the original deletion instead of guessing a bucket.

A server-only consumer core exists in `src/lib/media-cleanup-worker.ts`, with
injected ports for atomic lease/reference inspection, Storage removal and fenced
completion/retry. Fifteen mocked cases cover fail-closed inspection, live references,
stale leases, invalid paths, redacted failures and uncertain acknowledgements.
The server-only adapter `media-cleanup-adapter.ts` connects the core to service-role
RPCs and Storage API. Claim uses SKIP LOCKED, a 120-second lease and a fresh token;
inspection checks all asset/version references and renews the current lease;
completion/retry requires the matching unexpired token. RPCs are SECURITY INVOKER
with EXECUTE restricted to service_role, not clients. Sequential SQL verifies claim,
expiry/reclaim, token fencing, backoff and completion. A local cron aggregator exists;
true multi-session/Storage HTTP behavior remains unverified. The adapter's custom
fetch uses a native 20-second AbortSignal deadline for each RPC/Storage request,
including response-body consumption, and preserves caller cancellation. A real
loopback HTTP test verifies a body stalled after headers is aborted. Timeout is
not proof of server-side cancellation: ambiguous deletion still needs idempotent
reclaim and immutable paths; process pauses and privileged writes remain risks.
`POST /api/internal/media-cleanup` is the machine entry point, disabled unless
MEDIA_CLEANUP_ENABLED=true. It requires Authorization: Bearer with a separate
cryptographically random 32-byte lowercase hex MEDIA_CLEANUP_SECRET; never reuse
the service key or put the token in a URL/client configuration. Responses are
no-store and omit paths, ids and exception details. One request handles one item;
the daily fallback scheduler is not yet deployed. maxDuration=120 is declared but host support
must be verified. The exact proxy exception is covered by boundary tests.
Do not enable it until hosted acceptance and controlled Storage writes are verified.
The media action now deletes metadata and triggers an outbox snapshot in the same
database transaction. Its cleanup worker atomically claims paths with lease
fencing, checks live references, removes through the Storage API, and acknowledges
only its current lease. It remains disabled until hosted acceptance is complete.

## Project-media upload intents and reconciliation

`private.media_upload_intents` gives each `(requester, project, UUID key)` one
byte fingerprint and reserved canonical path. A transactional begin RPC
serializes quota by project, counts assets, versions, upload intents and
generation reservations, and enforces a default 1 GiB project limit. Each
upload reserves the maximum 50 MiB until hash-verified finalization. Only
`service_role` can override a project quota. Signed tokens and expiry remain
private; retries replay the persisted token, and cleanup waits through its TTL
plus grace. File bytes go directly from the browser to the private Storage
bucket through the signed capability, avoiding the function-host request-size
limit.

`POST /api/internal/media-upload-reconcile` claims intents only after persisted
token expiry plus grace and an expired lease, retires the path, removes
unreferenced bytes and fences the acknowledgement. Failures remain claimable
with bounded backoff.
This worker has separate `MEDIA_UPLOAD_RECONCILE_SECRET` and
`MEDIA_UPLOAD_RECONCILE_ENABLED` settings and requires an external scheduler.
It is local only and must remain disabled until hosted concurrency and Storage
HTTP acceptance pass.

## Generation lifecycle (local implementation; hosted acceptance pending)

`20261005201745_generation_lifecycle.sql` replaces direct client insertion with
authorized creation/cancellation RPCs. Client-visible columns exclude privileged
dispatch, billing and lease details. Creation requires current organization and
project owner/editor access and reserves cost and output storage atomically.

The server-only `generation-worker.ts` and `huggingface-video.ts` implement
fenced claims, just-before-submit access revalidation, provider submission,
polling, cancellation, immutable output persistence and conservative accounting.
An ambiguous paid submission becomes `uncertain`; it is not automatically
resubmitted. Failed acknowledgement after output finalization preserves bytes
for a fenced retry instead of deleting a possibly committed result.

Generation remains disabled unless `GENERATION_ENABLED=true`. Configure
`HF_TOKEN` only server-side. The current application reserve is $0.05 per job,
with $1/day global and $0.50/day per-user budgets. These are application limits,
not a guaranteed provider billing cap; validate the provider's current pricing
and account-level spending controls before enabling paid requests.

`GET /api/internal/workers` requires an independent exact bearer `CRON_SECRET`
and invokes only explicitly enabled consumers. `vercel.json` supplies a daily
fallback, not a responsive autonomous production schedule. The authenticated
generation detail page can advance eligible jobs while viewed. A suitable
deployed frequent scheduler, monitoring and provider-backed acceptance remain
required. Native Supabase and hosted service checks have not yet proved this
implementation. No paid generation is certified by local mocks or PGlite.
