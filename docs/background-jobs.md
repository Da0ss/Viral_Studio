# Background jobs

## Inbox column permissions

The local notification-column migration restricts authenticated mutation to
read_at only, keeping RLS ownership checks. Producer fields and client
INSERT/DELETE/TRUNCATE are denied. SQL verifies own mark-read works, foreign
updates affect zero rows, and title/body/recipient forgery fails. Server message
notification creation still passes existing trigger acceptance.

## Media deletion outbox (local schema, worker pending)

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
expiry/reclaim, token fencing, backoff and completion. No scheduled runner exists;
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
there is no configured scheduler. maxDuration=120 is declared but host support
must be verified. The exact proxy exception is covered by boundary tests.
Do not enable it until hosted acceptance and controlled Storage writes are verified.
The existing synchronous media action
still removes bytes before deleting metadata; switching it to enqueue-only must
wait for worker implementation and acceptance. The worker must atomically claim
with lease fencing, recheck every path for live references, coordinate new path
references, remove via Storage API, acknowledge only its lease, retry with bounded
backoff and redact errors. Path reuse/completed-row deduplication and concurrent
versions are unresolved; this table alone is not a reliable deletion workflow.

`public.generation_jobs` is the durable contract for generation work. It stores
the project, requester, status (`queued`, `running`, `completed`, `failed`, or
`cancelled`), JSON input/output, a bounded error message, timestamps and a
completion invariant.

RLS allows project participants to read jobs and only project owners/editors to
submit them as themselves. The local column-permission migration allows clients
to insert only project_id/requested_by/input, with queued/default result fields.
Clients cannot UPDATE, DELETE, TRUNCATE or set status/output/error/timestamps/id.
Worker lifecycle writes are reserved for service_role. Cancellation requires a
separate authorized transition RPC, not unrestricted updates; it is not yet built.
A generation worker is intentionally not included in this
repository: production deployment must supply a trusted server-side worker using
the service role, claim queued jobs atomically, update status, redact provider
errors, set `completed_at` for completed jobs, and retry idempotently. Never run
that worker in a Client Component.
