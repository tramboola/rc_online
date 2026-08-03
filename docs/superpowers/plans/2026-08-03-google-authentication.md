# Google Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver persistent Google login, database-backed secure sessions, and a real `$0.00` USD account balance in the public mock-mode RC Mania site.

**Architecture:** Auth.js 5 runs inside the existing Next.js standalone service and uses a custom adapter backed by the existing `@rc/database` PostgreSQL schema. PostgreSQL is private to the Compose network; Nginx continues to terminate TLS and proxy every auth route to Next.js.

**Tech Stack:** Next.js 16, React 19, Auth.js/`next-auth` 5.0.0-beta.32, Drizzle ORM, postgres.js, PostgreSQL 16, Vitest 4, Docker Compose.

## Global Constraints

- Authentication, users, sessions, and USD balances are real even when `MOCK_MODE=true`.
- New accounts start at `$0.00`; do not grant mock credit.
- Request only `openid`, `email`, and `profile`; do not persist Google access or refresh tokens.
- The production callback is exactly `https://rcmania.live/api/auth/callback/google`.
- Session cookie is host-only, `HttpOnly`, `Secure`, `SameSite=Lax`, and expires after seven days.
- Store only a SHA-256 hash of each opaque session token in PostgreSQL.
- Do not repurpose the existing seconds-based wallet tables for money.
- Never commit the downloaded credential JSON or runtime secret files.
- All code-facing commits use English messages.

---

### Task 1: Persistent authentication schema

**Files:**
- Modify: `packages/database/src/schema.ts`
- Create: `packages/database/migrations/0003_google_auth.sql`
- Modify: `packages/database/src/migrations.test.ts`

**Interfaces:**
- Produces: `authSessions` and `accountBalances` Drizzle tables.
- Produces: nullable `users.emailVerifiedAt`.
- Enforces: one USD balance per user, unique session token hashes, cascading session/balance deletion.

- [ ] **Step 1: Extend the migration test first**

Assert that `0003_google_auth.sql` creates `auth_sessions` and
`account_balances`, adds `email_verified_at`, checks `amount_minor >= 0`, and
indexes session expiration.

- [ ] **Step 2: Verify RED**

Run: `pnpm --filter @rc/database test -- migrations.test.ts`

Expected: FAIL because migration `0003_google_auth.sql` does not exist.

- [ ] **Step 3: Add the SQL migration and matching Drizzle schema**

Use these database shapes:

```sql
alter table users add column email_verified_at timestamptz;

create table auth_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index auth_sessions_user_idx on auth_sessions(user_id);
create index auth_sessions_expiry_idx on auth_sessions(expires_at);

create table account_balances (
  user_id uuid primary key references users(id) on delete cascade,
  currency text not null default 'USD' check (currency = 'USD'),
  amount_minor bigint not null default 0 check (amount_minor >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

- [ ] **Step 4: Verify GREEN**

Run: `pnpm --filter @rc/database test && pnpm --filter @rc/database typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/database
git commit -m "Add persistent authentication schema"
```

### Task 2: Auth adapter and session-token hashing

**Files:**
- Modify: `apps/web/package.json`
- Create: `apps/web/auth/session-token.ts`
- Create: `apps/web/auth/session-token.test.ts`
- Create: `apps/web/auth/auth-store.ts`
- Create: `apps/web/auth/postgres-auth-store.ts`
- Create: `apps/web/auth/adapter.ts`
- Create: `apps/web/auth/adapter.test.ts`

**Interfaces:**
- Produces: `hashSessionToken(token: string): string` using SHA-256 hex.
- Produces: `AuthStore`, a narrow persistence interface for users, identities,
  sessions, and balances.
- Produces: `createRcAuthAdapter(store: AuthStore): Adapter`.
- The adapter reconstructs the raw token only in its return value; persistence
  receives `hashSessionToken(rawToken)`.

- [ ] **Step 1: Add failing token tests**

Test deterministic hashing, distinct outputs, fixed 64-character lowercase hex,
and rejection of empty tokens.

- [ ] **Step 2: Verify RED**

Run: `pnpm --filter @rc/web test -- auth/session-token.test.ts`

Expected: FAIL because `session-token.ts` does not exist.

- [ ] **Step 3: Implement token hashing**

Use `createHash("sha256").update(token, "utf8").digest("hex")` and throw for
empty input.

- [ ] **Step 4: Verify token tests GREEN**

Run: `pnpm --filter @rc/web test -- auth/session-token.test.ts`

Expected: PASS.

- [ ] **Step 5: Add failing adapter tests with an in-memory AuthStore**

Cover:

- creating a user also creates a zero USD balance;
- repeat Google subject lookup returns the same user;
- verified email may link only without a conflicting Google identity;
- disabled users are rejected;
- raw session tokens never reach persisted store records;
- expired sessions return `null` and are deleted;
- delete session invalidates subsequent lookup.

- [ ] **Step 6: Verify adapter tests RED**

Run: `pnpm --filter @rc/web test -- auth/adapter.test.ts`

Expected: FAIL because the adapter and store interfaces are missing.

- [ ] **Step 7: Implement the adapter and PostgreSQL store**

Use `@rc/database`, Drizzle transactions, normalized lowercase email lookup,
atomic user/identity/balance creation, and the exact Auth.js `Adapter` method
signatures. Discard OAuth access/refresh tokens in `linkAccount`; persist only
provider and provider account subject.

- [ ] **Step 8: Verify GREEN**

Run: `pnpm --filter @rc/web test -- auth && pnpm --filter @rc/web typecheck`

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/web/auth apps/web/package.json pnpm-lock.yaml
git commit -m "Add database-backed Auth.js adapter"
```

### Task 3: Google provider, routes, and server session

**Files:**
- Create: `apps/web/auth.ts`
- Create: `apps/web/auth/config.ts`
- Create: `apps/web/auth/config.test.ts`
- Create: `apps/web/app/api/auth/[...nextauth]/route.ts`
- Create: `apps/web/types/next-auth.d.ts`
- Modify: `apps/web/app/layout.tsx`

**Interfaces:**
- Produces: `{ handlers, auth, signIn, signOut }` from `NextAuth(...)`.
- Produces: `sanitizeReturnPath(value: string | null): string` allowing only
  same-origin absolute paths beginning with one `/`.
- Session user exposes `id`, `name`, `email`, and
  `balance: { currency: "USD"; amountMinor: number }`.

- [ ] **Step 1: Write failing configuration tests**

Cover `/pricing` and `/` acceptance plus rejection of `https://evil.example`,
`//evil.example`, backslashes, and control characters. Test required environment
keys without printing their values.

- [ ] **Step 2: Verify RED**

Run: `pnpm --filter @rc/web test -- auth/config.test.ts`

Expected: FAIL because configuration helpers are absent.

- [ ] **Step 3: Implement Auth.js configuration and route**

Configure Google explicitly from `GOOGLE_OAUTH_CLIENT_ID` and
`GOOGLE_OAUTH_CLIENT_SECRET`; require `email_verified`; enable the database
session strategy with `maxAge: 604800` and `updateAge: 86400`; set the custom
adapter; populate internal user ID and USD balance in the session callback; and
route errors to `/auth/error` without exposing provider details.

- [ ] **Step 4: Add SessionProvider at the root layout**

Call `auth()` on the server and pass its result to a focused client provider so
the existing client-rendered screens can consume the session.

- [ ] **Step 5: Verify GREEN**

Run: `pnpm --filter @rc/web test -- auth && pnpm --filter @rc/web typecheck`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/auth.ts apps/web/auth apps/web/app/api apps/web/app/layout.tsx apps/web/types
git commit -m "Configure Google authentication routes"
```

### Task 4: Account header and auth error UI

**Files:**
- Create: `apps/web/app/account-presentation.ts`
- Create: `apps/web/app/account-presentation.test.ts`
- Create: `apps/web/app/account-control.tsx`
- Create: `apps/web/app/site-header.tsx`
- Create: `apps/web/app/auth/error/page.tsx`
- Modify: `apps/web/app/simulation-screen.tsx`
- Modify: `apps/web/app/styles.css`

**Interfaces:**
- Produces: `getAccountPresentation(session): SignedOut | SignedIn`.
- Signed out copy is exactly `SIGN IN` / `WITH GOOGLE`.
- Signed in copy formats integer USD minor units with `Intl.NumberFormat` and
  initially renders `$0.00` / `BALANCE`.

- [ ] **Step 1: Write failing presentation tests**

Cover signed-out copy, `$0.00`, nonzero minor-unit formatting, initials,
missing name fallback to email, and long display names.

- [ ] **Step 2: Verify RED**

Run: `pnpm --filter @rc/web test -- account-presentation.test.ts`

Expected: FAIL because the presentation module does not exist.

- [ ] **Step 3: Implement the presentation model and account control**

Use `signIn("google", { redirectTo: currentPath })` and `signOut()`. Render a
keyboard-accessible menu with name, email, balance, and `SIGN OUT`. Never render
the Google secret, subject, or session token.

- [ ] **Step 4: Extract the site header and update responsive styling**

Keep existing navigation and brand unchanged. Preserve the angular account-chip
shape, truncate compact identity text, and make the menu fit widths down to the
existing mobile breakpoint.

- [ ] **Step 5: Implement the safe auth error page**

Show `SIGN-IN FAILED`, a retry link, and a home link. Do not echo arbitrary OAuth
query parameters.

- [ ] **Step 6: Verify GREEN**

Run: `pnpm --filter @rc/web test && pnpm --filter @rc/web typecheck`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/app
git commit -m "Adapt account header for Google sign-in"
```

### Task 5: Authenticated VPS Compose stack

**Files:**
- Modify: `infra/compose/compose.vps-web.yaml`
- Modify: `infra/compose/Dockerfile.web`
- Create: `infra/compose/Dockerfile.migrate`
- Modify: `docs/deployment-vps.md`

**Interfaces:**
- Produces: private `postgres` service and named `rcmania-postgres-data` volume.
- Produces: one-shot `migrate` service that completes before `web` starts.
- Web receives `DATABASE_URL`, `AUTH_SECRET`, `AUTH_URL`,
  `GOOGLE_OAUTH_CLIENT_ID`, and `GOOGLE_OAUTH_CLIENT_SECRET` through a VPS-only
  environment file.

- [ ] **Step 1: Add a Compose structure test first**

Create a Vitest or PowerShell-backed configuration assertion that the rendered
Compose model publishes only `127.0.0.1:3000`, does not publish PostgreSQL, uses
an internal state network, and gates web on a successful migration.

- [ ] **Step 2: Verify RED**

Run: `docker compose -f infra/compose/compose.vps-web.yaml config`

Expected: rendered configuration has no PostgreSQL or migration service.

- [ ] **Step 3: Implement the Compose and Dockerfile changes**

Pin PostgreSQL to `postgres:16.4-bookworm`, add its health check and restricted
capabilities, create the named volume, copy/build `@rc/database` in the web and
migration images, and preserve web resource/security limits.

- [ ] **Step 4: Verify GREEN locally**

Run:

```bash
$env:RC_IMAGE_TAG = "plan-test"
$env:POSTGRES_PASSWORD = "local-compose-validation-only"
$env:DATABASE_URL = "postgresql://rc:local-compose-validation-only@postgres:5432/rcmania"
$env:AUTH_SECRET = "local-compose-validation-auth-secret-32-bytes"
$env:AUTH_URL = "https://rcmania.live"
$env:GOOGLE_OAUTH_CLIENT_ID = "compose-validation.apps.googleusercontent.com"
$env:GOOGLE_OAUTH_CLIENT_SECRET = "compose-validation-only"
docker compose -f infra/compose/compose.vps-web.yaml config
pnpm --filter @rc/web build
```

Expected: valid Compose and successful standalone build.

- [ ] **Step 5: Commit**

```bash
git add infra/compose docs/deployment-vps.md
git commit -m "Add authenticated VPS runtime stack"
```

### Task 6: Full verification, publish, and VPS rollout

**Files:**
- No committed secret files.
- VPS-only: `/opt/rcmania/shared/auth.env` mode `0600`.

**Interfaces:**
- Consumes: the ignored Google credential JSON.
- Produces: a healthy HTTPS deployment with persistent Google sessions and
  `$0.00` account display.

- [ ] **Step 1: Run complete local verification**

Run:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm --filter @rc/web build
git diff --check
```

Expected: all commands pass and the credential JSON remains ignored.

- [ ] **Step 2: Commit any verification-only corrections**

Use an English commit message describing the correction; do not amend unrelated
user work.

- [ ] **Step 3: Push `main`**

Run: `git push origin main`

Expected: remote `main` contains every authentication commit.

- [ ] **Step 4: Install secrets on the VPS**

Extract the client ID/secret without logging them, generate independent random
database and Auth.js secrets, install `/opt/rcmania/shared/auth.env` as root mode
`0600`, and verify key presence by name only.

- [ ] **Step 5: Replace the old web deployment**

Check disk space, stop/remove the old web container and image, fetch the pushed
commit, build migration/web images, start PostgreSQL, run migrations, and start
the web container. Never remove the PostgreSQL named volume during replacement.

- [ ] **Step 6: Verify the deployed stack**

Check Compose health, HTTPS 200, HTTP/www redirects, auth sign-in redirect to
Google, callback route availability, database persistence across a web restart,
logout, logs without secrets, and remaining disk space.

- [ ] **Step 7: Manual user acceptance**

The configured Google test user signs in at `https://rcmania.live`, confirms the
account menu and `$0.00`, refreshes the page, signs out, and reports the result.
