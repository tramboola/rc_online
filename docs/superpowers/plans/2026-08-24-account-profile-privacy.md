# Account, Profile, and Privacy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add verified email/password accounts, private preset-avatar profiles, account deletion, transactional email, public legal documents, and Instagram navigation without breaking existing Google accounts or database sessions.

**Architecture:** Keep Auth.js for Google OAuth and for reading the existing opaque PostgreSQL sessions. Password sign-in is a focused same-origin route that verifies an Argon2id credential, creates the same hashed database-session record, and writes the same host-only cookie configured for Auth.js. Focused stores and services own profile data, one-time tokens, rate limits, Resend delivery, and deletion; route handlers contain only request parsing and response/cookie mapping.

**Tech Stack:** Next.js 16, React 19, Auth.js 5 beta, TypeScript 5.9, Drizzle ORM/PostgreSQL, Zod 4, `@node-rs/argon2`, Vitest 4, Resend HTTP API.

**Spec:** `docs/superpowers/specs/2026-08-24-account-profile-privacy-design.md`

## Global Constraints

- Preserve all existing Google users, roles, balances, rides, active sessions, admin access, and vehicle integration.
- Continue using seven-day revocable PostgreSQL sessions; do not introduce JWT sessions or Auth.js Credentials provider.
- Passwords are 12–128 Unicode characters and use Argon2id with at least 19 MiB memory, two iterations, and parallelism one.
- Email-verification tokens expire after 24 hours; password-reset tokens expire after 30 minutes; both are hashed, single-purpose, and single-use.
- Registration does not require nickname/avatar onboarding, an age gate, or a mandatory checkbox.
- Store only allowlisted bundled WebP avatar keys; never accept uploads, SVG, arbitrary URLs, or Google profile photos as public avatars.
- No public user directory or arbitrary-user profile endpoint; account routes derive the user from the server session.
- No analytics, advertising pixels, marketing email, or behavioral tracking; Resend sends transactional account email only.
- Do not read, print, commit, copy into an image layer, or expose the Resend API key to client code.
- Legal operator copy must use Aspect Estates s.r.o., IČO 28355920, DIČ CZ28355920, Gorazdova 355/5, Nové Město, 120 00 Praha 2, Czech Republic, C 215134/MSPH, and support@rcmania.live.
- All commits use English messages. Do not stage the user's unrelated untracked plan files or `loading_page_imgs/`.

## File Structure

- `packages/database/migrations/0007_account_profiles.sql`: additive profile, credential, action-token, and rate-limit migration plus identity backfill.
- `packages/database/src/schema.ts`: Drizzle declarations matching migration 0007.
- `apps/web/auth/account-store.ts`: account/profile persistence interface and shared result types.
- `apps/web/auth/postgres-account-store.ts`: PostgreSQL implementation and atomic account workflows.
- `apps/web/auth/password.ts`: password policy, Argon2id hashing, verification, and rehash decision.
- `apps/web/auth/account-token.ts`: random token creation and SHA-256 token hashing.
- `apps/web/auth/rate-limit.ts`: HMAC-keyed persistent rate-limit decisions.
- `apps/web/auth/session-cookie.ts`: one explicit Auth.js-compatible host-only cookie definition shared by OAuth and password sign-in.
- `apps/web/auth/transactional-email.ts`: delivery interface, templates, and Resend implementation.
- `apps/web/auth/account-service.ts`: registration, verification, sign-in, reset, profile, and deletion orchestration.
- `apps/web/app/api/account/**/route.ts`: thin same-origin account APIs.
- `apps/web/app/auth/**/page.tsx`: verification and password-reset result screens.
- `apps/web/app/account-dialog.tsx`: signed-out sign-in/create-account dialog.
- `apps/web/app/profile-dialog.tsx`: private nickname/avatar editor and deletion entry.
- `apps/web/app/legal-content.ts`: versioned English legal copy and company constants.
- `apps/web/app/legal-footer.tsx`: Privacy, Terms, and Instagram navigation.
- `apps/web/public/assets/avatars/*.webp`: immutable preset avatar artwork.

---

### Task 1: Add account profile persistence

**Files:**
- Create: `packages/database/migrations/0007_account_profiles.sql`
- Modify: `packages/database/src/schema.ts`
- Modify: `packages/database/src/migrations.test.ts`

**Interfaces:**
- Consumes: existing `users`, `oauth_identities`, `auth_sessions`, `account_balances`, `nicknames`, and `consents` tables.
- Produces: `passwordCredentials`, `accountActionTokens`, `authRateLimits`, and required `nicknames.avatarKey` Drizzle exports.

- [ ] **Step 1: Write failing migration assertions**

Add assertions that migration 0007 contains these exact durable boundaries:

```ts
expect(sql).toContain('ADD COLUMN "avatar_key" text');
expect(sql).toContain('CREATE TABLE "password_credentials"');
expect(sql).toContain('CREATE TABLE "account_action_tokens"');
expect(sql).toContain('CREATE TABLE "auth_rate_limits"');
expect(sql).toContain('ON DELETE CASCADE');
expect(sql).toContain('CREATE UNIQUE INDEX "account_action_tokens_token_hash_unique"');
```

- [ ] **Step 2: Run the focused database test and confirm red**

Run: `pnpm --filter @rc/database test -- migrations.test.ts`

Expected: FAIL because migration `0007_account_profiles.sql` does not exist.

- [ ] **Step 3: Add the additive SQL migration**

Create the four persistence changes:

```sql
ALTER TABLE "nicknames" ADD COLUMN "avatar_key" text;
UPDATE "nicknames" SET "avatar_key" = 'racer-red' WHERE "avatar_key" IS NULL;
ALTER TABLE "nicknames" ALTER COLUMN "avatar_key" SET NOT NULL;
ALTER TABLE "nicknames" ALTER COLUMN "avatar_key" SET DEFAULT 'racer-red';

CREATE TABLE "password_credentials" (
  "user_id" uuid PRIMARY KEY REFERENCES "users"("id") ON DELETE CASCADE,
  "password_hash" text NOT NULL,
  "password_changed_at" timestamptz NOT NULL DEFAULT now(),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "account_action_tokens" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "kind" text NOT NULL CHECK ("kind" IN ('verify_email', 'reset_password')),
  "token_hash" text NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "consumed_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX "account_action_tokens_token_hash_unique"
  ON "account_action_tokens" ("token_hash");
CREATE INDEX "account_action_tokens_user_kind_idx"
  ON "account_action_tokens" ("user_id", "kind", "expires_at");

CREATE TABLE "auth_rate_limits" (
  "key_hash" text NOT NULL,
  "kind" text NOT NULL,
  "window_started_at" timestamptz NOT NULL,
  "attempt_count" integer NOT NULL CHECK ("attempt_count" > 0),
  "expires_at" timestamptz NOT NULL,
  PRIMARY KEY ("key_hash", "kind", "window_started_at")
);
CREATE INDEX "auth_rate_limits_expiry_idx" ON "auth_rate_limits" ("expires_at");
```

Backfill every active user missing a nickname with a collision-resistant non-identifying value derived from the UUID, and a zero balance where absent:

```sql
INSERT INTO "nicknames" ("user_id", "nickname", "avatar_key")
SELECT u."id", 'Driver-' || upper(substr(replace(u."id"::text, '-', ''), 1, 8)), 'racer-red'
FROM "users" u
LEFT JOIN "nicknames" n ON n."user_id" = u."id"
WHERE n."user_id" IS NULL AND u."disabled_at" IS NULL;
```

- [ ] **Step 4: Declare matching Drizzle tables and relations**

Use the column names and constraints above; export token kind and rate-limit kind TypeScript unions from schema-adjacent code rather than accepting arbitrary strings in services.

- [ ] **Step 5: Run database tests and type checks**

Run: `pnpm --filter @rc/database test && pnpm --filter @rc/database typecheck`

Expected: PASS.

- [ ] **Step 6: Commit the persistence slice**

```bash
git add packages/database/migrations/0007_account_profiles.sql packages/database/src/schema.ts packages/database/src/migrations.test.ts
git commit -m "Add account profile persistence"
```

### Task 2: Implement password, token, and rate-limit primitives

**Files:**
- Modify: `apps/web/package.json`
- Modify: `pnpm-lock.yaml`
- Create: `apps/web/auth/password.ts`
- Create: `apps/web/auth/password.test.ts`
- Create: `apps/web/auth/account-token.ts`
- Create: `apps/web/auth/account-token.test.ts`
- Create: `apps/web/auth/rate-limit.ts`
- Create: `apps/web/auth/rate-limit.test.ts`

**Interfaces:**
- Produces: `hashPassword(password: string): Promise<string>`, `verifyPassword(hash: string, password: string): Promise<{ valid: boolean; needsRehash: boolean }>`, `createAccountToken(): { raw: string; hash: string }`, `hashRateLimitKey(secret: string, value: string): string`, and `RateLimitPolicy`.

- [ ] **Step 1: Add failing password tests**

```ts
it("accepts a 12-character Unicode passphrase and rejects a wrong password", async () => {
  const hash = await hashPassword("correct horse 🏁");
  expect(await verifyPassword(hash, "correct horse 🏁")).toMatchObject({ valid: true });
  expect(await verifyPassword(hash, "wrong password")).toEqual({ valid: false, needsRehash: false });
});

it.each(["short", "x".repeat(129)])("rejects an out-of-policy password", async (password) => {
  await expect(hashPassword(password)).rejects.toThrow("Password must contain 12 to 128 characters");
});
```

- [ ] **Step 2: Run the test and confirm missing-module failure**

Run: `pnpm --filter @rc/web test -- auth/password.test.ts`

Expected: FAIL because `password.ts` does not exist.

- [ ] **Step 3: Add `@node-rs/argon2` and minimal Argon2id implementation**

Use `memoryCost: 19456`, `timeCost: 2`, `parallelism: 1`, `outputLen: 32`, and `algorithm: Algorithm.Argon2id`. Catch malformed stored hashes and return `{ valid: false, needsRehash: false }` without leaking exceptions to the route.

- [ ] **Step 4: Add token tests and implementation**

Assert that two generated URL-safe raw tokens differ, contain at least 32 random bytes, and that only a 64-character SHA-256 hex digest is persisted:

```ts
const first = createAccountToken();
const second = createAccountToken();
expect(first.raw).not.toBe(second.raw);
expect(first.hash).toMatch(/^[a-f0-9]{64}$/);
expect(hashAccountToken(first.raw)).toBe(first.hash);
```

- [ ] **Step 5: Add HMAC rate-limit-key tests and implementation**

Use `createHmac("sha256", secret)` over a normalized `kind:value` input. Tests must prove the same input is stable, different secrets differ, and raw email/IP fragments never appear in the digest.

- [ ] **Step 6: Run focused tests and type check**

Run: `pnpm --filter @rc/web test -- auth/password.test.ts auth/account-token.test.ts auth/rate-limit.test.ts && pnpm --filter @rc/web typecheck`

Expected: PASS.

- [ ] **Step 7: Commit the security primitives**

```bash
git add apps/web/package.json pnpm-lock.yaml apps/web/auth/password.ts apps/web/auth/password.test.ts apps/web/auth/account-token.ts apps/web/auth/account-token.test.ts apps/web/auth/rate-limit.ts apps/web/auth/rate-limit.test.ts
git commit -m "Add secure password and account token primitives"
```

### Task 3: Add the account store and generated public identity

**Files:**
- Create: `apps/web/auth/account-store.ts`
- Create: `apps/web/auth/postgres-account-store.ts`
- Create: `apps/web/auth/postgres-account-store.test.ts`
- Modify: `apps/web/auth/session-user.ts`
- Modify: `apps/web/auth/session-user.test.ts`
- Modify: `apps/web/types/next-auth.d.ts`

**Interfaces:**
- Consumes: schema from Task 1 and hashes from Task 2.
- Produces: `AccountStore` methods `registerPendingAccount`, `consumeActionToken`, `findPasswordSignIn`, `replacePasswordAndRevokeSessions`, `getOwnProfile`, `updateOwnProfile`, `deleteOwnAccount`, `takeRateLimitAttempt`, and `cleanupExpiredAccountData`.
- Produces: session fields `nickname: string` and `avatarKey: AvatarKey`.

- [ ] **Step 1: Define the explicit private DTO and failing store contract tests**

```ts
export type OwnProfile = {
  email: string;
  nickname: string;
  avatarKey: AvatarKey;
};

expect(Object.keys(profile).sort()).toEqual(["avatarKey", "email", "nickname"]);
expect(profile).not.toHaveProperty("role");
expect(profile).not.toHaveProperty("balance");
expect(profile).not.toHaveProperty("passwordHash");
```

Use a database test transaction to assert that registration creates exactly one user, credential, nickname, avatar, zero balance, legal-version consent event, and verification token atomically.

- [ ] **Step 2: Run the focused tests and confirm red**

Run: `pnpm --filter @rc/web test -- auth/postgres-account-store.test.ts auth/session-user.test.ts`

Expected: FAIL for missing account store/session identity fields.

- [ ] **Step 3: Implement the store with transaction boundaries**

Normalize emails with `trim().toLowerCase()` and nicknames with `normalize("NFKC").trim()`. Generate `Driver-XXXXXXXX` from eight uppercase hex characters of a random UUID and retry on unique collision. Never select another user's profile by a client-supplied ID.

The deletion transaction must delete sessions, credentials, action tokens, OAuth identities, nickname, and non-required consent rows; then set `disabled_at`, replace email with `deleted+<uuid>@invalid.rcmania`, and replace display name with `Deleted driver`.

- [ ] **Step 4: Extend session identity without exposing private data publicly**

Load `nickname` and `avatarKey` alongside existing role/balance for the signed-in user's own session. Keep email available only inside the authenticated session and own-profile response.

- [ ] **Step 5: Run store and session tests**

Run: `pnpm --filter @rc/web test -- auth/postgres-account-store.test.ts auth/session-user.test.ts && pnpm --filter @rc/web typecheck`

Expected: PASS.

- [ ] **Step 6: Commit the account persistence layer**

```bash
git add apps/web/auth/account-store.ts apps/web/auth/postgres-account-store.ts apps/web/auth/postgres-account-store.test.ts apps/web/auth/session-user.ts apps/web/auth/session-user.test.ts apps/web/types/next-auth.d.ts
git commit -m "Add private account profile store"
```

### Task 4: Configure the shared session cookie and transactional email

**Files:**
- Create: `apps/web/auth/session-cookie.ts`
- Create: `apps/web/auth/session-cookie.test.ts`
- Modify: `apps/web/auth.ts`
- Modify: `apps/web/auth/config.ts`
- Modify: `apps/web/auth/config.test.ts`
- Create: `apps/web/auth/transactional-email.ts`
- Create: `apps/web/auth/transactional-email.test.ts`

**Interfaces:**
- Produces: `sessionCookieName`, `sessionCookieOptions`, `createSessionCookie(token: string, expires: Date)`, `TransactionalEmail`, and `createResendTransactionalEmail(config, fetcher)`.

- [ ] **Step 1: Write failing cookie/config tests**

Assert production configuration uses `__Secure-authjs.session-token`, `httpOnly: true`, `secure: true`, `sameSite: "lax"`, `path: "/"`, and a seven-day expiry. Assert `RESEND_API_KEY`, `AUTH_EMAIL_FROM`, and `AUTH_RATE_LIMIT_SECRET` are server-only required values outside tests.

- [ ] **Step 2: Run tests and confirm red**

Run: `pnpm --filter @rc/web test -- auth/session-cookie.test.ts auth/config.test.ts`

Expected: FAIL because the shared cookie and new environment fields are absent.

- [ ] **Step 3: Implement and wire the shared cookie**

Pass the explicit cookie definition into NextAuth:

```ts
cookies: {
  sessionToken: {
    name: sessionCookieName,
    options: sessionCookieOptions,
  },
},
```

Do not change the database-session strategy or Google provider behavior.

- [ ] **Step 4: Write failing Resend request tests**

Inject a fake `fetch` and assert `POST https://api.resend.com/emails`, bearer authorization, the configured sender, support reply-to, canonical HTTPS links, text+HTML bodies, and absence of passwords/balances.

- [ ] **Step 5: Implement four transactional templates**

Expose `sendVerification`, `sendPasswordReset`, `sendPasswordChanged`, and `sendAccountDeleted`. Use revisioned subjects and links built only from the configured canonical origin. Throw a redacted `TransactionalEmailError` containing HTTP status but never the response body or API key.

- [ ] **Step 6: Run focused tests and type check**

Run: `pnpm --filter @rc/web test -- auth/session-cookie.test.ts auth/config.test.ts auth/transactional-email.test.ts && pnpm --filter @rc/web typecheck`

Expected: PASS.

- [ ] **Step 7: Commit shared session and email infrastructure**

```bash
git add apps/web/auth/session-cookie.ts apps/web/auth/session-cookie.test.ts apps/web/auth.ts apps/web/auth/config.ts apps/web/auth/config.test.ts apps/web/auth/transactional-email.ts apps/web/auth/transactional-email.test.ts
git commit -m "Add shared sessions and transactional email"
```

### Task 5: Implement registration, verification, and password sign-in

**Files:**
- Create: `apps/web/auth/account-service.ts`
- Create: `apps/web/auth/account-service.test.ts`
- Create: `apps/web/app/api/account/register/route.ts`
- Create: `apps/web/app/api/account/register/route.test.ts`
- Create: `apps/web/app/api/account/verify-email/route.ts`
- Create: `apps/web/app/api/account/verify-email/route.test.ts`
- Create: `apps/web/app/api/account/resend-verification/route.ts`
- Create: `apps/web/app/api/account/sign-in/password/route.ts`
- Create: `apps/web/app/api/account/sign-in/password/route.test.ts`
- Create: `apps/web/app/auth/verify/page.tsx`

**Interfaces:**
- Consumes: `AccountStore`, password/token/rate-limit primitives, `TransactionalEmail`, and shared session cookie.
- Produces: generic JSON responses `{ ok: true; message: string }` and verified password sign-in that Auth.js `auth()` can read.

- [ ] **Step 1: Write failing service tests for generic behavior**

Test successful registration, duplicate password account, existing verified Google account linking, disabled account, email-send rollback/retry state, expired verification, replayed token, wrong token purpose, and rate-limit denial. Duplicate and unknown-account responses must have identical status and body.

- [ ] **Step 2: Run service tests and confirm red**

Run: `pnpm --filter @rc/web test -- auth/account-service.test.ts`

Expected: FAIL because `account-service.ts` does not exist.

- [ ] **Step 3: Implement service orchestration**

Use these policies:

```ts
export const accountPolicies = {
  verificationTtlMs: 24 * 60 * 60 * 1000,
  passwordResetTtlMs: 30 * 60 * 1000,
  sessionTtlMs: 7 * 24 * 60 * 60 * 1000,
  registration: { limit: 5, windowMs: 60 * 60 * 1000 },
  signIn: { limit: 10, windowMs: 15 * 60 * 1000 },
  resend: { limit: 3, windowMs: 60 * 60 * 1000 },
} as const;
```

Always perform a dummy Argon2 verification when the email has no eligible credential so response timing does not trivially enumerate accounts.

- [ ] **Step 4: Write failing route tests**

Assert Zod rejects malformed bodies, origin validation rejects cross-site state changes, IP extraction is converted immediately to an HMAC digest, cookies are host-only/httpOnly/secure, and no route accepts `userId`.

- [ ] **Step 5: Implement thin route handlers**

For successful password sign-in, generate a 32-byte URL-safe session token, store only `hashSessionToken(raw)`, expire it after seven days, and set the shared Auth.js cookie to the raw token. Return the same generic 401 for wrong email, password, unverified email, or disabled account.

- [ ] **Step 6: Prove interoperability with Auth.js**

Add an integration assertion that the session record created by the password route is resolved by `auth()`/the adapter using the shared cookie, including existing `role`, `balance`, `nickname`, and `avatarKey`.

- [ ] **Step 7: Run focused and existing auth tests**

Run: `pnpm --filter @rc/web test -- auth/account-service.test.ts app/api/account/register/route.test.ts app/api/account/verify-email/route.test.ts app/api/account/sign-in/password/route.test.ts auth/adapter.test.ts auth/session-user.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit verified password authentication**

```bash
git add apps/web/auth/account-service.ts apps/web/auth/account-service.test.ts apps/web/app/api/account/register apps/web/app/api/account/verify-email apps/web/app/api/account/resend-verification apps/web/app/api/account/sign-in/password apps/web/app/auth/verify
git commit -m "Add verified email password authentication"
```

### Task 6: Implement password recovery and session revocation

**Files:**
- Create: `apps/web/app/api/account/forgot-password/route.ts`
- Create: `apps/web/app/api/account/forgot-password/route.test.ts`
- Create: `apps/web/app/api/account/reset-password/route.ts`
- Create: `apps/web/app/api/account/reset-password/route.test.ts`
- Create: `apps/web/app/auth/reset-password/page.tsx`
- Modify: `apps/web/auth/account-service.ts`
- Modify: `apps/web/auth/account-service.test.ts`

**Interfaces:**
- Produces: generic forgot-password response and single-use reset completion that revokes all user sessions.

- [ ] **Step 1: Add failing recovery tests**

Cover known/unknown email response equality, 30-minute expiry, token replay, verification token passed to reset, malformed stored hash, password-policy rejection, reset-token invalidation, and complete session revocation after success.

- [ ] **Step 2: Run the focused tests and confirm red**

Run: `pnpm --filter @rc/web test -- auth/account-service.test.ts app/api/account/forgot-password/route.test.ts app/api/account/reset-password/route.test.ts`

Expected: FAIL for missing recovery methods/routes.

- [ ] **Step 3: Implement recovery services and routes**

Forgot-password sends email only for a verified, enabled credential but always returns the same 202 body. Reset consumes the token and changes the hash in one transaction, invalidates every reset token, deletes every session, and then sends a password-changed notification.

- [ ] **Step 4: Add the reset page states**

Render `RESET PASSWORD`, `LINK EXPIRED`, and `PASSWORD UPDATED` states without echoing the token into visible text, logs, or analytics. On success, link back to the account dialog.

- [ ] **Step 5: Run recovery tests and type check**

Run: `pnpm --filter @rc/web test -- auth/account-service.test.ts app/api/account/forgot-password/route.test.ts app/api/account/reset-password/route.test.ts && pnpm --filter @rc/web typecheck`

Expected: PASS.

- [ ] **Step 6: Commit password recovery**

```bash
git add apps/web/auth/account-service.ts apps/web/auth/account-service.test.ts apps/web/app/api/account/forgot-password apps/web/app/api/account/reset-password apps/web/app/auth/reset-password
git commit -m "Add secure password recovery"
```

### Task 7: Add preset avatars and private profile APIs

**Files:**
- Create: `apps/web/public/assets/avatars/racer-red.webp`
- Create: `apps/web/public/assets/avatars/racer-cyan.webp`
- Create: `apps/web/public/assets/avatars/wheel-fire.webp`
- Create: `apps/web/public/assets/avatars/track-night.webp`
- Create: `apps/web/public/assets/avatars/buggy-red.webp`
- Create: `apps/web/public/assets/avatars/helmet-lime.webp`
- Create: `apps/web/auth/avatar.ts`
- Create: `apps/web/auth/avatar.test.ts`
- Create: `apps/web/app/api/account/profile/route.ts`
- Create: `apps/web/app/api/account/profile/route.test.ts`

**Interfaces:**
- Produces: `avatarKeys`, `AvatarKey`, `isAvatarKey`, authenticated `GET /api/account/profile`, and authenticated `PATCH /api/account/profile`.

- [ ] **Step 1: Write failing avatar and API privacy tests**

```ts
expect(isAvatarKey("racer-red")).toBe(true);
expect(isAvatarKey("https://attacker.example/avatar.svg")).toBe(false);
expect(await unauthenticatedGet()).toMatchObject({ status: 401 });
expect(await patch({ userId: anotherUser, nickname: "Taken", avatarKey: "racer-red" })).toMatchObject({ status: 400 });
```

Assert responses have only `email`, `nickname`, and `avatarKey`, and nickname conflicts do not disclose the owning account.

- [ ] **Step 2: Run focused tests and confirm red**

Run: `pnpm --filter @rc/web test -- auth/avatar.test.ts app/api/account/profile/route.test.ts`

Expected: FAIL because avatar allowlist and route are absent.

- [ ] **Step 3: Create six optimized WebP presets**

Generate/crop them to 256×256, strip metadata, use a consistent dark RC Mania palette, and keep each file under 40 KiB. Run `identify`/Sharp metadata assertions for format, dimensions, and size; do not introduce SVG or remote URLs.

- [ ] **Step 4: Implement nickname and avatar validation**

Nickname rules: NFKC, trimmed, 3–24 visible characters, no control characters, case-insensitive uniqueness, and reserved lower-case values `admin`, `administrator`, `moderator`, `support`, `rcmania`, `rc mania`, `system`, `deleted driver`.

- [ ] **Step 5: Implement self-only profile routes**

Derive `userId` exclusively from `auth()`. Reject unknown request fields with strict Zod schemas and require same-origin state-changing requests.

- [ ] **Step 6: Run focused tests and asset checks**

Run: `pnpm --filter @rc/web test -- auth/avatar.test.ts app/api/account/profile/route.test.ts app/web-assets.test.ts && pnpm --filter @rc/web typecheck`

Expected: PASS and every avatar is a small 256×256 WebP.

- [ ] **Step 7: Commit preset profiles**

```bash
git add apps/web/public/assets/avatars apps/web/auth/avatar.ts apps/web/auth/avatar.test.ts apps/web/app/api/account/profile
git commit -m "Add private preset avatar profiles"
```

### Task 8: Build the account and profile dialogs

**Files:**
- Create: `apps/web/app/account-dialog.tsx`
- Create: `apps/web/app/account-dialog.test.tsx`
- Create: `apps/web/app/profile-dialog.tsx`
- Create: `apps/web/app/profile-dialog.test.tsx`
- Modify: `apps/web/app/account-control.tsx`
- Modify: `apps/web/app/account-presentation.ts`
- Modify: `apps/web/app/account-presentation.test.ts`
- Modify: `apps/web/app/styles.css`

**Interfaces:**
- Consumes: Google `signIn`, password account routes, own-profile API, and session nickname/avatar.
- Produces: accessible `AccountDialog` and `ProfileDialog`; account menu order `EDIT PROFILE`, `MANAGE BALANCE & PLANS`, `SIGN OUT`.

- [ ] **Step 1: Write failing interaction tests**

Cover signed-out dialog opening, `SIGN IN`/`CREATE ACCOUNT` views, Google action, email form, forgot-password state, pending-verification state, legal links, focus trap, Escape close, field errors, and no mandatory checkbox. Cover profile loading, nickname editing, avatar selection, unique-name error, save, and menu order.

- [ ] **Step 2: Run component tests and confirm red**

Run: `pnpm --filter @rc/web test -- app/account-dialog.test.tsx app/profile-dialog.test.tsx app/account-presentation.test.ts`

Expected: FAIL because the new dialogs/menu entry do not exist.

- [ ] **Step 3: Implement the signed-out dialog**

Use `SIGN IN WITH GOOGLE`, `EMAIL`, `PASSWORD`, `CREATE ACCOUNT`, and `FORGOT PASSWORD?`. Below registration submit render: `By continuing, you agree to the Terms of Service and acknowledge the Privacy Policy.` with real `/terms` and `/privacy` links.

- [ ] **Step 4: Implement the profile dialog**

Display email read-only, nickname editable, six labeled avatar buttons, saving/error state, and `DELETE ACCOUNT` as a separate destructive action. Use only same-origin asset paths and API responses.

- [ ] **Step 5: Update account presentation**

Replace Google initials/photo presentation with selected preset avatar plus nickname. Preserve balance and role behavior. Signed-out secondary text becomes `ACCOUNT`, not `WITH GOOGLE`.

- [ ] **Step 6: Run interaction, render, responsive, and type tests**

Run: `pnpm --filter @rc/web test -- app/account-dialog.test.tsx app/profile-dialog.test.tsx app/account-presentation.test.ts app/simulation-screen.render.test.tsx && pnpm --filter @rc/web typecheck`

Expected: PASS.

- [ ] **Step 7: Commit account UI**

```bash
git add apps/web/app/account-dialog.tsx apps/web/app/account-dialog.test.tsx apps/web/app/profile-dialog.tsx apps/web/app/profile-dialog.test.tsx apps/web/app/account-control.tsx apps/web/app/account-presentation.ts apps/web/app/account-presentation.test.ts apps/web/app/styles.css
git commit -m "Add account and profile dialogs"
```

### Task 9: Implement account deletion

**Files:**
- Create: `apps/web/app/api/account/delete/route.ts`
- Create: `apps/web/app/api/account/delete/route.test.ts`
- Modify: `apps/web/auth/account-service.ts`
- Modify: `apps/web/auth/account-service.test.ts`
- Modify: `apps/web/app/profile-dialog.tsx`
- Modify: `apps/web/app/profile-dialog.test.tsx`

**Interfaces:**
- Produces: authenticated same-origin `DELETE /api/account/delete` requiring `{ confirmation: "DELETE" }`, complete session revocation, and a cleared browser cookie.

- [ ] **Step 1: Write failing deletion tests**

Cover unauthenticated denial, cross-user payload rejection, exact confirmation, active-session revocation, credential/token/OAuth/nickname removal, email/display anonymization, disabled account, retained ride records using only internal ID, and failed subsequent Google/password login.

- [ ] **Step 2: Run focused tests and confirm red**

Run: `pnpm --filter @rc/web test -- auth/account-service.test.ts app/api/account/delete/route.test.ts app/profile-dialog.test.tsx`

Expected: FAIL for missing delete route and modal flow.

- [ ] **Step 3: Implement transactional deletion**

Attempt the account-deleted email before removing the address, but never block deletion on email delivery. Record only a redacted delivery status, continue the deletion transaction, and clear the current cookie with the shared name, `maxAge: 0`, and the same secure options.

- [ ] **Step 4: Implement destructive confirmation UI**

Show the irreversible consequences, require typing `DELETE`, link Privacy/Terms, disable submit until exact confirmation, and redirect home signed-out after success.

- [ ] **Step 5: Run deletion and regression tests**

Run: `pnpm --filter @rc/web test -- auth/account-service.test.ts app/api/account/delete/route.test.ts app/profile-dialog.test.tsx auth/adapter.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit deletion**

```bash
git add apps/web/app/api/account/delete apps/web/auth/account-service.ts apps/web/auth/account-service.test.ts apps/web/app/profile-dialog.tsx apps/web/app/profile-dialog.test.tsx
git commit -m "Add self-service account deletion"
```

### Task 10: Add legal pages, footer, and Instagram

**Files:**
- Create: `apps/web/app/legal-content.ts`
- Create: `apps/web/app/legal-content.test.ts`
- Create: `apps/web/app/privacy/page.tsx`
- Create: `apps/web/app/terms/page.tsx`
- Create: `apps/web/app/legal-footer.tsx`
- Create: `apps/web/app/legal-footer.test.tsx`
- Modify: `apps/web/app/layout.tsx`
- Modify: `apps/web/app/simulation-screen.tsx`
- Modify: `apps/web/app/styles.css`

**Interfaces:**
- Produces: public `/privacy`, public `/terms`, version constants `LEGAL_REVISION = "2026-08-24"`, and non-driving-page footer links.

- [ ] **Step 1: Write failing content and render tests**

Assert both pages include effective date/revision, every exact operator field, support email, data categories, purposes/lawful bases, processors by role, transfers, retention, rights, deletion, necessary cookies, absence of advertising analytics, remote-vehicle risks, five-minute session terms, pricing/refund wording, consumer-law carve-out, Czech governing law, and under-13 wording.

- [ ] **Step 2: Run tests and confirm red**

Run: `pnpm --filter @rc/web test -- app/legal-content.test.ts app/legal-footer.test.tsx`

Expected: FAIL because legal modules/routes do not exist.

- [ ] **Step 3: Write the versioned English legal content**

Keep all company/contact constants in `legal-content.ts`. Describe Google, Resend, hosting, and future payment providers by processing role without claiming each receives all data. State that only necessary authentication cookies/browser storage are used and no advertising analytics or behavioral tracking is installed.

- [ ] **Step 4: Add pages and compact legal footer**

Footer order: `PRIVACY`, `TERMS`, Instagram icon. Instagram opens `https://www.instagram.com/rcmania.live/` with `target="_blank"`, `rel="noopener noreferrer"`, and accessible name `RC Mania on Instagram`. Do not add the footer over `/ride`.

- [ ] **Step 5: Run legal/UI tests and build**

Run: `pnpm --filter @rc/web test -- app/legal-content.test.ts app/legal-footer.test.tsx app/simulation-screen.render.test.tsx && pnpm --filter @rc/web build`

Expected: PASS and both routes build as public pages.

- [ ] **Step 6: Commit legal navigation**

```bash
git add apps/web/app/legal-content.ts apps/web/app/legal-content.test.ts apps/web/app/privacy apps/web/app/terms apps/web/app/legal-footer.tsx apps/web/app/legal-footer.test.tsx apps/web/app/layout.tsx apps/web/app/simulation-screen.tsx apps/web/app/styles.css
git commit -m "Add privacy terms and Instagram navigation"
```

### Task 11: Complete account security and release verification

**Files:**
- Create: `apps/web/auth/account-security.test.ts`
- Modify: `apps/web/auth/vps-compose.test.ts`
- Modify: `infra/compose/compose.vps-web.yaml`
- Modify: `.env.example`
- Modify: `README.md`

**Interfaces:**
- Consumes: all prior account tasks.
- Produces: release evidence and documented server-only environment contract; no deployment is performed in this task.

- [ ] **Step 1: Add failing boundary tests**

Assert every account response omits `passwordHash`, token hashes, OAuth subject, arbitrary internal user IDs, another user's email/balance/role, `Set-Cookie` on generic failures, and token-bearing URLs in logs. Assert no source references `NEXT_PUBLIC_RESEND`, analytics scripts, advertising pixels, or remote avatar URLs.

- [ ] **Step 2: Run security tests and confirm any missing boundary fails**

Run: `pnpm --filter @rc/web test -- auth/account-security.test.ts auth/vps-compose.test.ts`

Expected: FAIL until compose/env documentation and response allowlists are complete.

- [ ] **Step 3: Document protected runtime variables**

Add names only, never values:

```dotenv
RESEND_API_KEY=
AUTH_EMAIL_FROM=RC Mania <accounts@updates.rcmania.live>
AUTH_SUPPORT_EMAIL=support@rcmania.live
AUTH_RATE_LIMIT_SECRET=
```

Pass them into the web container through runtime environment interpolation. Document that the production secret file is mode 600 and excluded from Git/Docker context.

- [ ] **Step 4: Add cleanup invocation**

Run expired-token/rate-limit and seven-day unverified-account cleanup from one bounded server-side maintenance path; verify it never deletes Google-linked or verified accounts and does not run in the browser.

- [ ] **Step 5: Run the complete account and repository checks**

Run: `pnpm --filter @rc/database test && pnpm --filter @rc/web test && pnpm --filter @rc/web typecheck && pnpm --filter @rc/web build && pnpm check`

Expected: all commands PASS. Record any unrelated pre-existing failure separately rather than weakening a check.

- [ ] **Step 6: Inspect the production bundle and Git diff**

Run: `rg -n "RESEND_API_KEY|AUTH_RATE_LIMIT_SECRET|password_hash|token_hash" apps/web/.next/static apps/web/.next/server/app 2>$null` and verify no secret values exist in client artifacts. Run `git status --short` and confirm only intended feature files plus the user's known untracked files are present.

- [ ] **Step 7: Commit release configuration**

```bash
git add apps/web/auth/account-security.test.ts apps/web/auth/vps-compose.test.ts infra/compose/compose.vps-web.yaml .env.example README.md
git commit -m "Harden account release configuration"
```

- [ ] **Step 8: Stop before publication**

Present the commit list, fresh test/build results, database migration, required secret names, rollback revision `9e0f02f`, and production verification checklist. Obtain explicit user approval before pushing or updating the public VPS.
