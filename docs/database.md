# Viral Studio database

## Client structural privileges

The local follow-up migration revokes TRUNCATE, REFERENCES and TRIGGER from
PUBLIC/anon/authenticated on all eleven application tables, including per-column
REFERENCES grants. RLS does not guard whole-table TRUNCATE/REFERENCES operations.
Default privileges are tightened for future public tables owned by the migration
role; other table owners require their own defaults review. Disposable SQL tests
assert the complete table inventory, effective role/column privileges and denied
TRUNCATE attempts. Existing CRUD/trigger acceptance still passes. Hosted grants
have not yet been changed or certified by these local checks.

## Ownership model

Client project UPDATE is restricted to name/description/status/type. Project id,
organization_id, created_by and timestamps cannot be reassigned through direct
Data API edits, even if the editor belongs to both organizations. Tenant transfer
is not implemented and must be a separate workflow coordinating membership/media.
SQL verifies protected-column denial while ordinary edits and internal ownership
guards continue working.

Local membership triggers prevent deleting/demoting the sole owner of an existing
organization/project and prohibit changing membership parent/user identifiers.
Owner-removal checks write the parent row to serialize concurrent changes (parent
updated_at reflects successful ownership changes); Repeatable Read retries may
be required. Parent deletion cascades remain allowed. Sequential SQL covers last
owner denial, transfer, identity changes and parent cascades. True multi-session
concurrency/deadlocks and legacy ownerless data acceptance remain pending. These
The organization-revocation follow-up removes that user's project memberships
in deterministic project order within the same transaction. A sole project owner
must transfer ownership first; failed revocation rolls back all changes. Rejoining
an organization does not restore old project roles. Project admission/update
requires a retained organization membership, held with KEY SHARE against deletion.
Sequential rejection, rollback, removal and rejoin tests pass; multi-session
admission/revocation races and deadlock retries still require real PostgreSQL tests.

`auth.users` is the identity source. `profiles.id` is a one-to-one UUID foreign key to it. An organization has many `organization_members`; a user can therefore belong to many organizations. Every project belongs to exactly one organization and has an explicit `project_members` role: `owner`, `editor`, `commenter`, or `viewer`.

```
auth.users ── 1:1 ── profiles
     │
     ├── organization_members ── organizations ── projects ── project_members
     │                                             │
     │                                             ├── assets ── asset_versions
     │                                             ├── messages
     │                                             └── generation_jobs
     └── notifications
```

## Files

- `supabase/migrations/20260929000000_viral_studio_schema.sql` creates the schema, constraints, indexes, triggers and RLS policies. `20260929010000_profile_preferences.sql` evolves `profiles` to include `name`, Auth-synchronised `email`, `role`, `language`, `timezone`, `avatar_path`, and the three persisted notification preferences. `20260929030000_project_types_and_owner_membership.sql` adds the AI/agency project type and automatically makes a new project's creator its owner. `20260929040000_messages_realtime_and_limit.sql` aligns the database chat limit to 4,000 trimmed characters and adds `messages` to the Realtime publication.
- `20260929020000_private_avatars_storage.sql` creates the private `avatars` bucket. It permits only JPG, PNG and WebP up to 5 MiB, and Storage RLS limits every object operation to the authenticated owner folder.
- `supabase/seed.sql` populates a disposable development database after three Auth users have been created through the Auth API. It deliberately does not insert raw credentials into `auth.users`.
- `supabase/tests/rls_acceptance.sql` exercises the owner, commenter/viewer, and outsider identities with transaction rollback.

## RLS rules

- Profiles are private to `auth.uid()`.
- Organization access requires a matching `organization_members` row.
- Organization participants can read their organization’s projects; project edits require `owner` or `editor`.
- Asset reads require a `project_members` row; asset writes require `owner` or `editor`.
- `commenter`, `editor`, and `owner` can create messages; a sender may edit/delete only their own messages.
- Notifications are readable and mutable only by their `user_id`.
- Generation jobs are readable by project participants and writable by owners/editors.
- Audit log rows are read-only to matching organization/project participants; clients get no write policy.

Every policy is `TO authenticated`, compares IDs to `(select auth.uid())`, and includes `WITH CHECK` for writes that could otherwise reassign ownership. All application tables in `public` have RLS enabled.

The profile’s email is synchronized from `auth.users` by a restricted trigger. A profile email change is requested through Supabase Auth, so installations that require email confirmation do not replace the displayed email until the address is confirmed. The creation trigger supplies only display defaults; it never makes authorization decisions from user metadata.

The two owner-membership checks are `SECURITY DEFINER` functions only because querying a membership table from its own policy would recurse indefinitely. They reside in the non-exposed `private` schema, use a fixed `search_path`, have `PUBLIC` execution revoked, and are granted only to `authenticated` for use inside RLS policies.

## Generation model catalog and pricing

`20261118090000_multimodel_generation_jobs.sql` (local only, not applied to any
hosted database) makes generation multi-model:

- `private.generation_models` is the catalog: `model_key` (primary key),
  `provider` (`fal-ai` legacy Hugging Face router, or `fal`), `endpoint`,
  `request_path_prefix` (the first path segments of the provider's queue
  `response_url`), `cost_micro_usd` (1..5,000,000, or NULL = unpriced) and
  `enabled` (default false; enabling requires a price). RLS is on and every
  client role is revoked: only `service_role` reads or writes it, and clients
  never see prices. Seeds: legacy `Lightricks/LTX-Video-0.9.7-distilled`
  (50,000, enabled), `ltx` and `minimax` (50,000, enabled), `kling` and
  `seedance` (unpriced, disabled).
- `generation_jobs.provider`/`model` now reference the catalog through a
  composite foreign key (the former single-model CHECKs are dropped by a
  fail-closed constraint lookup). `reservation_micro_usd` and
  `charged_micro_usd` allow 0..5,000,000; `provider_request_path` accepts any
  `/seg/seg[/seg[/seg]]/requests/<id>` shape. Participants may additionally
  select `model`; `provider` and `provider_request_*` stay hidden.
- `provider_request_id` stores the id from `provider_request_path` (backfilled)
  with a consistency CHECK and a partial unique index on `provider_request_id`
  alone (`fal-ai` and `fal` share Fal's id space). Use it to reconcile with the
  provider.
- `authorize_generation_dispatch` closes a not-yet-submitted job without charge
  (`failed`, `last_error_code = 'model_disabled'`) when its catalog row is
  disabled and returns false; submitted jobs keep finishing.
- `public.create_generation_job(target_project, request_key, generation_prompt, model_key)`
  (security invoker, `authenticated`) reserves the catalog price for the chosen
  model. Unknown, disabled or unpriced models fail with
  `Generation model unavailable` (SQLSTATE 22023). Replaying a key returns the
  existing job even if the model has since been disabled; a key reused with a
  different model, project or prompt is an idempotency conflict (23505). The
  3-argument overload is unchanged and always uses the legacy model.
- `claim_generation_jobs(integer)` and `claim_generation_job_for_view(uuid, uuid)`
  additionally return `provider` and `model`. `record_generation_submission`
  and `reconcile_generation_submission` require the path to start with the
  job's catalog `request_path_prefix || '/requests/'`.
- `public.set_generation_model_price(model_key, cost_micro_usd, enabled)`
  (`service_role` only) changes a price and the enabled flag; price changes
  never alter reservations already taken. Example:
  `select public.set_generation_model_price('kling', 70000, true);`
- Acceptance: `supabase/tests/multimodel_generation_acceptance.sql`.

Rollout notes for this migration:

1. Deploy the code with `GENERATION_MULTIMODEL_ENABLED=false`.
2. Owner review of the migration.
3. Apply it with `supabase db push` or `psql --single-transaction` (the
   `set local lock_timeout` needs a transaction), while the scheduled workers
   are quiet; it takes ACCESS EXCLUSIVE on `generation_jobs` briefly.
4. Expect transient PostgREST `PGRST202` errors until the schema cache reloads
   (`notify pgrst, 'reload schema'` if it lingers).
5. Confirm `claim_generation_jobs` returns `provider` and `model`.
6. Set `FAL_KEY`, then set `GENERATION_MULTIMODEL_ENABLED=true`.

## Applying and testing

The PGlite runner discovers and applies every local migration SQL file in
filename order, unchanged, against explicitly modelled Supabase-owned schemas;
it is not a complete Supabase installation. The 2026-10-05 run applied 20
migrations and passed 14 dynamically discovered SQL acceptance files. See
[`database-verification-2026-10-05.md`](database-verification-2026-10-05.md)
for evidence and remaining verification. The last inspected hosted project was
`sytjbknfwwbombypwfhc` (Viral_Studio), with five earlier migration entries whose
timestamps differ from the local first five. New local migrations have not been
applied there. Reconcile history on disposable staging before hosted application;
do not treat the local and hosted histories as interchangeable. Remote RLS and
owner-trigger changes were denied by approval review; they remain unapplied.

Local follow-up migrations qualify tenant predicates, bootstrap organization
owners, avoid project-members policy recursion, generate message notifications,
and protect project-media Storage. Run `pnpm test:db` to apply every migration
and discover all `*_acceptance.sql` suites in a fresh PGlite database. For
full-stack acceptance use an empty disposable Supabase database,
three real Auth identities and Storage HTTP/Realtime checks. Never seed production.

Tables: `profiles`, `organizations`, `organization_members`, `projects`,
`project_members`, `assets`, `asset_versions`, `messages`, `notifications`,
`generation_jobs`, `audit_log`. All eleven public application tables enable RLS.

RLS acceptance cases:

1. Authenticate as the owner and select `projects`: both seeded projects are visible.
2. Authenticate as the viewer and select `assets`: only assets for projects where they have `project_members` are visible.
3. Authenticate as a third user outside the organization: `projects`, `assets`, messages, and audit rows return no rows.
4. Authenticate as the viewer and run `update projects set name = 'x' where id = '<viewer-project>'`: zero rows update because `viewer` is not an editor.
5. Authenticate as the commenter and insert a message into `project_one`: it succeeds; inserting into a non-member project fails RLS.

Inspect the declared indexes with `pg_indexes` or the Supabase Table Editor after applying the migration.
