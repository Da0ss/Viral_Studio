# Viral Studio architecture

Viral Studio is a Next.js 16 App Router application backed by Supabase Auth,
Postgres, Realtime and Storage. The browser receives only the Supabase URL and
publishable/anon key. Server Components and Server Actions create an SSR
Supabase client using request cookies; RLS is the final authorization boundary.

## Pages

| Route | Current implementation |
| --- | --- |
| `/` | Application entry |
| `/login`, `/register` | Auth forms; real authenticated acceptance pending |
| `/forgot-password`, `/reset-password` | Recovery/update forms; real email flow pending |
| `/onboarding` | Organization creation; owner trigger local, hosted pending |
| `/projects` | CRUD, filters and pagination; authenticated browser acceptance pending |
| `/projects/[projectId]/chat` | Send/history/Realtime reconnect; two-user hosted acceptance pending |
| `/profile` | Preferences/email/avatar persistence; authenticated browser acceptance pending |
| `/notifications` | Personal inbox and read state; message producer local, hosted pending |
| `/media` | Metadata, paginated project selection, upload UI and short-lived download links; hosted bucket/upload acceptance pending |
| `/create` | Static introduction; generation CTA has no implementation |
| `/team` | Static introduction; invitations/role management not implemented |

`src/proxy.ts` refreshes the Auth session and redirects unauthenticated requests
to `/login?next=<internal-path>`. Only local, slash-prefixed, non-backslash
paths are accepted as return destinations.

## Boundaries

- `src/lib/supabase/browser.ts`: client Realtime access with the publishable key.
- `src/lib/supabase/server.ts`: cookie-bound SSR client.
- `src/lib/supabase/admin.ts`: server-only service-role factory. No Client
  Component imports it.
- `src/actions/*`: mutation boundary with validation, authenticated user checks,
  application permission checks, then RLS enforcement.

## API and Server Actions

- `GET /auth/callback`: exchanges an Auth code and validates the internal return path.
- `POST /api/projects/[projectId]/media`: authenticated owner/editor upload;
  same-origin, bounded body, file validation, user-scoped Storage and asset insert.
- `POST /api/internal/media-cleanup`: separate machine bearer token, disabled by
  default; runs at most one claimed deletion. Exact proxy exception delegates
  authorization to the handler; no other internal path is exempted.
- Auth actions: `login`, `register`, `requestPasswordReset`, `updatePassword`, `logout`.
- Projects: `createProject`, `updateProject`, `deleteProject`.
- Profile: `updateProfile`, `uploadAvatar`.
- Organization: `createOrganization`.
- Chat/inbox/media: `sendMessage`, `markNotificationRead`, `prepareMediaDownload`.

Guest API requests receive JSON 401 rather than a login redirect; missing public
configuration returns JSON 503. Route handlers/actions remain responsible for
their own authentication/authorization. Generation jobs are database records,
not an implemented generation worker. No generation or invite API exists. Media
cleanup has a server adapter and disabled machine endpoint, but no active scheduler.

## Launch and completion gates

Local: `pnpm install --frozen-lockfile`, configure `.env.local`, `pnpm dev`.
Production compilation: `pnpm build`; local production runtime: `pnpm start`.
Passing a build is not deployment approval. See `testing.md` for test scope and
`production-readiness.md` for unresolved acceptance requirements.
# Notifications inbox

`/notifications` reads the authenticated user's rows with bounded pagination.
The header provides a bell link. A mark-read action checks Auth, scopes updates
by user_id and notification id, and changes only read_at. Already-read rows are
idempotent; missing/foreign rows return a generic unavailable response. Date
formatting uses profile language/timezone. This is an in-app inbox only: no email
or browser push delivery. A local database trigger produces in-app notifications
for new project messages; its hosted application remains pending.
