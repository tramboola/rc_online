# Mock Preview Viewer Counter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace misleading live/demo copy with a coming-soon state in mock mode and display a real count of browser profiles active on the home page.

**Architecture:** The standalone Next.js process owns an in-memory `ViewerRegistry` with a 45-second TTL. A same-origin route accepts 15-second browser heartbeats, while a client hook maintains an opaque browser ID and feeds the returned count into a small mode-dependent home presentation model.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5.9, Vitest 4, Playwright 1.55.

## Global Constraints

- In mock mode, render `COMING SOON`, preview copy, and no hero `LIVE` badge.
- Never display a fabricated viewer number; use `AUDIENCE UNAVAILABLE` on failure.
- Count browser profiles active in the previous 45 seconds with a heartbeat every 15 seconds.
- Persist only an opaque browser identifier in `localStorage`; do not record IP addresses, user agents, or accounts.
- Keep the non-mock start-driving and live presentation unchanged.
- Do not add Redis, a database, Google OAuth, or another dependency.
- All commit messages must be in English.

---

### Task 1: Active viewer registry and route

**Files:**
- Create: `apps/web/app/viewer-id.ts`
- Create: `apps/web/app/viewer-registry.ts`
- Create: `apps/web/app/viewer-registry.test.ts`
- Create: `apps/web/app/api/viewers/route.ts`
- Create: `apps/web/app/api/viewers/route.test.ts`

**Interfaces:**
- Produces: `isValidViewerId`, `ViewerRegistry`, `viewerRegistry`, and `createViewerPost(registry)`.
- `ViewerRegistry.heartbeat(viewerId: string): number` refreshes a viewer and returns the active count.
- `ViewerRegistry.count(): number` prunes expired viewers and returns the active count.
- `createViewerPost(registry)` returns a Next route handler accepting `{ viewerId: string }`.

- [ ] **Step 1: Write failing registry tests**

```ts
import { describe, expect, test } from "vitest";
import { isValidViewerId } from "./viewer-id";
import { ViewerRegistry } from "./viewer-registry";

describe("ViewerRegistry", () => {
  test("deduplicates heartbeats from the same browser", () => {
    let now = 1_000;
    const registry = new ViewerRegistry(45_000, () => now);
    expect(registry.heartbeat("browser-a")).toBe(1);
    now += 15_000;
    expect(registry.heartbeat("browser-a")).toBe(1);
    expect(registry.heartbeat("browser-b")).toBe(2);
  });

  test("expires viewers after 45 seconds", () => {
    let now = 1_000;
    const registry = new ViewerRegistry(45_000, () => now);
    registry.heartbeat("browser-a");
    now += 45_001;
    expect(registry.count()).toBe(0);
  });

  test("accepts bounded opaque identifiers only", () => {
    expect(isValidViewerId("browser_123-abc")).toBe(true);
    expect(isValidViewerId("")).toBe(false);
    expect(isValidViewerId("x".repeat(129))).toBe(false);
  });
});
```

- [ ] **Step 2: Run registry tests and verify RED**

Run: `pnpm.cmd --filter @rc/web test -- app/viewer-registry.test.ts`

Expected: FAIL because `viewer-registry.ts` does not exist.

- [ ] **Step 3: Implement the minimal registry**

Create `isValidViewerId` with `/^[A-Za-z0-9_-]{1,128}$/`. Create a map-backed
registry with constructor defaults `ttlMs = 45_000`, `now = Date.now`, and
`maxEntries = 10_000`, pruning expired entries when read or updated and evicting
the oldest entry before admitting a new viewer at capacity. Store the production
singleton on `globalThis` so Next development reloads do not create counters.

- [ ] **Step 4: Run registry tests and verify GREEN**

Run: `pnpm.cmd --filter @rc/web test -- app/viewer-registry.test.ts`

Expected: PASS with 3 tests.

- [ ] **Step 5: Write failing route tests**

```ts
import { expect, test } from "vitest";
import { ViewerRegistry } from "../../viewer-registry";
import { createViewerPost } from "./route";

test("POST records a heartbeat and returns the count", async () => {
  const post = createViewerPost(new ViewerRegistry());
  const response = await post(new Request("http://localhost/api/viewers", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ viewerId: "browser-a" }),
  }));
  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({ count: 1 });
});

test("POST rejects invalid identifiers", async () => {
  const post = createViewerPost(new ViewerRegistry());
  const response = await post(new Request("http://localhost/api/viewers", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ viewerId: "" }),
  }));
  expect(response.status).toBe(400);
});
```

- [ ] **Step 6: Run route tests and verify RED**

Run: `pnpm.cmd --filter @rc/web test -- app/api/viewers/route.test.ts`

Expected: FAIL because the route module does not exist.

- [ ] **Step 7: Implement the route and verify GREEN**

Export `createViewerPost(registry)` plus production `POST`. Parse JSON inside a
`try` block, validate `viewerId`, return `{ count }` with status 200, and return
`{ error: "Invalid viewer ID" }` with status 400 for malformed JSON or IDs.

Run: `pnpm.cmd --filter @rc/web test -- app/viewer-registry.test.ts app/api/viewers/route.test.ts`

Expected: PASS with 5 tests.

- [ ] **Step 8: Commit the server counter**

```bash
git add apps/web/app/viewer-id.ts apps/web/app/viewer-registry.ts apps/web/app/viewer-registry.test.ts apps/web/app/api/viewers/route.ts apps/web/app/api/viewers/route.test.ts
git commit -m "Add active viewer counter API"
```

### Task 2: Browser heartbeat and honest mock presentation

**Files:**
- Create: `apps/web/app/home-presentation.ts`
- Create: `apps/web/app/home-presentation.test.ts`
- Create: `apps/web/app/viewer-client.ts`
- Create: `apps/web/app/viewer-client.test.ts`
- Create: `apps/web/app/use-viewer-count.ts`
- Modify: `apps/web/app/simulation-screen.tsx`
- Modify: `apps/web/app/styles.css`

**Interfaces:**
- Consumes: `POST /api/viewers` returning `{ count: number }`.
- Produces: `getHomePresentation(mockMode)`, `getOrCreateViewerId(storage, createId)`, `sendViewerHeartbeat(viewerId, fetcher)`, and `useViewerCount()`.
- `useViewerCount()` returns `{ count: number | null, unavailable: boolean }`.

- [ ] **Step 1: Write failing presentation tests**

Test that mock mode returns `COMING SOON`, `PREVIEW / COMING SOON`, no CTA URL,
and `showLiveBadge: false`. Test that non-mock mode returns `START DRIVING`,
`LIVE / DIRECT`, `/preflight`, and `showLiveBadge: true`.

- [ ] **Step 2: Run presentation tests and verify RED**

Run: `pnpm.cmd --filter @rc/web test -- app/home-presentation.test.ts`

Expected: FAIL because the presentation module does not exist.

- [ ] **Step 3: Implement and verify the presentation model**

Implement a pure `getHomePresentation(mockMode: boolean)` returning the exact
copy and flags from Step 1, then rerun the test and expect PASS.

- [ ] **Step 4: Write failing browser helper tests**

Test that `getOrCreateViewerId` reuses a stored valid ID, replaces an invalid
stored value with `createId()`, and that `sendViewerHeartbeat` returns a
non-negative integer count but rejects malformed responses.

- [ ] **Step 5: Run helper tests and verify RED**

Run: `pnpm.cmd --filter @rc/web test -- app/viewer-client.test.ts`

Expected: FAIL because the client helper module does not exist.

- [ ] **Step 6: Implement browser helpers and the client hook**

Use storage key `rcmania_viewer_id`. Generate the default ID from
`crypto.getRandomValues`, which also works before HTTPS is enabled.
`sendViewerHeartbeat` posts JSON to
`/api/viewers` with `cache: "no-store"`. `useViewerCount` sends immediately,
then every 15,000 ms, clears its interval on unmount, and exposes the failure
state without throwing into the page.

- [ ] **Step 7: Render the approved mock experience**

In `HomeScreen`, call `getHomePresentation(mockMode)` and `useViewerCount()`.
Render the red live badge only when `showLiveBadge` is true. Render the viewer
badge as `${count} WATCHING NOW` or `AUDIENCE UNAVAILABLE`. Render a disabled
`span.hero-link.hero-link-disabled` for mock mode and retain the `/preflight`
link outside mock mode. Add disabled styling without hover motion.

- [ ] **Step 8: Run focused tests and verify GREEN**

Run: `pnpm.cmd --filter @rc/web test -- app/home-presentation.test.ts app/viewer-client.test.ts`

Expected: PASS.

- [ ] **Step 9: Commit the mock presentation**

```bash
git add apps/web/app/home-presentation.ts apps/web/app/home-presentation.test.ts apps/web/app/viewer-client.ts apps/web/app/viewer-client.test.ts apps/web/app/use-viewer-count.ts apps/web/app/simulation-screen.tsx apps/web/app/styles.css
git commit -m "Show honest mock preview audience state"
```

### Task 3: Integration and release verification

**Files:**
- Create: `tests/e2e/specs/mock-preview.spec.ts`
- Modify: `docs/superpowers/plans/2026-08-03-mock-preview-viewer-counter.md`

**Interfaces:**
- Consumes: the mock home page and `/api/viewers` route from Tasks 1 and 2.
- Produces: regression coverage proving that the deployed mock experience is honest and connected to the real counter.

- [ ] **Step 1: Write the browser regression test**

With `MOCK_MODE=true`, assert that the home page contains `COMING SOON`, has no
`START DRIVING` link, has no `.live-badge`, and eventually shows text matching
`/^\d+ WATCHING NOW$/`. Send a second heartbeat with another valid ID and assert
the returned count is at least two.

- [ ] **Step 2: Build and run the browser test**

Run:

```powershell
$env:MOCK_MODE='true'
pnpm.cmd --filter @rc/web build
pnpm.cmd --filter @rc/e2e test:e2e -- --project=desktop-chromium specs/mock-preview.spec.ts
```

Expected: PASS.

- [ ] **Step 3: Run complete focused verification**

Run:

```powershell
pnpm.cmd --filter @rc/web test
pnpm.cmd --filter @rc/web typecheck
pnpm.cmd --filter @rc/web build
git diff --check
git status --short
```

Expected: all commands exit 0; Git status contains only the intended plan and
feature files before the final commit.

- [ ] **Step 4: Commit integration coverage and completed plan**

Mark all completed checkboxes in this plan, then commit with:

```bash
git add tests/e2e/specs/mock-preview.spec.ts docs/superpowers/plans/2026-08-03-mock-preview-viewer-counter.md
git commit -m "Verify mock preview audience behavior"
```

- [ ] **Step 5: Report deployment boundary**

Report the commits and verification results. Do not push or deploy the new
image until the user explicitly authorizes publishing the changed site.
