# Burning Wheel Contact Sheet Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate a transparent numbered 2x2 WebP contact sheet containing four approved burning racing-wheel concepts for user selection.

**Architecture:** Generate one square raster source with four isolated concepts on a flat chroma-key background using the built-in image-generation tool. Post-process it locally to alpha transparency, add deterministic quadrant numbers, validate the result, and leave production UI unchanged until the user chooses a variant.

**Tech Stack:** Built-in image generation, installed `remove_chroma_key.py` helper, Python Pillow, WebP with alpha.

## Global Constraints

- Produce the four approved directions: Photoreal, Racing poster, Cinematic drift, and Cyber racing.
- Use one wheel per quadrant, angled three-quarters toward the viewer and moving toward the right.
- Use a perfectly flat `#00ff00` source background and no chroma green in the artwork.
- Include no car body, road, environment, logos, watermark, or generated text.
- Add only deterministic labels `1`, `2`, `3`, and `4` during local post-processing.
- Do not modify production website code or assets before the user selects a concept.

---

### Task 1: Generate and validate the selection preview

**Files:**
- Create: `docs/design-previews/burning-wheel-contact-sheet-source.png`
- Create: `docs/design-previews/burning-wheel-contact-sheet-alpha.png`
- Create: `docs/design-previews/burning-wheel-contact-sheet.webp`

**Interfaces:**
- Consumes: the approved visual directions from `docs/superpowers/specs/2026-08-03-burning-wheel-contact-sheet-design.md`
- Produces: a transparent numbered WebP preview that the user can select from by quadrant number

- [ ] **Step 1: Generate the chroma-key contact sheet**

  Use the built-in image-generation tool with one structured prompt requesting the four concepts in a strict 2x2 grid on a perfectly flat `#00ff00` background. Request no text or quadrant labels from the model.

- [ ] **Step 2: Inspect the source**

  Verify that there is exactly one complete wheel in each quadrant, concepts are materially different, the background is flat chroma green, and no unwanted text, car body, road, logo, or watermark appears.

- [ ] **Step 3: Remove the chroma background**

  Run:

  ```powershell
  python "C:\Users\user\.codex\skills\.system\imagegen\scripts\remove_chroma_key.py" --input "docs\design-previews\burning-wheel-contact-sheet-source.png" --out "docs\design-previews\burning-wheel-contact-sheet-alpha.png" --auto-key border --soft-matte --transparent-threshold 12 --opaque-threshold 220 --despill
  ```

  Expected: a PNG with alpha transparency, transparent corners, and no obvious green fringe.

- [ ] **Step 4: Add deterministic quadrant labels and save WebP**

  Use Pillow to add small high-contrast labels `1`, `2`, `3`, and `4` near the top-left of their quadrants without touching the wheel silhouettes. Save `docs/design-previews/burning-wheel-contact-sheet.webp` with alpha transparency and WebP quality 90.

- [ ] **Step 5: Validate the final preview**

  Check that the file format is WebP, alpha is present, all four corners are transparent, all four labels are present, subject coverage is plausible, and the image renders correctly when viewed.

- [ ] **Step 6: Present the preview**

  Render the final WebP inline and ask the user to select variant `1`, `2`, `3`, or `4`. Do not update production UI yet.

### Task 2: Integrate selected variant 4 into the challenge card

**Files:**
- Create: `apps/web/public/assets/challenge-burning-wheel.webp`
- Modify: `apps/web/app/web-assets.test.ts`
- Modify: `apps/web/app/simulation-screen.tsx:261`
- Modify: `apps/web/app/styles.css:450-451, 870, 993, 1202`

**Interfaces:**
- Consumes: bottom-right variant `4` from `docs/design-previews/burning-wheel-contact-sheet-alpha.png`
- Produces: a transparent WebP website asset referenced only by the Creator Challenge card

- [ ] **Step 1: Write the failing asset-contract test**

  Extend `apps/web/app/web-assets.test.ts` with a test that opens `public/assets/challenge-burning-wheel.webp` through `sharp`, then asserts `format === "webp"`, `hasAlpha === true`, and non-zero dimensions.

- [ ] **Step 2: Run the test to verify RED**

  Run:

  ```powershell
  pnpm.cmd --filter @rc/web test -- app/web-assets.test.ts
  ```

  Expected: FAIL because `challenge-burning-wheel.webp` does not exist.

- [ ] **Step 3: Extract and optimize variant 4**

  Crop the bottom-right quadrant from the alpha master, trim to non-transparent bounds with proportional padding, and save `apps/web/public/assets/challenge-burning-wheel.webp` with alpha transparency, WebP quality 90, and no number label.

- [ ] **Step 4: Replace the challenge-card artwork reference**

  In `simulation-screen.tsx`, change only the challenge card image source to `/assets/challenge-burning-wheel.webp`, set the alternative text to `Burning racing wheel`, and rename the class from `challenge-car` to `challenge-art`.

  In `styles.css`, rename the matching selectors and change the artwork from `object-fit: cover` to `object-fit: contain`, keeping the existing positioning, opacity, blend mode, and hover behavior.

- [ ] **Step 5: Run the test to verify GREEN**

  Run:

  ```powershell
  pnpm.cmd --filter @rc/web test -- app/web-assets.test.ts
  ```

  Expected: both web asset tests PASS.

- [ ] **Step 6: Verify the application**

  Run web typecheck and production build, then inspect the challenge card at desktop and mobile widths. Confirm the wheel is not clipped, does not cover the left-side copy, loads successfully, and preserves the hover treatment.
