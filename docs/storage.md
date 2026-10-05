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

`POST /api/projects/{projectId}/media` is the multipart upload endpoint (field
`file`). It rejects absent/cross-origin Origin, authenticates before reading the
body, requires owner/editor membership, bounds actual streamed bytes to 51 MiB
including multipart overhead, checks file size/MIME/header, and generates the
path and creator on the server. It uses the user's Storage client without upsert
and inserts asset metadata only after upload. A rejected metadata write attempts
object removal; process crashes, transport-ambiguous writes and failed removal
still require durable reconciliation. Responses are generic and no-store.

The endpoint currently buffers the bounded body; its peak memory is greater
than one file. Deployment ingress/body and memory limits must be validated.
Do not assume the bucket's 50 MiB limit means the chosen function host accepts
50 MiB requests. A production large-file path may require direct resumable
quarantine uploads and server-side validation/finalization. Rate limits,
tenant quotas, scan/quarantine and upload UI are not yet implemented.

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
project and organization membership. Participants read; owners/editors insert
and delete. No UPDATE policy exists: uploads must not use upsert, and versions
need unique object UUIDs. The predicate is SECURITY INVOKER, not a privileged
authorization bypass. SQL acceptance covers participant/outsider access,
commenter write denial, malformed/traversal paths, immutable objects, owner
deletion and organization membership revocation.

This bucket migration is local only. Storage HTTP limits, real upload/download,
signed URLs, byte inspection, quotas and durable orphan cleanup remain pending.
Removing a project or membership can make orphan objects inaccessible to normal
clients; a scoped trusted cleanup worker is still required. Never delete Storage
metadata directly in production to remove actual bytes.
