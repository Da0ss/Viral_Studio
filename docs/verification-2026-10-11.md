# Verification — 2026-10-11 (frontend plan T01, T03–T05, T07, T08)

Branch `deniz/frontend-plan`, based on `main` at `ad1d93a`. This is a local
checkpoint, not production approval. Nothing was deployed, no migration was
applied anywhere, and no paid provider call was made.

Tools: Node 22.22.0, pnpm 10.28.0, Next.js 16.2.2, Vitest 5.0.2,
Playwright 1.63.0 (Chromium 1194 via `launchOptions.executablePath`).

## Status by level

| Area | Implemented | Checked locally | Checked on real Supabase | Staging | Published |
|---|---|---|---|---|---|
| T01 upload/membership tests | yes | yes | n/a | no | no |
| T03 team load errors vs empty states | yes | unit/component | no | no | no |
| T04 RU/EN/KK for auth, onboarding, team, chat, generation, actions | yes | unit/component | no | no | no |
| T05 filter names, menu label, Escape, contrast | yes | component + e2e | n/a | no | no |
| T07 media versions in library | yes | unit/component | **no** | no | no |
| T08 generation history `/generations` | yes | unit + guest e2e | **no** | no | no |

## Results

| Check | Result |
|---|---|
| `pnpm lint` | pass |
| `pnpm typecheck` | pass |
| `pnpm test` (Vitest) | 41 files, 299 passed, 0 failed |
| `pnpm test:db` (PGlite) | 26 migrations, 18 SQL acceptance files passed |
| `pnpm build` | pass |
| `pnpm test:client-secrets` | pass, 32 client files |
| `pnpm test:repository-secrets` | pass |
| Playwright desktop + mobile Chromium | 48 passed, 20 skipped, 0 failed (two consecutive runs) |

The build and e2e used a placeholder `NEXT_PUBLIC_SUPABASE_URL`
(`http://127.0.0.1:54321`, nothing listening) and a dummy publishable key, so
guests are exercised against an unreachable Auth service.

Of the 20 skips, 16 are repeated viewports the responsive spec deliberately
runs in one project only, and 4 are authenticated scenarios that need a real
local Supabase with E2E credentials.

## Blocked here

Docker/Podman are not available in this environment, so these did not run:
`test:db:supabase`, `test:db:services`, `test:db:concurrency`,
`test:e2e:supabase` and the authenticated e2e. T07 and T08 read through the
caller's RLS and column grants; that has only been checked with mocks and must
be confirmed against a real local Supabase before release.

## Found and fixed along the way

- Upload tests depended on the calendar date (token expiry 2026-10-06).
- `/favicon.ico` 404 made console-error e2e checks flaky on `main` too; the
  app now ships `src/app/icon.svg`.
