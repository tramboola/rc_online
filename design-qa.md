# RC Racing — Design QA

Date: 2026-07-25
Browser: Playwright Chromium 151
Build: Next.js production standalone server

## Source of truth and captured states

The seven files in `ui/` are the visual source of truth. Each implementation
capture uses the same CSS viewport as its corresponding reference and a device
pixel ratio of 1.

| Screen | Route and state | Viewport | Reference | Implementation |
| --- | --- | --- | --- | --- |
| Live track | `/`, normal live state | 1672×941 | `ui/01-home-live-track.png` | `artifacts/visual-qa/final/01-home-live-track.png` |
| Pricing | `/pricing`, default catalog | 1672×941 | `ui/02-pricing-memberships.png` | `artifacts/visual-qa/final/02-pricing-memberships.png` |
| Leaderboard | `/leaderboard`, current season | 1672×941 | `ui/03-season-leaderboard.png` | `artifacts/visual-qa/final/03-season-leaderboard.png` |
| Preflight | `/preflight`, gamepad selected and ready | 1672×941 | `ui/04-preflight-controls.png` | `artifacts/visual-qa/final/04-preflight-controls.png` |
| Queue | `/queue`, 24-second car offer | 1672×941 | `ui/05-live-queue.png` | `artifacts/visual-qa/final/05-live-queue.png` |
| Driving | `/ride`, connected ride with 2:17 remaining | 2730×1536 | `ui/06-driving-interface.png` | `artifacts/visual-qa/final/06-driving-interface.png` |
| Results | `/results`, completed ride | 1672×941 | `ui/07-ride-results.png` | `artifacts/visual-qa/final/07-ride-results.png` |

Additional responsive captures use the Playwright Pixel 7 profile: 412×839 CSS
pixels at DPR 2.625, producing 1082×2202 image files. They cover home, pricing,
leaderboard, and the desktop-required driving gate in
`artifacts/visual-qa/final/mobile-*.png`.

## Comparison evidence

Full-frame reference/implementation pairs:

- `artifacts/visual-qa/comparisons/final/01-home-live-track-pair.png`
- `artifacts/visual-qa/comparisons/final/02-pricing-memberships-pair.png`
- `artifacts/visual-qa/comparisons/final/03-season-leaderboard-pair.png`
- `artifacts/visual-qa/comparisons/final/04-preflight-controls-pair.png`
- `artifacts/visual-qa/comparisons/final/05-live-queue-pair.png`
- `artifacts/visual-qa/comparisons/final/06-driving-interface-pair.png`
- `artifacts/visual-qa/comparisons/final/07-ride-results-pair.png`

Focused comparison evidence:

- `artifacts/visual-qa/focused/final/pricing-header-pair.png`
- `artifacts/visual-qa/focused/final/preflight-controller-pair.png`
- `artifacts/visual-qa/focused/final/queue-offer-pair.png`
- `artifacts/visual-qa/focused/final/driving-hud-pair.png`

## Iteration record

| Pass | Findings | Resolution |
| --- | --- | --- |
| 1 | P0: production CSP blocked Next.js hydration. P1: clipped home title, missing footer and pricing balance. P1/P2: missing leaderboard date/track, sparse queue, incomplete offer states. P2: gamepad glyph and undersized ride HUD. | Added request-scoped CSP nonces, restored hydration, added the missing structure and generated assets, and rescaled reference-critical areas. |
| 2 | P1: home title still clipped and footer did not fit. P1: leaderboard heading wrapped. P2: several vertical proportions were loose. | Corrected display-title transform, tightened vertical rhythm, and rebuilt leaderboard/header sizing. |
| 3 | P1: home footer/card fit and leaderboard side-card height remained visibly different. | Rebalanced the home grid and footer; removed forced leaderboard panel stretching. |
| 4 | No P0/P1/P2 differences. Only acceptable P3 art/font variations remained. | Retained as final candidate and repeated screenshots and interaction checks. |
| Final | No actionable P0/P1/P2 differences at source viewports or mobile overflow. | Passed. |

Historical evidence is retained under
`artifacts/visual-qa/{pass-1,pass-2,pass-3,pass-4}` and
`artifacts/visual-qa/comparisons/{pass-1,pass-2,pass-3,pass-4}`.

## Functional and browser checks

- Full desktop path passed: home → preflight retest → queue → accept/connect →
  ride → end ride → results.
- Pricing creator-code feedback, preflight input/profile selection, and queue
  car selection passed.
- Mobile driving controls are replaced by the desktop-required gate while
  public pages remain available.
- All four mobile captures passed the no-horizontal-overflow assertion.
- Every captured route was checked for unexpected browser console errors.
- Final Playwright result: 8 applicable tests passed; 10 project-inapplicable
  cases were intentionally skipped.

## Residual P3 differences

- Generated vehicle and circuit artwork is contract-compatible but not the
  exact photography/contour in the supplied references.
- The unavailable source display face is approximated with local
  Oswald/Rajdhani fonts.
- Global navigation remains intentionally consistent across the application.

final result: passed
