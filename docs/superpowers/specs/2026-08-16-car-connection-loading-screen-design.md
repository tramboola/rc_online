# Car Connection Loading Screen Design

## Goal

Add a reference-faithful loading screen that appears while RC Mania connects a driver to a car. The same screen must also be available as a stable local demo for visual review with deterministic mock data.

## User Flow

1. The driver selects a car on the queue screen and presses `ACCEPT & CONNECT`.
2. The app navigates to `/loading?car=<car-id>` immediately.
3. The loading screen starts the existing connection workflow and keeps the user informed with an animated segmented indicator and progressive system log.
4. On success, the status briefly changes to `CONNECTED`, the final log entries appear, and the app replaces the loading route with `/ride`.
5. On failure, the screen remains visible, shows a clear failed state, and offers retry and return-to-queue actions.

The visual demo is available at `/loading?demo=1`. Demo mode uses deterministic mock log entries, continuously loops the two-segment loading animation, and never redirects to the ride screen.

## Visual Design

- Use `loading_page_imgs/ref.PNG` as the visual source of truth.
- Convert the supplied background and logo to WebP and place them under `apps/web/public/assets/`.
- Fill the viewport with the supplied dark racing background while preserving its focal point.
- Place the supplied RC Mania logo near the top center.
- Under the logo, show the uppercase label `CONNECTING TO CAR` with restrained red accents.
- Render an eight-segment loading rail. Exactly two adjacent green segments are active at once and move from left to right in a repeating cycle.
- Use a dark translucent system-log panel with thin steel borders, red corner accents, a `SYSTEM LOG` heading, and a right-aligned connection status.
- Reveal realistic mock log lines progressively. Timestamps and subsystem labels use aligned monospace columns.
- Preserve the cinematic widescreen proportions on desktop. On narrow viewports, reduce logo and panel scale, allow the log panel to fill most of the width, and keep all status text readable without horizontal scrolling.
- Respect `prefers-reduced-motion`: keep two visible active segments but stop movement and reveal the complete log immediately.

## Components and Responsibilities

- `LoadingScreen`: owns page state, connection lifecycle, status transitions, log timing, retry behavior, and the demo-mode branch.
- Loading indicator markup: renders eight semantic segments and calculates the two active positions from a single animation step.
- System log presentation: renders typed log entries and announces status changes without flooding screen readers.
- Existing `QueueScreen`: stores no new persistent data; it passes the selected car ID in the loading URL and delegates connection work to `LoadingScreen`.
- Existing dynamic route: recognizes `loading` as a valid screen and provides the same authentication/mock-mode context as queue and ride screens.

## Data and Connection Behavior

- Production administrator flow with live fleet data calls the existing `createAdminDriveSession(carId)` and saves the returned session with `saveDriveSession`.
- Simulation flow calls the existing ride-offer acceptance and ride-negotiation endpoints. Its existing offline-tolerant behavior remains deterministic.
- The screen remains visible for a short minimum duration so it does not flash away on fast local responses.
- Demo mode does not call APIs and does not write session data.
- Direct `/loading` access without a car ID falls back to the first mock car so local development never produces a blank screen.

## Error Handling

- A failed production connection stops automatic navigation and changes status to `CONNECTION FAILED`.
- The error is appended to the log in concise user-facing language.
- `RETRY CONNECTION` restarts the same flow with the current car ID.
- `RETURN TO QUEUE` navigates back to `/queue`.
- Repeated effects are cancelled on unmount so late promises and timers cannot navigate after the user leaves.

## Assets and Performance

- Generate `loading-background.webp` from `background.PNG` using high-quality lossy WebP.
- Generate `loading-logo.webp` from `logo.PNG`, preserving transparency if present.
- Do not ship the original PNG files through the web public directory.
- Use responsive image sizing and preload only the full-viewport background needed above the fold.

## Verification

- Type-check the web application and run relevant unit tests.
- Verify `/loading?demo=1` in the in-app browser at the reference aspect ratio and at one narrow mobile viewport.
- Confirm page identity, visible content, no framework overlay, no relevant console errors, and motion of exactly two adjacent segments.
- Verify the queue action navigates to loading before ride navigation.
- Compare the rendered desktop screenshot with `loading_page_imgs/ref.PNG`, record mismatches in `design-qa.md`, and fix all P0/P1/P2 issues before handoff.
- Keep the local preview running and provide the clickable demo URL.

## Scope Boundaries

- No new backend endpoints, persistence layer, authentication behavior, or deployment.
- No separate duplicated static HTML implementation; the demo route exercises the same production component to prevent visual drift.
- No unrelated redesign of the queue or ride screens.
