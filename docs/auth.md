# Authentication and authorization

Supabase Auth handles registration, password login, password-reset email and
password update. The browser never stores credentials in application state.

- Login redirects only to a validated internal `next` path.
- `/auth/callback` exchanges an Auth code, then applies the same redirect rule.
- Password reset has a generic response to avoid account enumeration.
- Password update checks `auth.getUser()` before calling `updateUser`.
- The proxy protects non-public routes. Server Actions independently check the
  authenticated user; do not rely on the proxy alone.

Authorization is implemented twice by design: an action gives a readable error
for an expected role failure, while Postgres RLS protects against forged action
requests. Roles are organization `owner/admin/member` and project
`owner/editor/commenter/viewer`.
