# RC Racing interaction, frame, and track design QA

## Comparison target

- Source visual truth:
  - `C:\Users\user\AppData\Local\Temp\codex-clipboard-4cbc46aa-2029-4889-8a5d-ad0e512144f3.png` — simplified single-route track reference.
  - `C:\Users\user\AppData\Local\Temp\codex-clipboard-7bfd3fac-a3c5-42b3-9aa9-e2658e6f07b4.png` — correctly closed clipped-corner reference.
  - `C:\Users\user\AppData\Local\Temp\codex-clipboard-45708b8f-a5dd-46f3-b442-c40a3785f811.png` — adjacent-corner refinement reference.
- Browser-rendered implementation:
  - `artifacts/visual-qa/corner-track-logo-final/01-home-live-track.png`
  - `artifacts/visual-qa/corner-track-logo-final/03-season-leaderboard.png`
  - `artifacts/visual-qa/corner-track-logo-final/mobile-home.png`
- Local implementation URL: `http://localhost:3001`
- Desktop viewport: 1672 × 941 CSS px at device scale factor 1.
- Mobile project: Playwright Pixel 7 device profile.
- State: default home and leaderboard states; hover and reduced-motion states were tested separately.

## Evidence

### Full-view comparison

The final desktop home, pricing, leaderboard, preflight, queue, results, and wide driving captures were reviewed together with the mobile home, pricing, leaderboard, and ride-gate captures. The final layout retains the existing RC Racing hierarchy, typography, palette, imagery, copy, and density. The new frame treatment is consistent across the clipped components without changing their dimensions.

### Focused region comparison

- `artifacts/design-qa/track-reference-vs-implementation.png`
  - Left: 368 × 183 source, normalized to 440 × 220.
  - Right: leaderboard implementation crop, normalized to 440 × 220.
  - Result: one continuous external route, with no inner contour, nested loop, doubled rail, or black image rectangle.
- `artifacts/design-qa/corner-reference-vs-implementation.png`
  - Left: 99 × 74 source, normalized to 220 × 160.
  - Right: hero implementation crop, normalized to 220 × 160.
  - Result: diagonal stroke closes the horizontal and vertical frame edges.
- `artifacts/design-qa/adjacent-corners-reference-vs-implementation.png`
  - Left: 109 × 77 refinement source, normalized to 220 × 154.
  - Right: adjacent metric-card implementation crop, normalized to 220 × 154.
  - Result: one-pixel diagonal strokes align cleanly with both adjoining edges.

## Required fidelity surfaces

- Fonts and typography: unchanged from the established Oswald/Rajdhani design; hierarchy, wrapping, weights, and letter spacing remain consistent.
- Spacing and layout rhythm: no component geometry or grid spacing was changed by the frame overlays. Mobile navigation now uses three equal columns and no longer exposes a clipped fourth label.
- Colors and visual tokens: corner strokes inherit each component's cyan, lime, red, amber, or neutral frame color. Motion preserves the existing semantic palette.
- Image quality and asset fidelity: the track is a dedicated transparent WebP asset at 1774 × 887. It follows the supplied silhouette and is 72,698 bytes, compared with 499,462 bytes for the former PNG.
- Copy and content: unchanged, except for accessibility state attributes that do not alter visible copy.

## Interaction and performance checks

- Hover motion is limited to fine-pointer devices and uses 100–190 ms transitions.
- Movement uses `transform`; no `transition: all`, scroll listener, animation loop, or `will-change` was added.
- `prefers-reduced-motion: reduce` removes decorative transforms.
- Touch devices retain press feedback without hover-only behavior.
- No animation runtime dependency was added. The CSS transfer increase is approximately 1,734 gzip bytes.
- Playwright final run: 6 passed, 6 viewport-conditioned skips for motion plus visual QA.
- Full end-to-end run immediately before the final one-pixel refinement: 10 passed, 14 viewport-conditioned skips.
- Production web build: passed.
- Console errors in the production visual-QA run: none.

## Comparison history

1. P2 — the first replacement still contained a nested inner loop.
   - Fix: regenerated the track from the user's simplified silhouette and replaced both consumers with the transparent single-route WebP.
   - Post-fix evidence: `track-reference-vs-implementation.png`.
2. P2 — diagonal corner strokes were rotated away from their horizontal and vertical frame edges.
   - Fix: reversed the corner gradient orientation for every clipped-corner pattern.
   - Post-fix evidence: `corner-reference-vs-implementation.png`.
3. P2 — the fourth mobile navigation label was visibly clipped.
   - Fix: changed the mobile navigation to three equal columns and hid the non-functional in-page anchor at that breakpoint.
   - Post-fix evidence: `mobile-home.png`.
4. P3 — adjacent diagonals had a slight antialiasing thickening at their endpoints.
   - Fix: reduced the normal frame band from 0.7 px to 0.5 px and the featured frame from 1.1 px to 1 px.
   - Post-fix evidence: `adjacent-corners-reference-vs-implementation.png`.
5. P2 — the first one-pixel endpoint adjustment moved the diagonal strokes toward the inside of each clipped corner.
   - Fix: reversed that adjustment by two pixels. The final corner overlay is one pixel smaller than the clip cut, so each diagonal sits closer to the outside corner.
   - Post-fix evidence: `artifacts/visual-qa/corner-track-logo-final/01-home-live-track.png`.

## Mock hero video replacement — 2026-07-28

- Source visual truth: `apps/web/public/assets/hero-track.png`, 1672 × 941 px.
- Motion source: `apps/web/public/assets/hero-track.mp4`, H.264, 1280 × 720 px, 25 fps, 14.52 seconds.
- Browser-rendered implementation:
  - `artifacts/design-qa/mock-hero-video-home.png`, 1265 × 712 px.
  - `artifacts/design-qa/mock-hero-video-region.png`, 735 × 390 px.
- CSS viewport: 1265 × 712 px at device scale factor 1.
- State: home route with `MOCK_MODE=true`; video autoplaying, muted, looping and inline.

### Full-view comparison evidence

The mock-mode capture preserves the existing hero dimensions, grid proportions, header, live badges, CTA position and the remaining page hierarchy. Replacing the poster with video causes no visible layout shift or overflow.

### Focused region comparison evidence

The poster and a live video frame were reviewed together. The video retains the same indoor RC-track subject, dark cyan/red lighting and wide hero crop. `object-fit: cover` fills the existing 735 × 390 slot without stretching. The moving car and frame-to-frame composition differ intentionally because the supplied MP4 is now the source in mock mode.

### Required fidelity surfaces

- Fonts and typography: unchanged.
- Spacing and layout rhythm: unchanged; the video occupies the exact former image box.
- Colors and visual tokens: existing cyan frame and red live badge remain intact.
- Image quality and asset fidelity: H.264 decoded at 1280 × 720 with browser `readyState=4`; no fallback poster was shown after playback began.
- Copy and content: unchanged.

### Interaction and runtime checks

- Video state: `paused=false`, `muted=true`, `loop=true`, duration 14.52 seconds.
- Primary CTA navigation from `/` to `/preflight`: passed.
- Browser console errors: none.
- Web TypeScript check: passed.
- First visual comparison found no actionable P0, P1 or P2 regression, so no corrective loop was required.

## Mock onboard video replacement — 2026-07-28

- Source visual truth: `apps/web/public/assets/drive-onboard.png`, 1308 × 735 px.
- Motion source: `apps/web/public/assets/drive-onboard.mp4`, H.264/AAC, 1280 × 720 px, 24 fps, 15.069 seconds.
- Browser-rendered implementation: `artifacts/design-qa/mock-drive-onboard-video-final.png`, 1265 × 712 px.
- CSS viewport: 1265 × 712 px at device scale factor 1.
- State: `/ride` with `MOCK_MODE=true`; onboard video autoplaying, looping, inline and muted by default.

### Full-view comparison evidence

The supplied poster and the final browser capture were reviewed together. The video preserves the same chase-camera subject, Citroën RC car, indoor track, cyan/red lighting and full-bleed crop. The HUD remains readable over motion and the background fills the viewport without stretching.

### Focused region comparison evidence

The entire route is a full-screen media composition, so the full-view pair is also the focused media comparison. Both sources use a near-identical 16:9 density; `object-fit: cover` introduces no visible aspect-ratio distortion.

### Required fidelity surfaces

- Fonts and typography: unchanged; compact desktop sizing retains the established Oswald/Rajdhani hierarchy.
- Spacing and layout rhythm: the wide driving layout remains unchanged; a compact desktop media query prevents controls from overlapping at 1265 × 712.
- Colors and visual tokens: existing cyan, lime and red HUD tokens remain intact over the supplied footage.
- Image quality and asset fidelity: the browser decodes the supplied 1280 × 720 H.264 video directly; the PNG remains the loading poster and non-mock fallback.
- Copy and content: unchanged.

### Interaction and runtime checks

- Video state: `paused=false`, `muted=true`, `loop=true`, duration 15.069 seconds.
- AUDIO button toggled the actual video audio off and on, then was returned to muted for handoff.
- END RIDE, AUDIO and telemetry hit areas no longer overlap in the compact desktop viewport.
- Browser console errors: none.
- Web TypeScript check: passed.

### Comparison history

1. P2 — at the 1265 × 712 in-app browser viewport, the original wide-only footer overlapped the AUDIO control and hid part of telemetry.
   - Fix: added a compact desktop layout for viewports up to 1600 px wide or 900 px high, reducing HUD dimensions and separating telemetry, extension and end-ride controls.
   - Post-fix evidence: `artifacts/design-qa/mock-drive-onboard-video-final.png`.
2. The post-fix comparison found no remaining actionable P0, P1 or P2 differences.

## Drive HUD at 50% scale — 2026-07-28

- Source visual truth: `artifacts/design-qa/mock-drive-onboard-video-final.png`, 1280 × 720 px.
- Browser-rendered implementation: `artifacts/design-qa/mock-drive-hud-half-scale.png`, 1280 × 720 px.
- CSS viewport: 1280 × 720 px at device scale factor 1.
- State: `/ride` with `MOCK_MODE=true`; the same HUD state is shown over a later frame of the looping onboard video.

### Full-view comparison evidence

The source and implementation were reviewed together at the same viewport. Every foreground HUD group now reports a computed `scale` of `0.5`: brand/live status, personal-best and season-rank statistics, lap timer, remaining-time ring, telemetry stack, extension action, and end-ride control. Their screen anchors remain intact and all seven groups stay inside the viewport.

### Focused region comparison evidence

A separate crop was not needed because all scaled regions remain clearly visible in the equal-size full-screen comparison. The computed bounding boxes provide the exact-size check: for example, the compact brand is now 220 × 36 px from a 440 × 72 px source box, telemetry is 110 px wide from a 220 px source box, and the end-ride control is 110 × 36 px from a 220 × 72 px source box.

### Required fidelity surfaces

- Fonts and typography: every HUD label, value, icon and action scales with its parent at exactly 50%; font family, weight, line height and letter spacing are otherwise unchanged.
- Spacing and layout rhythm: the original top-left, top-center, top-right, side and bottom anchors are preserved. The lap timer remains centered at `x=640`, while the compact footer remains aligned to the lower edges.
- Colors and visual tokens: cyan, lime, red, neutral borders, opacity and shadows are unchanged.
- Image quality and asset fidelity: the onboard video is not scaled with the HUD; it remains a full 1280 × 720 viewport fill, autoplaying and looping.
- Copy and content: unchanged.

### Interaction and runtime checks

- AUDIO, EXTEND +5 MIN and END RIDE still receive pointer hits at the center of their transformed visual bounds.
- Video state: `paused=false`, `muted=true`, `loop=true`.
- Browser console errors: none.
- Monorepo TypeScript check: passed.
- The first equal-viewport comparison found no actionable P0, P1 or P2 regression, so no corrective visual loop was required.

## Findings

No actionable P0, P1, or P2 differences remain.

## Follow-up polish

No blocking follow-up. The glow intensity of the raster track can be tuned later without changing its geometry or payload class.

final result: passed

---

# Portrait queue acceptance button — 2026-08-25

## Evidence

- Source: `C:\Users\user\AppData\Local\Temp\codex-clipboard-04c1c5f2-0e56-41fb-a391-d23bc748036e.png`.
- Corrected 390 × 844 render: `C:\Users\user\Documents\github\RC\artifacts\design-qa\queue-button-mobile-fixed.png`.
- Interactive preview: `artifacts/design-qa/queue-button-mobile-preview.html`.

## Checks

- The portrait breakpoint now stacks both queue actions at mobile widths instead of waiting for the 360 px breakpoint.
- The acceptance button uses responsive 17–20 px type, 14 px horizontal padding, a 12 px icon gap, and 6 px action-rail inset.
- Measured offer panel: left 14 px, right 361 px. Measured acceptance button: left 43 px, right 332 px. The button remains 29 px inside both panel edges.
- Document width stays within the 390 px viewport with no queue-action overflow.
- Desktop queue rules and button styling outside the mobile breakpoint are unchanged.

## Findings

No actionable P0, P1, or P2 differences remain for the reported portrait overflow. The static QA fixture simplifies car artwork but uses the production stylesheet and exact action markup geometry needed for this regression.

final result: passed

---

# Mobile ride dynamic viewport — 2026-08-25

## Evidence

- Source state: `C:\Users\user\AppData\Local\Temp\codex-clipboard-a32e2d03-c7f1-4f0e-b629-d9456ecde1bd.png` (1280 × 720, iPhone Safari with the toolbar hidden).
- Corrected local render: `C:\Users\user\Documents\github\RC\artifacts\design-qa\mobile-ride-dynamic-viewport.png` (1280 × 720).
- The local render uses the existing mock camera asset so the app-owned layout can be compared independently of a live car connection.

## Geometry and behavior checks

- The ride surface and video now follow the dynamic visible viewport: measured at 1280 × 720 with no unused area below the video.
- The mobile throttle panel spans from 48 px below the top edge to 10 px above the bottom edge, for a measured height of 662 px at this viewport.
- The compact session timer remains above the throttle panel without overlap.
- Existing mobile controls remain visible and reachable; no horizontal or vertical document overflow was measured.
- The CSS uses `100dvh` with a `100vh` fallback, replacing `100svh`, which remained locked to Safari's smaller toolbar-visible viewport.

## Findings

No actionable P0, P1, or P2 layout differences remain in the local render. Final confirmation of Safari's toolbar transition still requires testing the deployed build on the physical iPhone.

final result: passed

---

# Car connection loading screen design QA — 2026-08-16

## Comparison target

- Source visual truth: `C:\Users\user\Documents\github\RC\loading_page_imgs\ref.PNG`.
- Browser-rendered implementation: `C:\Users\user\AppData\Local\Temp\rc-loading-desktop.jpg`.
- Local implementation URL: `http://localhost:3000/loading?demo=1`.
- Source pixels: 1672 × 941.
- Implementation pixels: 1672 × 941 at device scale factor 1.
- Normalization: the in-app Browser viewport was 1672 × 958 CSS px and the implementation was clipped to the top 1672 × 941 CSS px so both comparison inputs have identical pixel dimensions and no browser chrome.
- State: demo mode, `CONNECTING`, all 19 mock log entries visible, active loading segments 4 and 5.

## Full-view comparison evidence

- Combined source/implementation view: `C:\Users\user\AppData\Local\Temp\rc-loading-comparison-full.png` (reference left, implementation right).
- The supplied background and transparent logo retain the same subject, crop, proportions, color balance, and focal points as the reference.
- Logo, connection label, loading rail, and log panel follow the same centered vertical hierarchy. The final panel top aligns at approximately 407 px in both images; panel width is approximately 1030 px in both images.
- The requested product copy intentionally changes `LOADING SESSION DATA` to `CONNECTING TO CAR`; the connection status and system-log content otherwise preserve the reference structure.

## Focused region comparison evidence

- Header and loading rail: `C:\Users\user\AppData\Local\Temp\rc-loading-comparison-top.png`.
  - Logo scale, title tracking, red accents, eight-segment rail, and the two adjacent green segments were compared at equal size.
- System log: `C:\Users\user\AppData\Local\Temp\rc-loading-comparison-panel.png`.
  - Header height, timestamp/code/message columns, 19-line density, status color, panel width, and bottom alignment were compared at equal size.

## Required fidelity surfaces

- Fonts and typography: the supplied raster logo is unchanged; existing Oswald handles display/status labels, while Consolas provides the narrow monospace system log. Hierarchy, wrapping, alignment, and line density remain readable and close to the source. The implementation log is marginally heavier than the raster reference, classified as P3 readability polish.
- Spacing and layout rhythm: desktop composition, rail width, log-panel geometry, section gaps, and vertical rhythm are aligned within roughly 10 px of the source. The final 390 × 844 mobile capture keeps all 19 log lines in the viewport with `bodyWidth=390`, `bodyHeight=844`, and no overflow.
- Colors and visual tokens: the exact supplied background preserves the black, amber, red, cyan, and blue palette. Status red and active-segment lime match the reference intent with sufficient contrast.
- Image quality and asset fidelity: `loading-background.webp` is 1672 × 941 and 215,800 bytes; `loading-logo.webp` is 1347 × 193 and 28,780 bytes with transparency preserved. Both render sharply without visible stretching, halos, or missing assets.
- Copy and content: all 19 timestamps, subsystem codes, and reference log messages are present. `CONNECTING TO CAR` is the only intentional headline deviation and directly implements the user's requested state.
- Icons: visible utility icons come from the existing Phosphor family. The terminal icon differs slightly from the reference arrow mark and is classified as P3.
- Accessibility: the screen uses semantic progress/log regions, an announced status, descriptive logo alt text, no decorative background announcement, and a reduced-motion branch that stops the moving pair and reveals the complete log.

## Interaction and responsive checks

- Animated pair changed from segments 1–2 to 4–5 while always containing exactly two adjacent active segments.
- Demo URL remained `/loading?demo=1` and made no automatic ride transition.
- Production-style browser flow passed: `/queue` → press `ACCEPT & CONNECT` → `/loading?car=40000000-0000-4000-8000-000000000001` → `/ride`.
- Ride screen rendered after the connection delay with `END RIDE` visible.
- Desktop and 390 × 844 mobile states rendered without horizontal overflow, clipping, overlap, or unreadable controls.
- In-app Browser console warning/error check: no relevant entries.

## Comparison history

1. P2 — the first browser capture placed the whole foreground composition about 35 px above the source.
   - Fix: increased the desktop shell top offset while retaining compact-height overrides.
   - Post-fix evidence: `rc-loading-comparison-full.png`; logo and panel anchors align with the source.
2. P2 — the first pass had only 18 log rows, wider loading geometry, and full-height red panel side rails.
   - Fix: restored the reference `FINAL` row and exact log wording, reduced the rail width, changed the panel rails to neutral steel, and tuned the monospace font.
   - Post-fix evidence: `rc-loading-comparison-top.png` and `rc-loading-comparison-panel.png`.

## Findings

No actionable P0, P1, or P2 differences remain.

## Follow-up polish

- P3: the source has fine decorative linework around the logo and more intricate clipped panel corners. The supplied logo/background assets do not contain those isolated ornaments, so the implementation keeps them simplified instead of substituting handcrafted CSS or SVG artwork.
- P3: the Phosphor terminal icon and browser-rendered monospace glyphs are slightly heavier than their raster counterparts.
- Reduced-motion behavior is implemented but the final in-app Browser session did not emulate the operating-system reduced-motion setting.

final result: passed
