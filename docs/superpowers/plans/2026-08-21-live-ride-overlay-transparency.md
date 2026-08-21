# Live Ride Overlay Transparency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the opaque dark containers behind connection status and steering-neutral adjustment while preserving readable, usable controls over live camera video.

**Architecture:** Keep the existing React state and control components unchanged. Remove the generic framed-panel class from connection status and narrow CSS to transparent layout, using text/icon shadow rather than a large background; apply the same treatment to the steering trim container.

**Tech Stack:** React 19, Next.js 16, CSS, Vitest, Browser plugin visual QA.

**Spec:** `docs/superpowers/specs/2026-08-21-signed-pi-agent-ota-design.md`

## Global Constraints

- Remove both opaque rectangles, borders, corner frames, and container drop shadows.
- Preserve status text, slider, save state, reset button, keyboard visualisation, session timer, and end-session behaviour.
- Keep controls readable over bright and dark video with small text/icon shadows only.
- Do not increase the camera-obscured area.
- Validate at 1920×1080 and a smaller desktop viewport.
- Use English commit messages.

---

### Task 1: Lock the transparent markup contract with a render test

**Files:**
- Modify: `apps/web/app/real-ride-screen.render.test.tsx`
- Modify: `apps/web/app/real-ride-screen.tsx`

**Interfaces:**
- Consumes: existing `RealRideScreen` connected-state markup.
- Produces: connection status without the shared `data-panel` frame class.

- [ ] **Step 1: Write the failing render assertion**

Render the connected ride state and assert:

```ts
expect(html).toContain('class="real-ride-status"');
expect(html).not.toContain('class="real-ride-status data-panel"');
expect(html).toContain('class="real-steering-trim"');
```

- [ ] **Step 2: Verify RED**

Run:

```powershell
pnpm.cmd --filter @rc/web test -- app/real-ride-screen.render.test.tsx
```

Expected: FAIL because connection status still includes `data-panel`.

- [ ] **Step 3: Remove only the inherited panel class**

Change:

```tsx
<section className="real-ride-status" aria-live="polite">
```

Do not change state, labels, status semantics, or event handlers.

- [ ] **Step 4: Verify GREEN**

Run the same test and expect PASS.

---

### Task 2: Remove opaque container styling

**Files:**
- Modify: `apps/web/app/styles.css`
- Modify: `apps/web/app/real-ride-screen.render.test.tsx`

**Interfaces:**
- Consumes: `.real-ride-status` and `.real-steering-trim` selectors.
- Produces: transparent overlays with readable foreground controls.

- [ ] **Step 1: Add failing CSS source assertions**

Read `styles.css` in the render test and assert the two target rules contain:

```css
background: transparent;
border: 0;
filter: none;
```

Also assert `.real-ride-status::before` and `::after` are absent or disabled, so generic corner frames cannot reappear.

- [ ] **Step 2: Verify RED**

Run the focused test and confirm it fails on the current opaque values.

- [ ] **Step 3: Apply the minimal CSS change**

For `.real-ride-status`, remove the large padding/background and set transparent background, zero border, no filter, and a compact text shadow on child text/icons. For `.real-steering-trim`, set transparent background, zero border, no container filter, retain current width/position, and give labels/value/reset button enough local contrast without adding a full-width backing rectangle.

Keep the range track and thumb visible; the reset button may retain its own compact button surface because it does not obscure a large camera area.

- [ ] **Step 4: Verify GREEN and full web checks**

```powershell
pnpm.cmd --filter @rc/web test
pnpm.cmd --filter @rc/web typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add apps/web/app/real-ride-screen.tsx apps/web/app/real-ride-screen.render.test.tsx apps/web/app/styles.css
git commit -m "Remove opaque live ride overlays"
```

---

### Task 3: Rendered Browser QA

**Files:**
- No committed QA files.

**Interfaces:**
- Consumes: local authenticated connected-ride fixture.
- Produces: screenshot and interaction evidence without repository artifacts.

- [ ] **Step 1: Define the target flow**

The flow under test is: `/ride` connected state → camera view renders → connection status and steering trim remain usable without opaque background rectangles.

- [ ] **Step 2: Start the exact local app and use Browser plugin**

Name the Browser session, navigate to the local `/ride` fixture, verify URL/title, meaningful DOM, no framework overlay, and clean console.

- [ ] **Step 3: Capture desktop proof**

At 1920×1080, capture a screenshot and DOM snapshot proving the camera remains visible behind both areas and that labels, slider value, reset button, timer, and connection state remain readable.

- [ ] **Step 4: Exercise the steering control**

Move the slider, verify the displayed percentage/save state changes, click reset, and verify it returns to `0%`. Confirm no layout shift or opaque panel appears.

- [ ] **Step 5: Capture smaller desktop proof**

Repeat at 1366×768 and check clipping, overlap with keyboard/end-session controls, and camera obstruction.

- [ ] **Step 6: Final verification**

Run the full web test, typecheck, production build, and `git diff --check`. Keep screenshots outside the repository and include them in the final QA report.

