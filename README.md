# Viral Studio

Run locally:

```powershell
pnpm install --frozen-lockfile
pnpm dev
```

Copy `.env.example` to `.env.local` and configure the public Supabase URL and
publishable/anon key before running. Never put a service role key in a
`NEXT_PUBLIC_` variable. Open `http://localhost:3000/`.

Build and run the Next.js production application:

```powershell
pnpm build
pnpm start
```

Checks: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e`.

Database setup and pending migrations: [database](docs/database.md).
Verification scope: [testing](docs/testing.md).
Backend implementation and deployment handoff: [2026-10-11 checkpoint](docs/backend-implementation-2026-10-11.md).
Connected Supabase reconciliation and live SQL checks: [database repair journal](docs/database-repair-plan-2026-10-11.md).
Remaining release blockers: [implementation progress](docs/implementation-progress.md).
The application is not yet production-ready; authenticated browser, database
isolation and generation-worker acceptance are still required.

The old static prototype remains available through `pnpm legacy:dev` and
`pnpm legacy:build`; it is not the production application.
