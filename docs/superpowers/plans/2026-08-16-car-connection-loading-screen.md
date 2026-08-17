# Car Connection Loading Screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a reference-faithful car connection screen that is part of the queue-to-ride flow and also runs indefinitely as a local demo.

**Architecture:** Add one focused client component for loading presentation and connection orchestration, then register it in the existing `SimulationScreen` route switch. The queue passes the selected car in the URL, while `demo=1` selects a deterministic no-network branch. Supplied raster assets become optimized WebP files in the existing public asset directory.

**Tech Stack:** Next.js 16, React 19, TypeScript, Vitest, Sharp, existing Oswald/Rajdhani fonts, existing Phosphor icon library.

## Global Constraints

- Use `loading_page_imgs/ref.PNG` as the visual source of truth.
- Exactly two adjacent green loading segments move left to right in a repeating cycle.
- `/loading?demo=1` must never call an API or redirect away from the loading page.
- The production flow is `/queue` -> `/loading?car=<car-id>` -> `/ride`.
- Do not add dependencies, backend endpoints, persistence, deployment, or duplicated static HTML.
- Ship only WebP loading assets from `apps/web/public/assets/`.
- Respect `prefers-reduced-motion` and keep the screen usable on narrow viewports.

---

### Task 1: Optimized Loading Assets

**Files:**
- Modify: `apps/web/app/web-assets.test.ts`
- Create: `apps/web/public/assets/loading-background.webp`
- Create: `apps/web/public/assets/loading-logo.webp`

**Interfaces:**
- Consumes: `loading_page_imgs/background.PNG`, `loading_page_imgs/logo.PNG`.
- Produces: public URLs `/assets/loading-background.webp` and `/assets/loading-logo.webp`.

- [ ] **Step 1: Write the failing asset test**

Add a table-driven assertion to `web-assets.test.ts`:

```ts
for (const fileName of ["loading-background.webp", "loading-logo.webp"]) {
  const contents = await readFile(path.join(publicDir, "assets", fileName));
  expect(contents.subarray(0, 4).toString("ascii")).toBe("RIFF");
  expect(contents.subarray(8, 12).toString("ascii")).toBe("WEBP");
}
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `pnpm --filter @rc/web test -- app/web-assets.test.ts`

Expected: FAIL because both loading WebP files are absent.

- [ ] **Step 3: Convert the supplied assets**

Use the workspace `sharp` dependency with quality `84`, alpha quality `92`, smart subsampling, and effort `6`. Preserve the source dimensions and transparency.

- [ ] **Step 4: Run the focused test and verify it passes**

Run: `pnpm --filter @rc/web test -- app/web-assets.test.ts`

Expected: PASS with valid WebP headers and no PNG/JPEG files in `public`.

### Task 2: Loading Presentation and State Machine

**Files:**
- Create: `apps/web/app/connection-loading-screen.tsx`
- Create: `apps/web/app/connection-loading-screen.test.tsx`
- Modify: `apps/web/app/styles.css`

**Interfaces:**
- Consumes: `adminAccess: boolean`, `mockMode: boolean`, `operationalStatus?: OperationalStatus`.
- Produces: `ConnectionLoadingScreen`, `getActiveLoadingSegments(step: number): [number, number]`, and `getConnectionUrl(carId: string): string`.

- [ ] **Step 1: Write failing deterministic helper and render tests**

```tsx
expect(getActiveLoadingSegments(0)).toEqual([0, 1]);
expect(getActiveLoadingSegments(6)).toEqual([6, 7]);
expect(getActiveLoadingSegments(7)).toEqual([0, 1]);
expect(getConnectionUrl("car id")).toBe("/loading?car=car%20id");

const markup = renderToStaticMarkup(
  <ConnectionLoadingScreen adminAccess={false} mockMode operationalStatus={undefined} />,
);
expect(markup).toContain("CONNECTING TO CAR");
expect(markup.match(/data-loading-segment=/g)).toHaveLength(8);
expect(markup.match(/is-active/g)).toHaveLength(2);
expect(markup).toContain("SYSTEM LOG");
```

Mock `useRouter` and `useSearchParams` so the render path is stable and selects `demo=1`.

- [ ] **Step 2: Run the component test and verify it fails**

Run: `pnpm --filter @rc/web test -- app/connection-loading-screen.test.tsx`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement deterministic state and connection behavior**

Use these public types and rules:

```ts
export function getActiveLoadingSegments(step: number): [number, number] {
  const start = ((step % 7) + 7) % 7;
  return [start, start + 1];
}

export function getConnectionUrl(carId: string): string {
  return `/loading?car=${encodeURIComponent(carId)}`;
}

type LoadingStatus = "connecting" | "connected" | "failed";
```

The component must:

- render eight segments with the initial active pair `[0, 1]`;
- advance the pair every `420ms` and reveal one mock log entry every `360ms`;
- run API/session connection work only when `demo !== "1"`;
- enforce a minimum visible duration of `3200ms` before success navigation;
- show `CONNECTED`, reveal all log entries, wait `700ms`, then call `router.replace("/ride")`;
- catch production errors, append an error log, and render retry plus return actions;
- cancel timers and ignore late promise completion after unmount;
- show the complete static log and stop interval-driven motion when reduced motion is requested.

- [ ] **Step 4: Add reference-faithful CSS**

Create `.connection-loading-page`, `.connection-loading-shell`, `.connection-logo`, `.connection-kicker`, `.loading-rail`, `.loading-segment`, `.system-log-panel`, `.system-log-header`, `.system-log-lines`, status modifiers, error actions, desktop scaling, `max-width: 760px` responsive rules, and a `prefers-reduced-motion` block. Use the supplied background image rather than a generated CSS background motif.

- [ ] **Step 5: Run the component test and verify it passes**

Run: `pnpm --filter @rc/web test -- app/connection-loading-screen.test.tsx`

Expected: PASS.

### Task 3: Queue and Route Integration

**Files:**
- Modify: `apps/web/app/simulation-screen.tsx`
- Modify: `apps/web/app/[...screen]/page.tsx`
- Modify: `apps/web/app/screen-access.ts`
- Modify: `apps/web/app/screen-access.test.ts`
- Modify: `apps/web/app/simulation-screen.render.test.tsx`

**Interfaces:**
- Consumes: `ConnectionLoadingScreen` and `getConnectionUrl` from Task 2.
- Produces: valid `loading` screen route and queue-to-loading navigation.

- [ ] **Step 1: Write failing access and rendering tests**

```ts
expect(canAccessScreen("loading", true, "admin")).toBe(true);
expect(canAccessScreen("loading", true, "user")).toBe(false);
```

Extend the navigation mock with `replace` and `useSearchParams`. Render `SimulationScreen` with `screen="loading"` and assert that `CONNECTING TO CAR`, eight loading segments, and the system log are present.

- [ ] **Step 2: Run integration tests and verify they fail**

Run: `pnpm --filter @rc/web test -- app/screen-access.test.ts app/simulation-screen.render.test.tsx`

Expected: FAIL because `loading` is not a `ScreenName` or routed screen.

- [ ] **Step 3: Register and wire the loading screen**

- Add `"loading"` to `ScreenName`, the dynamic route's `knownScreens`, and `restrictedMockScreens`.
- Load operational status for both `queue` and `loading` when mock admin access is active.
- Replace `QueueScreen.accept()` connection work with immediate `router.push(getConnectionUrl(selectedCar))`.
- Render `ConnectionLoadingScreen` in `SimulationScreen` before the ride branch.
- Leave ride, result, and unrelated queue presentation unchanged.

- [ ] **Step 4: Run integration tests and verify they pass**

Run: `pnpm --filter @rc/web test -- app/screen-access.test.ts app/simulation-screen.render.test.tsx`

Expected: PASS.

### Task 4: Full Verification and Visual QA

**Files:**
- Modify: `design-qa.md`

**Interfaces:**
- Consumes: completed loading route and `loading_page_imgs/ref.PNG`.
- Produces: verified local demo and a `design-qa.md` whose final result is `passed`.

- [ ] **Step 1: Run automated checks**

Run:

```text
pnpm --filter @rc/web typecheck
pnpm --filter @rc/web test
pnpm --filter @rc/web build
```

Expected: all commands exit successfully.

- [ ] **Step 2: Start the local preview**

Run the existing Next.js development script on an available local port and keep it running. Open `/loading?demo=1` in the in-app browser.

- [ ] **Step 3: Verify behavior and responsive layout**

Check a desktop viewport matching the `1672 x 941` reference ratio and one narrow mobile viewport. Confirm page identity, meaningful DOM, no framework overlay, no relevant console errors, exactly two active segments at multiple time samples, and no demo redirect.

- [ ] **Step 4: Compare against the reference and iterate**

Capture the rendered desktop screen, compare it beside `loading_page_imgs/ref.PNG`, and assess typography, spacing, colors, image fidelity, copy, responsiveness, and polish. Fix every P0/P1/P2 mismatch and repeat capture/comparison.

- [ ] **Step 5: Record the passing QA result**

Update root `design-qa.md` with source and implementation paths, viewport and pixel density, tested state, comparison history, interaction evidence, console check, remaining P3 notes, and exactly `final result: passed`.

