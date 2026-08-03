# Leaderboard Frame and Empty-State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove clipped-frame hover artifacts and present an honest, navigable pre-launch leaderboard when `MOCK_MODE=true`.

**Architecture:** Move leaderboard labels and rows into a pure presentation helper selected by `mockMode`, then keep the screen component responsible only for rendering that model. Make `--frame-color` authoritative for both native borders and diagonal pseudo-element strokes so a single registered custom property drives rest and hover colors.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, CSS custom properties, Vitest, in-app Browser QA.

## Global Constraints

- `--frame-color` is the single source of truth for every clipped frame covered by the shared frame system.
- `View Rules` navigates to `/how-it-works`; do not create a separate rules page.
- `MOCK_MODE=true` must not display invented leaderboard, personal-season, date, or prize data.
- Mock mode renders exactly three placeholder rows and `SEASON HASN'T STARTED YET`.
- `Past Seasons` does not render.
- Non-mock mode retains the current populated leaderboard presentation.
- Do not add dependencies, API calls, database changes, or unrelated refactors.
- Commit messages remain in English.

---

## File Map

- Create `apps/web/app/leaderboard-presentation.ts`: pure mock/non-mock leaderboard presentation model.
- Create `apps/web/app/leaderboard-presentation.test.ts`: behavior tests for honest mock data and retained non-mock data.
- Create `apps/web/app/leaderboard-screen-source.test.ts`: source-level semantic regression checks for rules navigation and removed Past Seasons action.
- Create `apps/web/app/frame-styles.test.ts`: source-level regression checks for the single frame-color channel.
- Modify `apps/web/app/simulation-screen.tsx`: render the presentation model, semantic rules link, placeholder rows, and no Past Seasons control.
- Modify `apps/web/app/styles.css`: synchronize clipped frames and style the pre-launch table state.

---

### Task 1: Build the Leaderboard Presentation Model

**Files:**
- Create: `apps/web/app/leaderboard-presentation.ts`
- Create: `apps/web/app/leaderboard-presentation.test.ts`

**Interfaces:**
- Produces: `getLeaderboardPresentation(mockMode: boolean): LeaderboardPresentation`
- Produces: `LeaderboardRow` with `key`, `rank`, `driver`, `lap`, `gap`, `date`, `status`, and `placeholder`.
- Produces: banner fields, three mock placeholder rows, optional empty-state label, personal metrics, and optional `personalRow`.

- [ ] **Step 1: Write failing presentation tests**

```ts
import { describe, expect, test } from "vitest";

import { getLeaderboardPresentation } from "./leaderboard-presentation";

describe("leaderboard presentation", () => {
  test("shows an honest three-row pre-launch state in mock mode", () => {
    const presentation = getLeaderboardPresentation(true);

    expect(presentation.seasonStatus).toEqual({
      title: "COMING SOON",
      subtitle: "DATES TBA",
    });
    expect(presentation.prize).toEqual({
      title: "—",
      subtitle: "PRIZE POOL TBA",
    });
    expect(presentation.emptyMessage).toBe("SEASON HASN'T STARTED YET");
    expect(presentation.rows).toHaveLength(3);
    expect(presentation.rows.every((row) => row.placeholder)).toBe(true);
    expect(presentation.rows.flatMap((row) => [
      row.rank,
      row.driver,
      row.lap,
      row.gap,
      row.date,
      row.status,
    ])).toEqual(Array(18).fill("—"));
    expect(presentation.personal).toEqual({
      rank: "—",
      bestLap: "—",
      validLaps: "—",
      weeklyChange: "—",
    });
    expect(presentation.personalRow).toBeNull();
  });

  test("retains the populated leaderboard outside mock mode", () => {
    const presentation = getLeaderboardPresentation(false);

    expect(presentation.rows[0]).toMatchObject({
      rank: "1",
      driver: "NIGHTSHIFT",
      lap: "00:42.817",
      placeholder: false,
    });
    expect(presentation.emptyMessage).toBeNull();
    expect(presentation.personalRow).toMatchObject({
      rank: "27",
      driver: "GRIDRUNNER",
      lap: "00:47.306",
    });
  });
});
```

- [ ] **Step 2: Run the targeted test and verify RED**

Run: `pnpm --filter @rc/web exec vitest run app/leaderboard-presentation.test.ts`

Expected: FAIL because `./leaderboard-presentation` does not exist.

- [ ] **Step 3: Implement the pure presentation helper**

```ts
export type LeaderboardRow = {
  key: string;
  rank: string;
  driver: string;
  lap: string;
  gap: string;
  date: string;
  status: string;
  placeholder: boolean;
};

export type LeaderboardPresentation = {
  seasonStatus: { title: string; subtitle: string };
  prize: { title: string; subtitle: string };
  rows: readonly LeaderboardRow[];
  emptyMessage: string | null;
  personal: {
    rank: string;
    bestLap: string;
    validLaps: string;
    weeklyChange: string;
  };
  personalRow: LeaderboardRow | null;
};

const placeholderRows: readonly LeaderboardRow[] = Array.from(
  { length: 3 },
  (_, index) => ({
    key: `placeholder-${index + 1}`,
    rank: "—",
    driver: "—",
    lap: "—",
    gap: "—",
    date: "—",
    status: "—",
    placeholder: true,
  }),
);

const populatedRows: readonly LeaderboardRow[] = [
  ["NIGHTSHIFT", "00:42.817", "—", "MAY 12 · 11:42", "CONFIRMED"],
  ["APEXGHOST", "00:43.162", "+00.345", "MAY 12 · 10:28", "CONFIRMED"],
  ["REDLINE", "00:43.498", "+00.681", "MAY 12 · 09:57", "CONFIRMED"],
  ["VORTEX", "00:43.901", "+01.084", "MAY 11 · 20:14", "CONFIRMED"],
  ["BLITZ", "00:44.112", "+01.295", "MAY 11 · 18:33", "CONFIRMED"],
  ["TURBOJAY", "00:44.388", "+01.571", "MAY 11 · 16:22", "CONFIRMED"],
  ["SLIPSTREAM", "00:44.776", "+01.959", "MAY 10 · 09:41", "PENDING REVIEW"],
  ["PHANTOM", "00:44.993", "+02.176", "MAY 10 · 07:05", "CONFIRMED"],
].map(([driver, lap, gap, date, status], index) => ({
  key: driver,
  rank: String(index + 1),
  driver,
  lap,
  gap,
  date,
  status,
  placeholder: false,
}));

const populatedPresentation: LeaderboardPresentation = {
  seasonStatus: { title: "LIVE SEASON", subtitle: "ENDS AUG 18" },
  prize: { title: "$1,000", subtitle: "TOTAL PRIZE POOL" },
  rows: populatedRows,
  emptyMessage: null,
  personal: {
    rank: "#27",
    bestLap: "00:47.306",
    validLaps: "32",
    weeklyChange: "-01.204",
  },
  personalRow: {
    key: "current-user",
    rank: "27",
    driver: "GRIDRUNNER",
    lap: "00:47.306",
    gap: "+04.489",
    date: "MAY 10 · 01:15",
    status: "CONFIRMED",
    placeholder: false,
  },
};

export function getLeaderboardPresentation(
  mockMode: boolean,
): LeaderboardPresentation {
  if (mockMode) {
    return {
      seasonStatus: { title: "COMING SOON", subtitle: "DATES TBA" },
      prize: { title: "—", subtitle: "PRIZE POOL TBA" },
      rows: placeholderRows,
      emptyMessage: "SEASON HASN'T STARTED YET",
      personal: {
        rank: "—",
        bestLap: "—",
        validLaps: "—",
        weeklyChange: "—",
      },
      personalRow: null,
    };
  }

  return populatedPresentation;
}
```

- [ ] **Step 4: Run the targeted test and verify GREEN**

Run: `pnpm --filter @rc/web exec vitest run app/leaderboard-presentation.test.ts`

Expected: 2 tests pass.

- [ ] **Step 5: Commit the presentation model**

```bash
git add apps/web/app/leaderboard-presentation.ts apps/web/app/leaderboard-presentation.test.ts
git commit -m "Add leaderboard pre-launch presentation"
```

---

### Task 2: Render the Honest Mock Leaderboard and Navigation

**Files:**
- Create: `apps/web/app/leaderboard-screen-source.test.ts`
- Modify: `apps/web/app/simulation-screen.tsx`
- Modify: `apps/web/app/styles.css`

**Interfaces:**
- Consumes: `getLeaderboardPresentation(mockMode: boolean)` from Task 1.
- Changes: `LeaderboardScreen({ mockMode }: { mockMode: boolean })`.
- Changes: `SimulationScreen` passes its existing `mockMode` prop into `LeaderboardScreen`.

- [ ] **Step 1: Write failing source-level semantic tests**

```ts
import { readFile } from "node:fs/promises";

import { describe, expect, test } from "vitest";

const screenUrl = new URL("./simulation-screen.tsx", import.meta.url);

describe("leaderboard screen semantics", () => {
  test("links View Rules to the existing How It Works route", async () => {
    const source = await readFile(screenUrl, "utf8");

    expect(source).toMatch(
      /<Link className="action-button action-cyan" href="\/how-it-works">\s*<span>VIEW RULES<\/span>/su,
    );
  });

  test("does not render the premature Past Seasons action", async () => {
    const source = await readFile(screenUrl, "utf8");

    expect(source).not.toMatch(/PAST SEASONS/i);
  });

  test("passes mock mode into the leaderboard screen", async () => {
    const source = await readFile(screenUrl, "utf8");

    expect(source).toContain("<LeaderboardScreen mockMode={mockMode} />");
  });
});
```

- [ ] **Step 2: Run the targeted tests and verify RED**

Run: `pnpm --filter @rc/web exec vitest run app/leaderboard-screen-source.test.ts`

Expected: all three tests fail against the current button, Past Seasons label, and missing prop.

- [ ] **Step 3: Render the presentation model**

In `simulation-screen.tsx`:

```tsx
import { getLeaderboardPresentation } from "./leaderboard-presentation";

function LeaderboardScreen({ mockMode }: { mockMode: boolean }) {
  const presentation = getLeaderboardPresentation(mockMode);
  const SeasonStatusIcon = mockMode ? Clock : CheckCircle;

  return (
    <div className="page">
      <Header active="leaderboard" />
      <main className="leaderboard-main">
        <section className="season-banner panel-cut">
          <div><small>SEASON 01 —</small><h1>NEON CIRCUIT</h1></div>
          <IconLabel
            icon={SeasonStatusIcon}
            title={presentation.seasonStatus.title}
            subtitle={presentation.seasonStatus.subtitle}
            tone={mockMode ? "cyan" : "lime"}
          />
          <img
            className="season-track"
            src="/assets/neon-circuit-map-simple-v2.webp"
            alt="Neon Circuit track layout"
          />
          <IconLabel
            icon={Trophy}
            title={presentation.prize.title}
            subtitle={presentation.prize.subtitle}
            tone={mockMode ? "cyan" : "lime"}
          />
          <Link className="action-button action-cyan" href="/how-it-works">
            <span>VIEW RULES</span>
            <ArrowRight size={21} weight="bold" />
          </Link>
        </section>
        <div className="leaderboard-layout">
          <section className="ranking-table data-panel">
            <div className="table-row table-head">
              <span>RANK</span><span>DRIVER</span><span>BEST LAP</span><span>GAP</span><span>DATE</span><span>STATUS</span>
            </div>
            {presentation.emptyMessage ? (
              <div className="leaderboard-empty-note" role="status">
                {presentation.emptyMessage}
              </div>
            ) : null}
            {presentation.rows.map((row, index) => (
              <div
                className={`table-row${
                  !row.placeholder && index < 3 ? ` podium podium-${index + 1}` : ""
                }${row.placeholder ? " placeholder-row" : ""}`}
                key={row.key}
              >
                <strong>{row.rank}</strong>
                <b>{row.driver}</b>
                <strong>{row.lap}</strong>
                <span>{row.gap}</span>
                <small>{row.date}</small>
                <em className={
                  row.placeholder ? undefined : row.status === "CONFIRMED" ? "confirmed" : "pending"
                }>{row.status}</em>
              </div>
            ))}
            {presentation.personalRow ? (
              <div className="table-row you-row">
                <strong>{presentation.personalRow.rank}</strong>
                <b>{presentation.personalRow.driver}</b>
                <strong>{presentation.personalRow.lap}</strong>
                <span>{presentation.personalRow.gap}</span>
                <small>{presentation.personalRow.date}</small>
                <em>{presentation.personalRow.status}</em>
              </div>
            ) : null}
          </section>
          <div className="season-side">
            <aside className="your-season data-panel">
              <h2>YOUR SEASON</h2>
              <small>RANK</small><strong>{presentation.personal.rank}</strong>
              <small>PERSONAL BEST</small><b>{presentation.personal.bestLap}</b>
              <IconLabel icon={Gauge} title={presentation.personal.validLaps} subtitle="VALID LAPS" />
              <IconLabel
                icon={ChartBar}
                title={presentation.personal.weeklyChange}
                subtitle="THIS WEEK"
                tone="lime"
              />
            </aside>
          </div>
        </div>
      </main>
    </div>
  );
}
```

Delete the old `leaderboard` tuple constant and the previous `LeaderboardScreen`. Pass `mockMode` from `SimulationScreen`:

```tsx
if (screen === "leaderboard") {
  return <LeaderboardScreen mockMode={mockMode} />;
}
```

Add focused empty-state CSS:

```css
.leaderboard-empty-note {
  min-height: 58px;
  display: grid;
  place-items: center;
  color: var(--muted);
  border-bottom: 1px solid #203139;
  letter-spacing: 1.5px;
  font-weight: 700;
}
.table-row.placeholder-row { color: #5f6d75; }
.table-row.placeholder-row em { color: inherit; }
.season-side { display: block; }
```

- [ ] **Step 4: Run focused presentation and semantic tests**

Run: `pnpm --filter @rc/web exec vitest run app/leaderboard-presentation.test.ts app/leaderboard-screen-source.test.ts`

Expected: 5 tests pass.

- [ ] **Step 5: Run the web TypeScript check**

Run: `pnpm --filter @rc/web typecheck`

Expected: exit 0.

- [ ] **Step 6: Commit the leaderboard UI**

```bash
git add apps/web/app/simulation-screen.tsx apps/web/app/styles.css apps/web/app/leaderboard-screen-source.test.ts
git commit -m "Render honest mock leaderboard"
```

---

### Task 3: Make Frame Color a Single Rendering Channel

**Files:**
- Create: `apps/web/app/frame-styles.test.ts`
- Modify: `apps/web/app/styles.css`

**Interfaces:**
- Consumes: the existing registered `--frame-color` CSS custom property.
- Produces: native borders and diagonal pseudo-element strokes driven by the same property.

- [ ] **Step 1: Write failing frame-style regression tests**

```ts
import { readFile } from "node:fs/promises";

import { describe, expect, test } from "vitest";

const stylesUrl = new URL("./styles.css", import.meta.url);

describe("clipped frame colors", () => {
  test("derives native borders from the same frame color as diagonal corners", async () => {
    const css = await readFile(stylesUrl, "utf8");

    expect(css).toMatch(
      /\.account-chip,\s*\.panel-cut,[\s\S]*?\.readiness-box\s*\{[^}]*border-color:\s*var\(--frame-color\);/u,
    );
    expect(css).toMatch(
      /\.how-hero\s*\{[^}]*--frame-color:\s*var\(--cyan\);[^}]*border:\s*1px solid var\(--frame-color\);/su,
    );
  });

  test("hover changes only the shared frame variable", async () => {
    const css = await readFile(stylesUrl, "utf8");

    const hoverBlock = css.match(
      /\.hero-link:not\([^}]+?\.action-button:hover:not\(:disabled\)\s*\{([^}]*)\}/su,
    )?.[1] ?? "";

    expect(hoverBlock).toContain("--frame-color: var(--frame-hover-color)");
    expect(hoverBlock).not.toContain("border-color:");
  });
});
```

- [ ] **Step 2: Run the targeted test and verify RED**

Run: `pnpm --filter @rc/web exec vitest run app/frame-styles.test.ts`

Expected: FAIL because shared frames do not derive native borders from `--frame-color` and hover still sets `border-color` separately.

- [ ] **Step 3: Unify the frame color source**

In the shared frame declaration, add:

```css
border-color: var(--frame-color);
```

Update framed component selectors so their intended colors are assigned through `--frame-color`. In particular:

```css
.how-hero {
  --frame-color: var(--cyan);
  border: 1px solid var(--frame-color);
}
```

Remove redundant `border-color` declarations from action tone classes and hover blocks. Remove `border-color` from frame-related transition lists; animating the registered `--frame-color` now updates both native borders and pseudo-element corner gradients in lockstep. Preserve transform, color, and icon movement transitions.

Apply these exact selector changes so later rules cannot override the shared channel:

```css
.hero-link, .action-button { border: 1px solid var(--frame-color); }
.action-cyan { color: var(--cyan); background: rgba(5, 22, 27, .92); }
.action-ghost { color: #d6d6d6; background: rgba(4, 10, 14, .82); }
.action-lime { color: var(--lime); background: rgba(12, 24, 7, .9); }

.product-card { border: 1px solid var(--frame-color); }
.product-card.featured { border-width: 2px; }

.how-step-queue { --frame-color: var(--lime); }
.how-fast-lane { --frame-color: var(--lime); }

.queue-position { --frame-color: var(--cyan); }
.queue-closed,
.stop-panel { --frame-color: var(--red); }
```

Remove only the redundant direct `border-color` tokens from `.tone-lime`, `.tone-red`, `.tone-amber`, `.home-cards .challenge-card`, `.product-card.popular`, `.queue-position`, `.queue-closed`, and `.stop-panel`; their existing `--frame-color` declarations preserve the palette. Leave unrelated borders such as table separators, inputs, telemetry controls, and non-clipped panels unchanged.

- [ ] **Step 4: Run the targeted test and verify GREEN**

Run: `pnpm --filter @rc/web exec vitest run app/frame-styles.test.ts`

Expected: 2 tests pass.

- [ ] **Step 5: Run all web tests and TypeScript checks**

Run: `pnpm --filter @rc/web test && pnpm --filter @rc/web typecheck`

Expected: all web tests pass and TypeScript exits 0.

- [ ] **Step 6: Commit the frame fix**

```bash
git add apps/web/app/styles.css apps/web/app/frame-styles.test.ts
git commit -m "Unify clipped frame colors"
```

---

### Task 4: Full Verification and Browser QA

**Files:**
- Verify only; do not add committed screenshots or temporary scripts.

**Interfaces:**
- Consumes: completed Tasks 1-3.
- Produces: fresh automated and rendered evidence.

- [ ] **Step 1: Run the complete repository check**

Run with test-only environment values:

```powershell
$env:GOOGLE_OAUTH_CLIENT_ID='test-google-client-id'
$env:GOOGLE_OAUTH_CLIENT_SECRET='test-google-client-secret'
$env:AUTH_SECRET='test-auth-secret-with-at-least-32-characters'
$env:AUTH_URL='http://127.0.0.1:3000'
$env:DATABASE_URL='postgresql://test:test@localhost:5432/rcmania'
pnpm.cmd check
```

Expected: lint, typecheck, tests, and production build all exit 0.

- [ ] **Step 2: Start the local production-mock UI**

Run in a dedicated terminal with the same test-only auth/database values from Step 1:

```powershell
$env:MOCK_MODE='true'
pnpm.cmd --filter @rc/web dev -- --hostname 127.0.0.1 --port 3000
```

Keep the process running only for QA and use `http://127.0.0.1:3000` as the exact Browser target.

- [ ] **Step 3: Verify `/leaderboard` at desktop width**

Using the in-app Browser:

- confirm page title and `/leaderboard` URL;
- confirm `COMING SOON`, `DATES TBA`, `SEASON HASN'T STARTED YET`, and three placeholder rows;
- confirm NIGHTSHIFT, GRIDRUNNER, fake lap values, and Past Seasons are absent;
- confirm the How It Works hero and View Rules frames have matching straight and diagonal colors at rest and hover;
- confirm no framework overlay and no relevant console warnings or errors;
- capture a desktop screenshot outside the repository.

- [ ] **Step 4: Verify View Rules navigation**

Confirm the `VIEW RULES` locator is a unique link. Click it with an expected-navigation guard and verify the final URL is `/how-it-works` and the `FROM SCREEN TO TRACK` heading is visible.

- [ ] **Step 5: Verify mobile layout**

Set a temporary 390x844 viewport, reload `/leaderboard`, and confirm the pre-launch message, placeholder table, Your Season dashes, and rules link remain readable without horizontal clipping. Capture a mobile screenshot outside the repository, then reset the viewport.

- [ ] **Step 6: Stop the temporary local server and inspect Git state**

Run: `git status -sb && git diff --check && git log --oneline origin/main..HEAD`

Expected: only the intended implementation commits are ahead of `origin/main`, with no temporary QA artifacts or unstaged changes.
