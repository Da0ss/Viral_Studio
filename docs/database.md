# Viral Studio database

## Ownership model

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

- `supabase/migrations/20260929000000_viral_studio_schema.sql` creates the schema, constraints, indexes, triggers and RLS policies. `20260929010000_profile_preferences.sql` evolves `profiles` to include `name`, Auth-synchronised `email`, `role`, `language`, `timezone`, `avatar_path`, and the three persisted notification preferences.
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

## Applying and testing

The configured Supabase project `jszaosficdefykelseql` is currently inactive, so no migration has been applied remotely. After it is activated, apply the migration with the Supabase migration workflow, create the two seed Auth accounts, then execute `supabase/seed.sql` using a service role in a disposable environment.

RLS acceptance cases:

1. Authenticate as the owner and select `projects`: both seeded projects are visible.
2. Authenticate as the viewer and select `assets`: only assets for projects where they have `project_members` are visible.
3. Authenticate as a third user outside the organization: `projects`, `assets`, messages, and audit rows return no rows.
4. Authenticate as the viewer and run `update projects set name = 'x' where id = '<viewer-project>'`: zero rows update because `viewer` is not an editor.
5. Authenticate as the commenter and insert a message into `project_one`: it succeeds; inserting into a non-member project fails RLS.

Inspect the declared indexes with `pg_indexes` or the Supabase Table Editor after applying the migration.
