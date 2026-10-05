# Implementation progress

The full completion plan is paused at the user's request on 2026-09-29.
Resume context: handoff-2026-09-29.md and decision-summary.md.
Passing static checks does not prove
database authorization, authenticated browser flows or production readiness.

## Implemented locally

- Hardened create/update project action exception handling and ambiguous mutation
  responses. Auth/membership errors now fail closed even alongside apparent data;
  role checks reuse the already authenticated client, eliminating a second Auth
  round trip. Strict UUID validation precedes update access. Next.js/Supabase skills
  guided safe action responses. Eleven regressions bring the suite to 157; tests,
  lint/typecheck pass. Creation idempotency and hosted browser acceptance remain pending.

- Restricted direct project UPDATE to the same four fields accepted by its Server
  Action, protecting tenant/id/creator/timestamps from mass assignment. Supabase
  privilege skills guided the database boundary. SQL verifies an owner of two
  organizations cannot silently move a project while normal edits still work.
  All twenty local migrations pass; hosted acceptance and explicit transfer remain
  unimplemented/unverified.

- Added project admission checks for retained organization membership and atomic
  project-role removal on organization revocation. Sole project owners must transfer
  first; failures roll back organization/project changes; rejoin cannot resurrect
  prior project roles. Supabase/Postgres skills guided private trigger privileges,
  KEY SHARE admission and deterministic project ordering. All nineteen migrations
  and sequential acceptance pass. Hosted and multi-session races remain unverified.

- Added internal organization/project last-owner guards and immutable membership
  identities. Parent-row writes follow Postgres concurrency guidance; sequential
  SQL verifies owner removal/demotion denial, transfer and deletion cascades.
  Updated the Storage-revocation fixture to transfer ownership first. All eighteen
  migrations pass. Multi-session/Repeatable Read/deadlock tests and coordination
  between organization revocation and project ownership remain pending.

- Revoked client TRUNCATE/REFERENCES/TRIGGER across all eleven application tables,
  including column REFERENCES and migration-role future defaults. Supabase privilege
  skills and PostgreSQL's RLS documentation guided protection of operations outside
  row policies. Catalog checks cover both anon/authenticated, and direct TRUNCATE
  attempts are denied for every table in the disposable fixture. Seventeen local
  migrations pass; no hosted permissions or actual data were changed.

- Restricted inbox client writes to read_at only. Direct SQL verifies own read
  marking, denied producer-content/recipient forgery, denied INSERT/DELETE/TRUNCATE
  and invisible foreign rows. Existing message notification trigger acceptance
  still passes. All sixteen migrations pass; hosted changes remain unapplied.
  Updated the SQL runner success label to reflect actual acceptance suites.

- Restricted generation job client INSERT to project/requester/input, revoked
  broad and column-level mutation privileges, and removed client UPDATE policy.
  Supabase privilege/RLS skills and official column-security docs guided separating
  eligible rows from worker-owned fields. Direct SQL verifies default queued jobs,
  denied status/output changes, forged requester/outsider denial and service-role
  completion. All fifteen migrations pass. Hosted application and actual generation
  provider/worker/cancellation/quota flow remain pending.

- Added disabled-by-default machine cleanup POST endpoint with a distinct 64-hex
  bearer credential, constant-time digest comparison, no URL secrets, no-store and
  generic errors. It invokes one item only. Next.js skill guided Node Route Handler
  placement. Tests cover authorization/config/feature flags/results and the exact
  proxy exemption; neighboring APIs still require sessions. No schedule or live
  deletion is enabled. Context7 remains unavailable until re-authentication.

- Added worker-specific 20-second HTTP deadlines through the installed SDK's
  custom-fetch option. Eleven transport cases cover option preservation, caller
  signals, invalid deadlines, hanging transport and a real loopback response
  stalled after headers. All 121 tests, typecheck/lint and production build pass.
  Supabase skill kept the transport server-only; Context7 authentication remains
  expired. This does not prove hosted cancellation or eliminate worker pause races.

- Added eleven adapter cases (110 total tests), including malformed/null claims,
  empty queues, redacted RPC failures, unknown inspection results, referenced paths,
  Storage errors and uncertain completion. Fixed a discovered Supabase thenable
  typing issue by normalizing RPC to a Promise before catch. SQL now verifies
  original and version references independently under the service role. All local
  SQL, unit tests, lint and typecheck pass; multi-session and live HTTP remain pending.

- Added service-role-only invoker RPCs for atomic SKIP LOCKED claim, reference
  inspection/lease renewal and token+expiry-checked completion/retry. Sequential
  SQL covers no double claim, stale/expired tokens, reclaim, backoff and terminal
  completion across fourteen migrations. Added server-only RPC/Storage adapter;
  no scheduler or client endpoint is enabled. Postgres skill guided short SQL
  transactions and non-blocking claims. Hosted and multi-session acceptance remain
  pending; no real storage deletion was invoked.

- Added server-only deletion consumer core and fifteen failure-path tests (99
  total). Invalid/cross-project jobs have no effects; live references and stale
  leases prevent removal; failures retain only generic codes; uncertain completion
  waits for reclaim. Context7 lookup was attempted but OAuth expired. Database
  lease adapter, scheduled execution and real concurrent Storage acceptance remain
  pending; no real files or hosted state were modified.

- Completed the previously empty Storage tombstone migration using a restrictive
  INSERT policy rather than an unsupported managed-schema trigger. Context7
  confirmed Storage schema ownership constraints. Direct metadata insertion of
  retired original/version paths is denied, fresh paths work, and a broader
  permissive policy cannot override the restriction. All thirteen local migrations
  pass. Hosted HTTP, service-role fencing and concurrent races remain unverified.

- Added path tombstones for queued/completed deletions and transaction-scoped
  advisory coordination for asset/version metadata writers and queue enqueue.
  Sorted path locking follows the Postgres skill's concurrency guidance.
  All twelve migrations and SQL acceptance pass; corrected a test that had no
  remaining asset fixture for its version insertion. Multi-session concurrency,
  raw Storage path retirement and the worker remain pending.

- Added private media deletion outbox and internal BEFORE DELETE trigger that
  snapshots original/version paths transactionally and survives parent cascades.
  Local rollback/cascade/privilege acceptance passes all eleven migrations.
  Fixed SQLSTATE 42702 variable/column ambiguity found by the first test run.
  Hosted application, queue consumer, lease fencing, reference coordination and
  switching the synchronous action remain pending; no real files were removed.

- Media deletion now refuses files referenced by other readable assets/versions
  and fails closed when reference queries fail. Two mocked regression cases were
  added. This check is not a lock: concurrent metadata updates or references
  hidden by RLS still require canonical-path invariants and a privileged durable
  deletion workflow before enabling production deletion.

- Added synchronous media deletion Server Action with confirmation, Auth,
  owner/editor checks, canonical original/version paths, bounded Storage removal
  and returned-row confirmation. Six cases pass (82 total), plus lint/typecheck.
  UI is not connected. Distributed failure/concurrent-version reconciliation
  remains mandatory; this is not production-safe atomic deletion.

- Production build with an invalid service-role canary succeeds; the configured
  marker is absent from all 24 current client files. CI now builds with this
  non-credential canary before its client-secret gate, so the comparison is no
  longer empty. Local process environment is restored afterward. Actual hosted
  CI, SSR response inspection and production credential boundaries remain pending.

- Added client-bundle secret detector and post-build CI gate. Three Node detector
  tests pass; 24 current static client files contain no detected Supabase secret
  or service-role JWT pattern. No configured server-secret values were available
  locally for comparison. Logs exclude secret contents. Full repository/history,
  SSR response and actual production-secret verification remain outstanding.

- Added five upload-handler regression cases: declared oversize pre-backend
  rejection, actual stream cancellation with absent/forged Content-Length,
  malformed multipart rejection and exception redaction. All 76 local tests,
  lint and typecheck pass. This tests the handler directly, not ingress buffering,
  slow-client timeouts or deployed host memory consumption.

- Fixed API auth interception: guests receive JSON 401/no-store rather than
  a login redirect; missing configuration returns JSON 503. Session cookies from
  refresh are retained on the denial. Production build and 30 Playwright cases
  pass, including four guest HTTP API denial runs. Existing browser auth/layout
  checks remain guest-only; authenticated upload acceptance is not established.

- Media project selection now has independent paginated search instead of only
  the first twelve projects. Both pagers preserve the normalized query and each
  other's offsets. Repeated query parameters are ignored safely. Changing the
  project-search page remounts the upload form to avoid retaining an option no
  longer in its list. Two navigation cases were added; browser acceptance remains
  pending. Results include readable projects, with upload options owner/editor
  only, so a page may have no uploadable projects.

- Media upload UI now posts to the project-scoped endpoint, validates metadata
  locally, locks controls and repeat submissions, refreshes server records after
  confirmed success and retains selection on failure. Project search uses the
  existing paginated project reader and exposes owner/editor options from its
  first page; pagination of the selector remains a limitation. Two jsdom submit
  handler cases pass (69 total), not real browser file-input/Storage acceptance.
  Ambiguous responses advise list refresh before retry; idempotency is pending.

- Added authenticated project-scoped multipart upload API with same-origin
  checks, pre-body owner/editor authorization, actual streamed body limit,
  file metadata/signature validation, immutable Storage uploads and asset
  inserts. Rejected metadata writes attempt cleanup. Seven route unit cases
  pass (67 total). UI, durable reconciliation, host body/memory constraints,
  rate/tenant quotas and real Storage/browser acceptance remain outstanding.

- Added a tested media-file validation module matching the bucket's exact size
  and MIME allowlist, canonical safe filenames and header mismatch checks for
  the eight formats. It is not yet wired into an upload endpoint. Header matches
  do not prove decoding, safe content or malware-free bytes; validation/scan and
  quarantine policy still need implementation before inline untrusted previews.

- Added per-asset private download preparation: strict UUID, getUser, asset RLS,
  canonical project path check and authenticated Storage signing for 60 seconds.
  Client displays a refreshable link and bearer-link warning; server errors are
  redacted. Seven mocked action cases bring the suite to 49 tests. This does not
  establish hosted Storage download or authenticated browser acceptance.

- Added local private project-media bucket migration with a 50 MiB MIME
  allowlist, canonical project/object paths, retained organization + project
  membership, participant reads and owner/editor upload/delete. Objects are
  immutable (no UPDATE policy). SQL acceptance passes all ten migrations and
  guards role isolation, invalid paths, deletion and membership revocation.
  Hosted application, Storage HTTP enforcement and the upload UI remain pending.

- `/media` now reads paginated asset metadata with the caller's authenticated
  client and existing RLS instead of presenting a fabricated video. It displays
  explicit empty/error states and does not expose Storage paths. Four unit
  cases cover guest denial, pagination, field selection and error redaction.
  Upload, signed preview/download, versions, cleanup and authenticated browser
  acceptance remain required; this is not a complete media workflow.

- Avatar persistence now returns success with a nullable preview URL when signing
  fails, including transport exceptions. The form updates its saved path and
  clears upload retry controls even without a preview. Cleanup exceptions are
  non-fatal and no longer promise an unimplemented automatic retry. Four added
  regression cases cover these post-persistence failures. Actual Storage HTTP
  acceptance and a durable orphan cleanup mechanism remain outstanding.

- New local migration creates in-app message notifications atomically for other
  project participants who also retain organization membership. The private
  trigger cannot be called by API roles; it copies no chat content, uses a
  unique message/recipient key and cascades deletion from the source message.
  Inbox links to the authorized chat route. Fresh SQL acceptance verifies sender
  exclusion, recipient delivery, outsider isolation and transaction rollback.
  All nine migrations pass locally; none of the new migrations was applied to
  hosted Supabase. Email/push delivery remains unimplemented.

- Added `/notifications` with personal-row pagination, timezone/language date
  formatting and a navigation bell. An authenticated mark-read action updates
  only the caller's unread row and tolerates already-read rows. Four action tests
  and SQL own/foreign notification checks pass (34 local tests in total).
  Email/push delivery, event producers and authenticated inbox browser acceptance
  remain pending; guest route protection is included in E2E.

- Added four ProjectChat component regression cases for ordering/deduplication,
  early Realtime echo versus optimistic send, failed-send draft recovery and
  reconnect catch-up. Late events from cleaned-up subscriptions are ignored.
  All 30 local unit/component tests pass, alongside lint and typecheck. Real
  two-browser/offline Supabase acceptance is still outstanding.

- Added a read-only GitHub Actions CI workflow with pinned action commits,
  frozen pnpm dependencies, route type generation, lint, unit/component tests,
  fresh embedded SQL acceptance, production build and guest desktop/mobile E2E.
  Local verification with the workflow's dummy public Supabase configuration
  passed typecheck/build and 24 browser cases; lint, 26 tests and SQL also pass.
  YAML parsed successfully. Hosted CI execution, dependency installation on the
  Linux runner and branch protection are not yet verified. No deployment occurs.

- Ordinary profile save only updates existing personal fields and cannot rewrite
  avatar_path from stale browser state. It requires a returned row for success.
  Avatar upload uses a unique UUID object path and compare-and-set against the
  previous profile path; a losing update removes its own newly uploaded file.
  Four action tests and SQL compare-and-set acceptance were added (26 local
  unit/component cases in total). This guards avatar conflicts, not optimistic
  concurrency for every editable profile field or Storage network transactions.

- Profile/Avatar component regression tests now exercise real rendered controls
  with delayed/rejected Server Action mocks. Coverage verifies operation locks,
  retry availability, preserved dirty fields, cancellation after upload, pending
  email confirmation and oversized selection rejection. The suite has 22 tests
  (17 unit plus 5 component cases); real authenticated browser acceptance remains
  pending.

- Profile save and avatar upload share an immediate operation lock. Save/cancel
  are blocked during upload; avatar controls are blocked during save; editable
  fields are disabled while their submitted snapshot is pending so the response
  cannot silently reset post-submit edits. Avatar upload releases the lock in
  finally, including network failures. Context7 resetField guidance and the React
  best-practices checklist informed this change. Authenticated component/browser
  concurrency acceptance and cross-tab server consistency are still pending.

- Embedded database acceptance now verifies two independent organization owners,
  onboarding under the authenticated role, atomic owner bootstraps, tenant
  isolation, permitted own-project writes, denied foreign writes/self-promotion
  and tenant moves, avatar ownership and preserved rows after denied writes.
  The repeat run passes; Storage HTTP enforcement and hosted RLS remain pending.

- Added `pnpm test:db`: fresh embedded PostgreSQL applies all eight migration
  files unchanged, then seed and RLS acceptance SQL. The first run reproduced
  infinite RLS recursion (42P17) between projects and project_members; a new
  local migration replaces the member-read join with a narrowly scoped private
  membership predicate. The repeat run passes. Hosted migration application and
  full Supabase service acceptance remain pending.

- E2E now covers 24 guest cases on desktop and mobile Chromium (390px), with
  auth-page runtime/layout/image checks and all current private-route redirects.
  All passed outside the restricted Windows sandbox with normal process cleanup.
  Removed redundant shutdown configuration; Context7 confirms Windows ignores
  gracefulShutdown. The restricted run hung while the approved unrestricted run
  exited in seconds; no application teardown defect was established.

- Project deletion requires a returned deleted row before reporting success or
  invalidating the list. Invalid IDs fail before database access and rejected
  requests return safe errors. Project-action regression coverage brings the
  local suite to 17 passing unit tests; these mock the database and do not
  replace RLS integration acceptance.

- Project dialogs use native modal focus containment and Escape handling, restore
  focus to the trigger, show successful submission results, prevent repeat
  submission after success and expose only eligible creation organizations.
  Pending requests cannot be dismissed. Authenticated browser verification is
  still required. README now documents the Next.js runtime instead of the legacy
  static prototype.

- Tenant-scoped project SELECT/INSERT RLS migration with explicitly qualified
  outer-row organization IDs. Not applied or verified against a database yet.
- Project editing no longer requires the disabled organization form field and
  does not accept organization reassignment. Zero-row updates return an error.
- Project pagination retains search, type, status and organization filters.
- Server Action request limit supports the 5 MiB avatar limit plus form overhead.
- Profile errors are displayed, request failures terminate the saving state,
  and pending email confirmation is communicated without showing an unconfirmed
  address as the persisted profile address.
- Avatar upload failures terminate the uploading state. Saving an avatar updates
  only its saved form baseline; cancelling other edits restores persisted values.
- ESLint ignores package-manager cache and generated test/CLI artifacts.
- Chat initially loads the latest 100 messages, supports older-message keyset
  pagination, and catches up after subscription/reconnection in 200-row batches.
  Its checkpoint advances only after catch-up completes; live events and fetched
  messages are deduplicated. Two-user/offline browser acceptance remains required.
- Organization onboarding page and authenticated createOrganization action.
  The owner membership is created atomically by a private trigger migration.
  Remote application of both new migrations was rejected by automatic approval
  review; the remote database is unchanged and onboarding is not runtime-verified.

## Required next stages

1. Reproducible disposable database, cross-organization RLS acceptance and clean
   migration execution, including private Storage tests.
2. Organization onboarding, invitations and initial project creation.
3. Authenticated project/profile/upload browser regression tests.
4. Complete generation flow and worker with idempotency, retries and cancellation.
5. Private media library and file cleanup lifecycle.
6. Team management and chat history/reconnection recovery.
7. Working language/timezone/notification behavior.
8. Reliable E2E teardown, mobile acceptance and deployment/rollback verification.

Documentation consulted through Context7: Supabase tenant-scoped RLS and React
Hook Form resetField/server-error handling. The implementation uses resetField,
which is present in the installed React Hook Form version.
