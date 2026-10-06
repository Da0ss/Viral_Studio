# Storage

The `avatars` bucket is private. Its migration enforces a 5 MiB limit and only
accepts `image/jpeg`, `image/png`, and `image/webp`.

Avatar object names use `avatars/{auth.uid()}/{timestamp}-{sanitized-name}`.
Storage RLS lets an authenticated user read, insert, and delete only objects in
their own folder. The upload action additionally checks MIME type, byte size and
JPEG/PNG/WebP file signatures before upload, saves only a private object path in
`profiles`, and generates a one-hour signed preview URL.

Do not add a public bucket or a `getPublicUrl` call for profile avatars. New
asset buckets require a private-by-default migration, a size/MIME allow-list and
per-object RLS before client use.
# Project media (local migration, not deployed)

`deleteMedia` is a synchronous Server Action (UI not yet connected). It requires
explicit confirmation, Auth, owner/editor membership, canonical database paths
and a bounded version inventory (at most 999 plus the original, matching the
Storage API's 1000-object limit). Storage errors preserve metadata; success is
reported only after a returned deleted asset row. Files are permanently removed
through the Storage API, not raw storage metadata SQL. A second-step DB failure
can leave metadata without files; process interruption, permission changes,
concurrent versions and shared paths require a durable deletion outbox and
reconciliation before production use. Mock tests do not prove hosted deletion.

`POST /api/projects/{projectId}/media` accepts only bounded JSON metadata (at
most 16 KiB) and a UUID `Idempotency-Key`; file bytes bypass the app server.
The browser hashes the selected file, then an authenticated RPC atomically
reserves the key, canonical object path, and 50 MiB quota capacity before a
server-only route mints and persists a no-upsert signed upload token. The
browser sends bytes directly to the private bucket using that capability.
Retries replay the same capability; they do not silently issue a new token.
Reusing a key for different bytes or metadata is rejected.

`POST /api/projects/{projectId}/media/finalize` accepts only intent/lease IDs.
It verifies the authenticated owner/editor lease, downloads the fixed reserved
path through a service-authenticated Storage request with a 60-second deadline
and 50 MiB streamed read cap, checks exact byte count and SHA-256, then checks a
short format signature before a service-only fenced RPC creates the asset row.
The signature is only a mismatch detector—not a malware scan, full decoder, or
safety verdict. Uncertain finalization remains retryable; the client retains
its key in session storage and checks status before replaying.

Project media uses a 1 GiB default logical quota covering assets, versions,
active upload reservations and generation output reservations. Quota
checks/reservations serialize by project in
Postgres; only service_role can override a project's cap. `POST
/api/internal/media-upload-reconcile` is a separate, disabled-by-default worker
endpoint. It claims an intent only after persisted signed-token expiry plus a
one-hour grace (or the initial no-token reservation grace), and an expired
lease. It retires the immutable path, removes its unreferenced object, and
acknowledges or retries under a token-fenced lease. Configure a separate
random 32-byte hex `MEDIA_UPLOAD_RECONCILE_SECRET`, set
`MEDIA_UPLOAD_RECONCILE_ENABLED=true`, and provide an external scheduler before
expecting abandoned objects to be reclaimed. This remains local until hosted
Storage transfer/finalization and concurrent acceptance pass.

Upload bytes bypass function ingress; finalization holds at most a 50 MiB
object plus bounded hashing buffers in server memory. Rate limits,
resumable/chunked uploads, malware scanning, and content quarantine are not
implemented. The signed capability expires after two hours; quota reserves
50 MiB for each live intent until verified finalization or reconciliation.

The media page offers an on-demand download Server Action. It accepts only an
asset UUID, authenticates with getUser, reads the asset under RLS, checks that
its canonical Storage path belongs to its project, and signs using the caller's
Storage client for 60 seconds with download disposition. Missing and forbidden
assets share one error. Signed URLs are bearer capabilities: role revocation
does not immediately revoke already issued URLs; do not log or share them.
Legacy/noncanonical asset paths are refused, not guessed or migrated silently.
Seven mocked action cases pass; actual hosted download acceptance is pending.

`project-media` is private, limited to 50 MiB per object and explicit JPG/PNG/
WebP, MP4/WebM, MP3/WAV and PDF MIME types. Names follow
`projects/{projectUUID}/{objectUUID}/{safeFilename}`. The caller must retain both
project and organization membership. Participants read and owners/editors
delete; authenticated clients cannot insert Storage objects directly. The
same-origin begin route validates membership, fingerprint, and quota before
issuing a persisted signed capability for one canonical path. No UPDATE policy
exists: token creation uses `upsert:false`, and
versions need unique object UUIDs. SQL acceptance covers participant/outsider
reads, direct-upload denial, malformed/traversal paths, immutable objects,
owner deletion and organization membership revocation.

This bucket migration is local only. Production acceptance still needs hosted
Storage HTTP verification, signed URL transfer/finalization and durable cleanup.
Removing a project or membership can make orphan objects inaccessible to normal
clients; a scoped trusted cleanup worker is still required. Never delete Storage
metadata directly in production to remove actual bytes.
