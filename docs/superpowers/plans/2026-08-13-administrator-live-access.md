# Administrator Live Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give database-backed administrators access to the real preflight and driving flow while regular users continue to see the public preview.

**Architecture:** Reuse `users.role`, normalize it at the auth-store boundary, and include it in the server-issued Auth.js session. Server pages enforce mock-mode route access and load operational car/queue data from PostgreSQL before serializing a small status object to the existing client screen component.

**Tech Stack:** Next.js 16 App Router, React 19, Auth.js 5, Drizzle ORM, PostgreSQL 16, Vitest, TypeScript, Docker Compose.

## Global Constraints

- Reuse `users.role`; do not add an `is_admin` column.
- Supported roles are `user` and `admin`; unknown values fail closed as `user`.
- In `MOCK_MODE=true`, regular users retain `COMING SOON` and cannot open restricted driving routes directly.
- Administrators use `START DRIVING` and enter through `/preflight`.
- Administrator car and queue data comes from PostgreSQL with no fictional fallback.
- An empty production car list is valid and renders `0 CARS AVAILABLE`.
- The public preview video remains labeled as a preview for administrators.
- Commit messages are English.
- Preserve unrelated local commits and `docs/superpowers/plans/2026-08-13-product-direction-aware-brake-nitro-sync.md`.

---

### Task 1: Role-aware authentication session

**Files:**
- Create: `apps/web/auth/user-role.ts`
- Create: `apps/web/auth/user-role.test.ts`
- Create: `apps/web/auth/session-user.ts`
- Create: `apps/web/auth/session-user.test.ts`
- Modify: `apps/web/auth/auth-store.ts`
- Modify: `apps/web/auth/postgres-auth-store.ts`
- Modify: `apps/web/auth/adapter.ts`
- Modify: `apps/web/auth/adapter.test.ts`
- Modify: `apps/web/auth.ts`
- Modify: `apps/web/types/next-auth.d.ts`

**Interfaces:**
- Produces: `type UserRole = "user" | "admin"`.
- Produces: `normalizeUserRole(value: string | null | undefined): UserRole`.
- Produces: `loadSessionUser(store: Pick<AuthStore, "getUser" | "getBalance">, userId: string): Promise<{ id: string; role: UserRole; balance: AccountBalance }>`.
- Extends: `StoredAuthUser` with `role: UserRole`.
- Extends: `Session["user"]` with `role: UserRole`.

- [ ] **Step 1: Write failing role and session tests**

```ts
expect(normalizeUserRole("admin")).toBe("admin");
expect(normalizeUserRole("operator")).toBe("user");

const data = await loadSessionUser(store, "user-1");
expect(data).toEqual({
  id: "user-1",
  role: "admin",
  balance: { currency: "USD", amountMinor: 0 },
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `pnpm.cmd --filter @rc/web exec vitest run auth/user-role.test.ts auth/session-user.test.ts`

Expected: FAIL because `user-role.ts` and `session-user.ts` do not exist.

- [ ] **Step 3: Implement role normalization and session loading**

```ts
export type UserRole = "user" | "admin";

export function normalizeUserRole(value: string | null | undefined): UserRole {
  return value === "admin" ? "admin" : "user";
}
```

`mapUser()` reads and normalizes `row.role`. New OAuth users are created with
`role: "user"`. The Auth.js session callback calls `loadSessionUser()` and
assigns `session.user.id`, `session.user.role`, and `session.user.balance`.

- [ ] **Step 4: Run targeted tests and typecheck**

Run: `pnpm.cmd --filter @rc/web exec vitest run auth/user-role.test.ts auth/session-user.test.ts auth/adapter.test.ts`

Run: `pnpm.cmd --filter @rc/web typecheck`

Expected: PASS.

- [ ] **Step 5: Commit the authentication unit**

```bash
git add apps/web/auth apps/web/types/next-auth.d.ts apps/web/auth.ts
git commit -m "Add administrator role to auth sessions"
```

### Task 2: Server-side mock route authorization

**Files:**
- Create: `apps/web/app/screen-access.ts`
- Create: `apps/web/app/screen-access.test.ts`
- Modify: `apps/web/app/[...screen]/page.tsx`

**Interfaces:**
- Consumes: `UserRole` from `apps/web/auth/user-role.ts`.
- Produces: `canAccessScreen(screen: ScreenName, mockMode: boolean, role: UserRole): boolean`.

- [ ] **Step 1: Write the failing authorization test**

```ts
expect(canAccessScreen("preflight", true, "user")).toBe(false);
expect(canAccessScreen("preflight", true, "admin")).toBe(true);
expect(canAccessScreen("pricing", true, "user")).toBe(true);
expect(canAccessScreen("ride", false, "user")).toBe(true);
```

- [ ] **Step 2: Run the test and verify RED**

Run: `pnpm.cmd --filter @rc/web exec vitest run app/screen-access.test.ts`

Expected: FAIL because `canAccessScreen` does not exist.

- [ ] **Step 3: Implement the fail-closed route policy**

```ts
const restrictedMockScreens = new Set<ScreenName>([
  "preflight", "queue", "ride", "results", "operator",
]);

export function canAccessScreen(
  screen: ScreenName,
  mockMode: boolean,
  role: UserRole,
): boolean {
  return !mockMode || !restrictedMockScreens.has(screen) || role === "admin";
}
```

`[...screen]/page.tsx` calls `auth()`, derives a safe role, and uses
`redirect("/")` before rendering a restricted screen.

- [ ] **Step 4: Run targeted tests and typecheck**

Run: `pnpm.cmd --filter @rc/web exec vitest run app/screen-access.test.ts`

Run: `pnpm.cmd --filter @rc/web typecheck`

Expected: PASS.

- [ ] **Step 5: Commit route authorization**

```bash
git add apps/web/app/screen-access.ts apps/web/app/screen-access.test.ts "apps/web/app/[...screen]/page.tsx"
git commit -m "Protect preview driving routes by role"
```

### Task 3: Production operational status loader

**Files:**
- Create: `apps/web/app/operational-status.ts`
- Create: `apps/web/app/operational-status.test.ts`
- Create: `apps/web/app/postgres-operational-status-store.ts`
- Modify: `apps/web/app/page.tsx`
- Modify: `apps/web/app/[...screen]/page.tsx`

**Interfaces:**
- Produces: `AvailableCar = { id: string; slug: string; name: string; batteryPercent: number | null }`.
- Produces: `OperationalStatus = { state: "ready"; cars: AvailableCar[]; queueCount: number } | { state: "unavailable"; cars: []; queueCount: null }`.
- Produces: `loadOperationalStatus(store: OperationalStatusStore, at?: Date): Promise<OperationalStatus>`.
- Produces: `getPostgresOperationalStatusStore(databaseUrl: string): OperationalStatusStore`.

- [ ] **Step 1: Write failing loader tests**

```ts
expect(await loadOperationalStatus(emptyStore, now)).toEqual({
  state: "ready",
  cars: [],
  queueCount: 0,
});

expect(await loadOperationalStatus(failingStore, now)).toEqual({
  state: "unavailable",
  cars: [],
  queueCount: null,
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `pnpm.cmd --filter @rc/web exec vitest run app/operational-status.test.ts`

Expected: FAIL because the loader does not exist.

- [ ] **Step 3: Implement the loader and PostgreSQL store**

The PostgreSQL store selects cars using:

```ts
and(eq(cars.state, "AVAILABLE"), eq(cars.adminBlocked, false))
```

It counts queue entries using active statuses and `gt(queueEntries.expiresAt, at)`.
`loadOperationalStatus()` runs independent car and queue reads with
`Promise.all()` and converts any query failure into the explicit unavailable
state.

- [ ] **Step 4: Load status only for preview administrators**

The server pages call `auth()` first. When `MOCK_MODE=true` and
`session.user.role === "admin"`, they load status from PostgreSQL and pass it
to `SimulationScreen`. Other users receive no operational payload.

- [ ] **Step 5: Run targeted tests and typecheck**

Run: `pnpm.cmd --filter @rc/web exec vitest run app/operational-status.test.ts`

Run: `pnpm.cmd --filter @rc/web typecheck`

Expected: PASS.

- [ ] **Step 6: Commit operational status loading**

```bash
git add apps/web/app/operational-status.ts apps/web/app/operational-status.test.ts apps/web/app/postgres-operational-status-store.ts apps/web/app/page.tsx "apps/web/app/[...screen]/page.tsx"
git commit -m "Load live car status for administrators"
```

### Task 4: Administrator home and queue presentation

**Files:**
- Modify: `apps/web/app/home-presentation.ts`
- Modify: `apps/web/app/home-presentation.test.ts`
- Modify: `apps/web/app/simulation-screen.tsx`
- Create: `apps/web/app/admin-live-access.test.ts`
- Modify: `apps/web/app/styles.css`

**Interfaces:**
- Consumes: `OperationalStatus` from `operational-status.ts`.
- Changes: `getHomePresentation(mockMode: boolean, adminAccess?: boolean)`.
- Changes: `SimulationScreen` accepts `adminAccess?: boolean` and `operationalStatus?: OperationalStatus`.

- [ ] **Step 1: Write failing presentation tests**

```ts
expect(getHomePresentation(true, true)).toMatchObject({
  ctaHref: "/preflight",
  ctaLabel: "START DRIVING",
  eyebrow: "PREVIEW / COMING SOON",
  showLiveBadge: false,
});
```

Render `SimulationScreen` with an administrator and a ready empty status, then
assert that the rendered result contains `START DRIVING`, links to
`/preflight`, contains `0` with `CARS AVAILABLE`, and does not contain a
selectable fictional car in the queue screen.

- [ ] **Step 2: Run the tests and verify RED**

Run: `pnpm.cmd --filter @rc/web exec vitest run app/home-presentation.test.ts app/admin-live-access.test.ts`

Expected: FAIL because administrator props and presentation do not exist.

- [ ] **Step 3: Implement administrator home behavior**

For `mockMode && adminAccess`, render the preview video and labels but use an
active `START DRIVING` link. Operational metrics use `cars.length` and
`queueCount`; unavailable values render an em dash.

- [ ] **Step 4: Implement real queue car selection**

When `operationalStatus` is supplied, render its cars instead of the static
simulation array. An empty list renders `NO CARS AVAILABLE` and disables
`ACCEPT & CONNECT`. Existing non-preview simulation behavior keeps its current
static fixtures.

- [ ] **Step 5: Run targeted tests, full web tests, and typecheck**

Run: `pnpm.cmd --filter @rc/web exec vitest run app/home-presentation.test.ts app/admin-live-access.test.ts`

Run: `pnpm.cmd --filter @rc/web test`

Run: `pnpm.cmd --filter @rc/web typecheck`

Expected: PASS with zero failures.

- [ ] **Step 6: Commit UI behavior**

```bash
git add apps/web/app/home-presentation.ts apps/web/app/home-presentation.test.ts apps/web/app/simulation-screen.tsx apps/web/app/admin-live-access.test.ts apps/web/app/styles.css
git commit -m "Enable live driving access for administrators"
```

### Task 5: Production assignment and deployment verification

**Files:**
- No schema migration; `users.role` already exists.
- Deploy existing: `infra/compose/compose.vps-web.yaml`.

**Interfaces:**
- Consumes: committed application version and production PostgreSQL.
- Produces: `greennmoto@gmail.com` with role `admin` and a healthy deployed web container.

- [ ] **Step 1: Run fresh pre-release verification**

Run: `pnpm.cmd --filter @rc/web test`

Run: `pnpm.cmd --filter @rc/web typecheck`

Run with local build-only auth values: `pnpm.cmd --filter @rc/web build`

Expected: tests, TypeScript, and Next.js production build all succeed.

- [ ] **Step 2: Inspect Git scope before publication**

Run: `git status -sb`, `git log --oneline origin/main..main`, and
`git diff --check origin/main..main`.

Do not publish the unrelated untracked product-direction plan. If local commits
outside this feature would also be pushed, report the exact list before the
publication step.

- [ ] **Step 3: Back up and assign the production role**

Create a compressed `pg_dump`, verify it with `gzip -t`, then run:

```sql
update users
set role = 'admin', updated_at = now()
where lower(email) = 'greennmoto@gmail.com';
```

Require `UPDATE 1`, then select the email and role back from PostgreSQL.

- [ ] **Step 4: Replace only RC Mania web and migrate images**

Pull the published commit on `/opt/rcmania/current`, validate Compose with the
private environment, remove only the exact old `rcmania-web-1` and
`rcmania-migrate-1` containers/images, build commit-tagged replacements, and
start `web`. Never delete the PostgreSQL container or volume.

- [ ] **Step 5: Smoke-test production**

Verify:

- `rcmania-web-1` and `rcmania-postgres-1` are healthy;
- `rcmania-migrate-1` exited with code `0`;
- signed-out HTML still contains `COMING SOON`;
- the Google OAuth providers endpoint remains valid;
- server logs contain no errors;
- disk free space remains adequate;
- a server-side read confirms `greennmoto@gmail.com | admin`;
- an authenticated browser session shows `START DRIVING`, `/preflight`, and
  the real zero-car state.
