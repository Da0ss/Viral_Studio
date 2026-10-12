# CI recovery — 2026-10-12

All builds and automated checks in this recovery run execute in GitHub Actions.
No local tests or builds were run.

## Observed evidence

- `c128633`: general verification passed; authenticated browser acceptance failed during locale changes and media upload.
- `a23371f`: bounded error diagnostics identified a same-origin media request rejected with `msg.common.forbidden`. Its browser origin was the configured public origin; Next reconstructed a different internal request origin.
- `ff7d3d2`, [run 38174119656](https://github.com/Da0ss/Viral_Studio/actions/runs/38174119656): lint, types, unit/component, clean migrations, secret checks, production build and guest desktop/mobile acceptance passed. Real Supabase SQL, Auth, RLS, Storage, Realtime and ownership concurrency checks passed. Desktop authenticated acceptance reached media upload/download, chat/reconnect, private notifications and deletion.
- That run still failed recovery: the callback exchanged the code successfully, then redirected from `127.0.0.1` to Next's reconstructed `localhost` host. The host-only session cookie was absent on the password-reset request.
- Mobile acceptance failed before its third language save. Trace showed an enabled server-rendered language field being changed before registration; hydration replaced the early selection with the persisted value, leaving Save disabled. No save request was sent.

## Changes awaiting the next remote run

Authentication callback redirects use the validated configured public origin, with no trust in forwarded host headers. Missing production origin fails closed. Profile fields remain disabled until React Hook Form registration is ready.

Upload improvements preserve the original idempotency key after uncertain Storage or finalization responses. Missing/unavailable Storage bytes remain retryable; verified integrity failures remain terminal. Duplicate Storage acknowledgements proceed through server verification. Signed uploads use a scoped public client with a request deadline and no persisted auth session. A retry first checks the existing intent, allowing a completed upload to recover without creating a duplicate.

Regression coverage includes canonical recovery redirects, missing production configuration, server-rendered profile readiness, transient finalization failures, duplicate Storage acknowledgements, retry key reuse and upload cancellation signals.

Direct browser access to the published Vercel alias remains denied by the saved browser permission setting. GitHub Actions exercises a production build against its disposable real Supabase stack; this does not constitute browser verification of the published production site.
