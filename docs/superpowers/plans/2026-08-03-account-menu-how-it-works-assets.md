# Account Menu, How It Works, and Web Assets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the authenticated header menu, add balance and plan management, publish a product-focused How It Works page, and convert the website's raster assets to WebP.

**Architecture:** Keep the current shared `SimulationScreen` routing and visual system. Add pure content modules for testable copy, protect the dropdown with a CSS regression test, and use a committed Sharp conversion script so asset optimization is repeatable. Avoid a new account page or billing backend; the management action routes to the existing pricing packs.

**Tech Stack:** Next.js 16, React 19, TypeScript, Auth.js, Vitest, Phosphor Icons, Sharp, CSS, pnpm.

## Global Constraints

- The account menu must not change header height, logo position, or page flow.
- `MANAGE BALANCE & PLANS` links to `/pricing#packs`; no separate account page is added.
- The How It Works page explains the customer journey without a safety section or infrastructure deep dive.
- The queue step explicitly says an empty queue means immediate car assignment without waiting.
- Only PNG/JPG/JPEG files under `apps/web/public` are converted; videos, SVG, fonts, documentation, and non-web assets are untouched.
- WebP conversion preserves source dimensions and alpha channels.
- Publication is not part of this plan until the user explicitly confirms it.

---

## File structure

- `apps/web/app/account-control.tsx`: signed-in dropdown actions and navigation.
- `apps/web/app/styles.css`: dropdown positioning plus How It Works responsive styles.
- `apps/web/app/account-menu-styles.test.ts`: CSS regression protection for the dropdown.
- `apps/web/app/how-it-works-content.ts`: static, testable step and requirement copy.
- `apps/web/app/how-it-works-content.test.ts`: product-copy regression tests.
- `apps/web/app/simulation-screen.tsx`: shared header route and How It Works screen composition.
- `apps/web/app/[...screen]/page.tsx`: allow-list for `/how-it-works`.
- `apps/web/scripts/convert-raster-assets.mjs`: repeatable WebP conversion utility.
- `apps/web/app/web-assets.test.ts`: prohibits legacy raster files and references.
- `apps/web/public/assets/*.webp`: converted web assets.
- `apps/web/package.json` and `pnpm-lock.yaml`: Sharp development dependency and conversion command.

---

### Task 1: Fix the account menu and add plan management

**Files:**
- Create: `apps/web/app/account-menu-styles.test.ts`
- Modify: `apps/web/app/account-control.tsx`
- Modify: `apps/web/app/styles.css`

**Interfaces:**
- Consumes: current Auth.js session presentation from `getAccountPresentation(session)`.
- Produces: a `MANAGE BALANCE & PLANS` link to `/pricing#packs` and a dropdown whose computed positioning cannot enter normal header flow.

- [ ] **Step 1: Write the failing CSS regression test**

```ts
import { readFile } from "node:fs/promises";
import { describe, expect, test } from "vitest";

const stylesUrl = new URL("./styles.css", import.meta.url);

describe("account menu layout", () => {
  test("keeps the data panel dropdown absolutely positioned", async () => {
    const css = await readFile(stylesUrl, "utf8");
    expect(css).toMatch(/\.account-shell \.account-menu\s*\{[^}]*position:\s*absolute;/su);
  });
});
```

- [ ] **Step 2: Run the regression test and verify RED**

Run: `pnpm.cmd --filter @rc/web test`

Expected: FAIL because the stylesheet only has `.account-menu { position: absolute; }`, which is later overridden by the equally specific `.data-panel { position: relative; }` rule.

- [ ] **Step 3: Add the management link and specific positioning rule**

In `account-control.tsx`, import `CreditCard` and `Link`, then place this action above Sign Out:

```tsx
<Link className="account-menu-action account-menu-primary" href="/pricing#packs" role="menuitem">
  <CreditCard aria-hidden="true" size={20} /> MANAGE BALANCE &amp; PLANS
</Link>
```

In `styles.css`, use a selector strong enough to beat the shared panel rule and shared action styling:

```css
.account-shell .account-menu {
  position: absolute;
  top: calc(100% + 12px);
  right: 0;
}
.account-menu-action {
  width: 100%;
  min-height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}
.account-menu-primary {
  margin-bottom: 10px;
  border-color: var(--cyan);
  color: var(--cyan);
}
```

- [ ] **Step 4: Run focused tests and type checking**

Run: `pnpm.cmd --filter @rc/web test`

Expected: all web tests PASS, including the positioning regression.

Run: `pnpm.cmd --filter @rc/web typecheck`

Expected: PASS.

- [ ] **Step 5: Commit the account menu fix**

```powershell
git add apps/web/app/account-menu-styles.test.ts apps/web/app/account-control.tsx apps/web/app/styles.css
git commit -m "Fix account menu layout and actions"
```

---

### Task 2: Build the How It Works experience

**Files:**
- Create: `apps/web/app/how-it-works-content.ts`
- Create: `apps/web/app/how-it-works-content.test.ts`
- Modify: `apps/web/app/simulation-screen.tsx`
- Modify: `apps/web/app/[...screen]/page.tsx`
- Modify: `apps/web/app/styles.css`

**Interfaces:**
- Produces: `howItWorksSteps`, an immutable five-item content array; `howItWorksRequirements`, an immutable requirements array; `ScreenName` value `"how-it-works"`.
- Consumes: existing `Header`, `ActionButton`, `IconLabel`, color variables, cut-panel treatment, and routes `/`, `/pricing#packs`.

- [ ] **Step 1: Write failing content tests**

```ts
import { describe, expect, test } from "vitest";
import { howItWorksRequirements, howItWorksSteps } from "./how-it-works-content";

describe("How It Works content", () => {
  test("describes the complete five-step customer journey", () => {
    expect(howItWorksSteps).toHaveLength(5);
    expect(howItWorksSteps.map((step) => step.id)).toEqual([
      "sign-in", "drive-time", "queue", "controls", "drive",
    ]);
  });

  test("makes the zero-wait queue path explicit", () => {
    const queue = howItWorksSteps.find((step) => step.id === "queue");
    expect(queue?.description).toMatch(/nobody is waiting/i);
    expect(queue?.description).toMatch(/immediately/i);
  });

  test("does not present safety as a page section", () => {
    expect(howItWorksRequirements.join(" ")).not.toMatch(/safety/i);
  });
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `pnpm.cmd --filter @rc/web test`

Expected: FAIL because `how-it-works-content.ts` does not exist.

- [ ] **Step 3: Add the pure content module**

```ts
export const howItWorksSteps = [
  { id: "sign-in", number: "01", title: "SIGN IN WITH GOOGLE", description: "Create your RC Mania driver profile in one click." },
  { id: "drive-time", number: "02", title: "CHOOSE DRIVE TIME", description: "Pick a one-time pack or a monthly plan that fits your pace." },
  { id: "queue", number: "03", title: "JOIN THE LIVE QUEUE", description: "See your position in real time. If nobody is waiting, your car is assigned immediately — no queue and no delay." },
  { id: "controls", number: "04", title: "CHECK YOUR CONTROLS", description: "Run a quick keyboard or game controller check before connecting." },
  { id: "drive", number: "05", title: "DRIVE & REVIEW", description: "Drive the real car, then review your laps, result, and updated balance." },
] as const;

export const howItWorksRequirements = [
  "Desktop or laptop computer",
  "Modern Chrome, Edge, Firefox, or Safari",
  "Stable internet connection",
  "Keyboard or optional game controller",
] as const;
```

- [ ] **Step 4: Add the screen, route, navigation, and styling**

Add `"how-it-works"` to `ScreenName` and `knownScreens`. Change the header link from `#how-it-works` to `/how-it-works`, with active-state logic matching other navigation items.

Render a `HowItWorksScreen` with:

- a hero panel containing `FROM SCREEN TO TRACK` and a short lead;
- five numbered step cards mapped from `howItWorksSteps`;
- a requirements panel mapped from `howItWorksRequirements`;
- `VIEW PRICING` linking to `/pricing#packs`;
- `BACK TO LIVE TRACK` linking to `/`.

Add desktop and mobile CSS under `.how-main`, `.how-hero`, `.how-step-grid`, `.how-step-card`, `.how-requirements`, and `.how-actions`. Keep all static content at module scope and map it during render.

- [ ] **Step 5: Run tests, types, and the web build**

Run: `pnpm.cmd --filter @rc/web test`

Expected: PASS.

Run: `pnpm.cmd --filter @rc/web typecheck`

Expected: PASS.

Run with production-safe dummy auth values:

```powershell
$env:DATABASE_URL='postgresql://rcmania:test-password@localhost:5432/rcmania'
$env:AUTH_SECRET='0123456789012345678901234567890123456789'
$env:AUTH_URL='https://rcmania.live'
$env:GOOGLE_OAUTH_CLIENT_ID='test.apps.googleusercontent.com'
$env:GOOGLE_OAUTH_CLIENT_SECRET='test-secret'
pnpm.cmd --filter @rc/web build
```

Expected: Next.js production build PASS and `/how-it-works` appears as a dynamic route through `[...screen]`.

- [ ] **Step 6: Commit the page**

```powershell
git add apps/web/app/how-it-works-content.ts apps/web/app/how-it-works-content.test.ts apps/web/app/simulation-screen.tsx 'apps/web/app/[...screen]/page.tsx' apps/web/app/styles.css
git commit -m "Add How It Works journey page"
```

---

### Task 3: Convert public raster assets to WebP

**Files:**
- Create: `apps/web/app/web-assets.test.ts`
- Create: `apps/web/scripts/convert-raster-assets.mjs`
- Modify: `apps/web/package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `apps/web/app/simulation-screen.tsx`
- Create: converted files under `apps/web/public/assets/*.webp`
- Delete: superseded `apps/web/public/**/*.{png,jpg,jpeg}` files

**Interfaces:**
- Produces: `pnpm --filter @rc/web assets:webp`, a repeatable conversion command.
- Consumes: Sharp `0.35.0` and the `apps/web/public` directory.

- [ ] **Step 1: Write the failing asset regression test**

```ts
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, test } from "vitest";

const publicDir = path.resolve(import.meta.dirname, "../public");

async function filesBelow(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map(async (entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? filesBelow(target) : [target];
  }))).flat();
}

describe("web raster assets", () => {
  test("ships no PNG or JPEG files or source references", async () => {
    const files = await filesBelow(publicDir);
    expect(files.filter((file) => /\.(png|jpe?g)$/iu.test(file))).toEqual([]);

    const screen = await readFile(new URL("./simulation-screen.tsx", import.meta.url), "utf8");
    expect(screen).not.toMatch(/\.(png|jpe?g)["']/iu);
  });
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `pnpm.cmd --filter @rc/web test`

Expected: FAIL and list the current PNG/JPG files.

- [ ] **Step 3: Add Sharp and the conversion script**

Run: `pnpm.cmd --filter @rc/web add --save-dev sharp@0.35.0`

Add `"assets:webp": "node scripts/convert-raster-assets.mjs"` to web scripts.

The script must recursively find PNG/JPG/JPEG inputs, preserve dimensions, write beside each source with a `.webp` extension, use `quality: 82`, `alphaQuality: 90`, `smartSubsample: true`, and `effort: 6`, then delete the source only after the WebP write succeeds. It prints total source and output bytes without printing file contents.

- [ ] **Step 4: Record the before size and run conversion**

Run:

```powershell
Get-ChildItem apps/web/public -Recurse -File | Where-Object { $_.Extension -match '^\.(png|jpe?g)$' } | Measure-Object Length -Sum
pnpm.cmd --filter @rc/web assets:webp
```

Expected: eight PNG/JPG files are replaced with WebP files, and the output byte total is materially smaller than the source total.

- [ ] **Step 5: Update application asset references**

Replace every `.png` or `.jpg` website source in `simulation-screen.tsx` with the matching `.webp` path. Run:

`rg -n "\.(png|jpe?g)" apps/web/app apps/web/public`

Expected: no legacy raster file reference or file remains.

- [ ] **Step 6: Run asset, web, type, and build checks**

Run: `pnpm.cmd --filter @rc/web test`

Expected: PASS.

Run: `pnpm.cmd --filter @rc/web typecheck`

Expected: PASS.

Run the production web build with the dummy auth environment from Task 2.

Expected: PASS with no missing asset errors.

- [ ] **Step 7: Commit asset optimization**

```powershell
git add apps/web/app/web-assets.test.ts apps/web/scripts/convert-raster-assets.mjs apps/web/package.json pnpm-lock.yaml apps/web/app/simulation-screen.tsx apps/web/public
git commit -m "Convert web raster assets to WebP"
```

---

### Task 4: Full verification and rendered QA

**Files:**
- Verify only; do not commit screenshots, traces, or temporary scripts.

**Interfaces:**
- Consumes: account menu fix, How It Works route, converted assets.
- Produces: fresh evidence for code quality, rendered desktop/mobile behavior, and interaction state.

- [ ] **Step 1: Run the full repository check**

With the dummy authentication environment set, run: `pnpm.cmd check`

Expected: lint, typecheck, all tests, and all builds PASS.

- [ ] **Step 2: Use the Browser plugin for rendered validation**

Read and follow `browser:control-in-app-browser`. The target flow is:

`/how-it-works loads -> five journey steps render -> queue step explains immediate assignment when nobody waits -> Pricing and Live Track actions navigate correctly.`

Validate desktop and one mobile viewport. Check URL/title, meaningful DOM, no framework overlay, relevant console warnings/errors, screenshot evidence, and both CTA interactions.

- [ ] **Step 3: Validate the account-menu regression**

Confirm through the CSS regression test that `.account-shell .account-menu` is absolute. If an authenticated Browser session is available, also open the profile menu and compare the header/logo bounding box before and after; the coordinates must not change. If an authenticated session is unavailable, report that exact remaining visual risk instead of fabricating evidence.

- [ ] **Step 4: Measure final assets and inspect Git state**

Run:

```powershell
Get-ChildItem apps/web/public -Recurse -File | Where-Object { $_.Extension -eq '.webp' } | Measure-Object Length -Sum
git diff --check
git status --short
```

Expected: WebP total is recorded, `git diff --check` passes, and the worktree is clean after commits.

- [ ] **Step 5: Report the verified local result and request publication approval**

Report changed files, the before/after raster byte totals, test/build results, Browser QA evidence, and any authenticated-menu viewport that could not be exercised. Ask the user whether to push and update the VPS; do not publish without that explicit confirmation.
