# Google Authentication Design

## Goal

Add production-grade Google authentication to the currently deployed RC Mania
Next.js application while the rest of the experience continues to run with
`MOCK_MODE=true`. Authentication, users, sessions, and money balances must be
real and persistent; vehicle availability, payments, queues, and rides remain
mocked until their production integrations are enabled separately.

## Chosen approach

The current VPS deployment contains only the standalone Next.js web service.
The authentication boundary will therefore live in that service, using Auth.js
with Google OpenID Connect and a private PostgreSQL service on the same Docker
network. This is smaller and safer for the current deployment than exposing and
operating the Nest API, Redis, and the rest of the future platform solely for
login.

The implementation will preserve the existing platform data model instead of
introducing an unrelated Auth.js schema. A focused custom adapter will map
Auth.js operations to the existing `users` and `oauth_identities` tables and to
new session and money-balance tables.

Rejected alternatives:

- Deploying authentication through the Nest API now would align with the final
  service topology but would introduce several services that the public mock
  preview does not otherwise need.
- A cookie-only user session without persistent user records would be easier to
  deploy but would not support durable balances, account disabling, or future
  ownership of purchases and rides.

## User experience

### Signed out

The account control in the top-right header shows the existing user icon with:

- primary text: `SIGN IN`
- secondary text: `WITH GOOGLE`

Activating it starts the Google redirect flow. After a successful login, the
user returns to the page from which they started. It must not display a mock
identity or fabricated balance while signed out.

### Signed in

The account control shows locally rendered initials, the formatted USD balance
(initially `$0.00`), and the existing `BALANCE` label. Activating it opens a
small account menu containing the user's display name, email address, current
balance, and a `SIGN OUT` action.

The Google profile image will not be hot-linked in the first implementation.
Initials keep the header reliable, avoid a third-party image request on every
page view, and fit the existing visual language.

The header must remain usable at the current desktop and mobile breakpoints.
Long names and email addresses are truncated in the compact control and shown
in full in the account menu where space permits.

### Failure states

- A cancelled or failed Google login returns to a dedicated, non-sensitive
  error state with a retry action.
- If PostgreSQL is unavailable, login fails closed and no session cookie is
  issued.
- A disabled user cannot create or refresh a session.
- If account data cannot be loaded for an existing page, the UI presents the
  signed-out control rather than a fabricated user or balance.

## Authentication flow

1. The user activates `SIGN IN`.
2. Auth.js creates the authorization request and protects it with OAuth state,
   PKCE, and nonce validation.
3. Google redirects to
   `https://rcmania.live/api/auth/callback/google`, which exactly matches the
   registered production redirect URI.
4. The callback accepts only an ID token with the expected issuer and audience
   and requires a verified email address.
5. The adapter resolves the identity by `(provider, provider_subject)`.
6. If the Google subject is new, a verified normalized email may link to an
   existing user only when that user has no conflicting Google identity.
   Otherwise a new user and OAuth identity are created atomically.
7. A zero-valued USD balance row is created atomically for a new user.
8. A random opaque session token is issued in a secure cookie. Only a hash of
   that token is persisted in PostgreSQL.
9. The user is redirected back to a validated same-origin return path.

The application requests only `openid`, `email`, and `profile`. It does not
store Google access tokens or refresh tokens because it does not call Google
APIs on the user's behalf.

## Session security

- Cookie attributes: `HttpOnly`, `Secure`, `SameSite=Lax`, host-only, and
  `Path=/`.
- Session lifetime: seven days, with server-side activity refresh no more than
  once per 24 hours.
- Session tokens are generated from a cryptographically secure random source
  and stored only as hashes in PostgreSQL.
- Sign-out deletes the database session before clearing the cookie.
- Account disabling invalidates all active sessions for that user.
- Authentication routes trust the configured canonical origin
  `https://rcmania.live`, not arbitrary forwarded hosts.
- Post-login return URLs are restricted to same-origin paths to prevent open
  redirects.

## Data model

### Existing tables

- `users`: durable account identity, normalized unique email, display name,
  role, and `disabled_at`.
- `oauth_identities`: maps provider `google` and Google's immutable `sub` claim
  to one RC Mania user.

### New `auth_sessions` table

- `id`: UUID primary key.
- `user_id`: required foreign key to `users` with cascade deletion.
- `token_hash`: unique hash of the opaque browser token.
- `expires_at`: required expiration timestamp.
- `last_seen_at`: timestamp used for bounded sliding renewal.
- `created_at` and `updated_at`: audit timestamps.

Indexes cover `token_hash`, `user_id`, and expiration cleanup.

### New `account_balances` table

- `user_id`: primary key and foreign key to `users`.
- `currency`: ISO currency code, initially `USD`.
- `amount_minor`: integer minor-unit balance, initially `0`.
- `created_at` and `updated_at`: audit timestamps.

The existing time-based wallet and wallet-lot tables remain unchanged. Money
must not be stored in fields named or constrained as seconds. A transactional
money ledger will be introduced with the real payment integration; until then
the balance is read-only and remains `$0.00`.

## Application boundaries

The authentication implementation is split into focused units:

- Auth.js route/configuration: provider setup, session policy, callbacks, and
  error redirects.
- Database adapter: user, identity, session, and balance persistence.
- Account query: exposes only the minimum session-safe user and formatted
  balance data required by the header.
- Account UI: signed-out control, signed-in control/menu, and sign-out action.

Client components never receive the Google client secret, raw session token,
or database credentials. Authorization decisions use the server-side session,
not client-provided user identifiers.

## VPS deployment

PostgreSQL runs as a Docker Compose service with:

- no published host port;
- an internal application network shared only with the web container;
- a named persistent volume;
- a health check and restart policy;
- a generated database password stored outside the repository.

The web service receives `DATABASE_URL`, the Auth.js signing secret, Google
client ID, Google client secret, and canonical auth origin from a root-owned
VPS environment file with mode `0600`. The downloaded Google credential JSON
is already ignored locally and will not be copied into the image or committed.
Only the required values are installed on the VPS.

Database migrations run as a one-shot deployment step before the web container
is replaced. Following the established VPS preference, deployment removes the
old web container/image before building and starting the new image. PostgreSQL
data and its named volume are never removed by that replacement.

Nginx already terminates TLS and proxies all paths to Next.js, so the Auth.js
callback requires no new public port. Existing HTTP-to-HTTPS and `www` redirects
remain unchanged.

## Testing

- Adapter tests cover new-user creation, repeat login by Google subject,
  verified-email linking, conflicting identities, disabled users, zero-balance
  creation, session lookup, expiration, renewal, and deletion.
- Route/configuration tests cover allowed return paths and rejected external
  redirects.
- Account presentation tests cover signed-out, signed-in, long-identity, and
  loading/failure states.
- Migration tests assert the new tables, constraints, and indexes.
- The complete web and database test suites, TypeScript checks, and production
  build must pass before deployment.
- VPS verification covers PostgreSQL health, web health, HTTPS login redirect,
  Google callback, persistent login across a web-container restart, sign-out,
  and `$0.00` display.

The final Google consent interaction requires one manual browser login by an
allowed test user. No automated test will expose or log the production client
secret.

## Rollout and rollback

Before deployment, create a database backup/snapshot and retain the migration
identifier. If application verification fails, rebuild the previously deployed
Git commit and point it at the unchanged database; additive authentication
tables can remain in place. Secrets are never rolled back into source control.

The rollout is complete only when the canonical HTTPS site supports login,
page refresh, container restart, account-menu display, and logout for the
configured Google test user.

## Non-goals

- Publishing the OAuth app beyond Testing status.
- Google Drive, Gmail, Calendar, or other Google API access.
- Payment processing or mock-credit grants.
- Money-ledger transactions, refunds, or currency conversion.
- Deploying the Nest API, Redis, queues, or physical vehicle control.
- Replacing the existing mock availability and viewer-counter behavior.
