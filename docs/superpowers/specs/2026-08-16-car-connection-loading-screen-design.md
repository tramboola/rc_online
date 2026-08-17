# Car Connection Loading Screen Design

## Goal

Add a reference-faithful full-screen loading overlay that remains visible while
RC Mania establishes the real administrator drive session, WebRTC connection,
and onboard camera stream. The camera interface must not be revealed until the
peer connection is direct and the browser has decoded the first video frame.

The same presentation remains available as a stable local demo with
deterministic mock data, but production readiness is driven only by real
connection events.

## User Flow

1. The driver selects a car on the queue screen and presses `ACCEPT & CONNECT`.
2. The app opens `/ride?car=<car-id>` immediately.
3. `RealRideScreen` mounts once, but a full-screen connection overlay completely
   hides the camera, telemetry, and controls.
4. The ride screen creates the drive session, connects to the gateway, performs
   WebRTC signaling, attaches the remote stream to its video element, and waits
   for both readiness signals:
   - peer connection state is `DIRECT`;
   - the video element fires `loadeddata`, proving that the browser decoded the
     first frame.
5. Real connection milestones are appended to the visible system log as they
   happen. Production does not advance through a fake timer.
6. Only after both readiness signals are true does the status become
   `CONNECTED`; the overlay then fades away and reveals the already-connected
   camera.
7. On failure or a 15-second timeout, the overlay remains visible, shows a clear
   failed state, and offers retry and return-to-queue actions.

The visual demo remains available at `/loading?demo=1`. Demo mode uses
deterministic mock log entries, continuously loops the two-segment loading
animation, never creates a drive session, and never redirects to the ride
screen.

## Visual Design

- Use `loading_page_imgs/ref.PNG` as the visual source of truth.
- Convert the supplied background and logo to WebP and place them under `apps/web/public/assets/`.
- Fill the viewport with the supplied dark racing background while preserving its focal point.
- Place the supplied RC Mania logo near the top center.
- Under the logo, show the uppercase label `CONNECTING TO CAR` with restrained red accents.
- Render an eight-segment loading rail. Exactly two adjacent green segments are active at once and move from left to right in a repeating cycle.
- Use a dark translucent system-log panel with thin steel borders, red corner accents, a `SYSTEM LOG` heading, and a right-aligned connection status.
- Reveal deterministic mock log lines progressively in demo mode and real
  connection milestones in production. Timestamps and subsystem labels use
  aligned monospace columns.
- Preserve the cinematic widescreen proportions on desktop. On narrow viewports, reduce logo and panel scale, allow the log panel to fill most of the width, and keep all status text readable without horizontal scrolling.
- Respect `prefers-reduced-motion`: keep two visible active segments but stop movement and reveal the complete log immediately.

## Components and Responsibilities

- `ConnectionLoadingOverlay` is a controlled presentation component. It renders
  connection status, real or demo log entries, segmented progress, retry, and
  return actions. It does not own production networking.
- `ConnectionLoadingScreen` keeps the standalone `/loading?demo=1` visual-review
  route and supplies deterministic demo state to the shared overlay.
- Loading indicator markup renders eight semantic segments. Demo mode loops two
  adjacent segments; production maps real milestones to monotonic progress and
  never claims completion before the camera gate passes.
- `RideSessionClient` remains the single WebSocket and WebRTC owner. It exposes
  bounded progress notifications for gateway connection, authentication,
  signaling, peer connection, and remote video-track receipt.
- `RealRideScreen` owns the complete production attempt, the 15-second timeout,
  the two-signal readiness gate, retry cleanup, and control activation.
- Existing `QueueScreen` stores no new persistent data. It passes the selected
  car ID in the ride URL and delegates session creation to `RealRideScreen`.
- The dynamic route continues to recognize `loading` for the demo route while
  production uses the existing administrator-only `ride` route.

## Data and Connection Behavior

- Production administrator flow reads `car` from `/ride?car=<car-id>` and calls
  the existing `createAdminDriveSession(carId)`.
- The resulting session is used immediately to construct `RideSessionClient`.
  The production path does not use session storage to transfer connection state.
  Reloading the car-scoped ride URL starts a fresh drive-session attempt.
- The loading overlay and ride interface are mounted within the same
  `RealRideScreen`; revealing the camera therefore does not unmount or recreate
  the WebRTC client.
- `DIRECT` and `loadeddata` are independent flags. Either may arrive first, and
  the overlay remains until both are true for the same connection attempt.
- A remote track alone is insufficient, as is a connected peer without a
  decoded frame.
- There is no fixed 3.2-second production delay. A short visual fade may run
  only after the real readiness gate has passed.
- Demo mode does not call APIs, create a peer connection, write session data, or
  activate keyboard controls.
- Direct `/loading?demo=1` access remains deterministic for visual review.

## Control Safety

- The browser control loop may be constructed during connection setup, but it
  must not start, arm, attach keyboard listeners, or send motion frames while
  the overlay is visible.
- Controls activate only after the real camera readiness gate passes.
- Retry first disarms and stops any loop, closes the old WebRTC client, clears
  the video element, resets readiness flags, and then creates a fresh drive
  session.
- Returning to queue, unmounting, timing out, or receiving a terminal connection
  error closes the current client and leaves controls neutral.

## Error Handling

- A 15-second timer starts for each production attempt before session creation.
- Session, gateway, signaling, peer, video, and playback failures stop the
  attempt and change status to `CONNECTION FAILED`.
- If `DIRECT` and `loadeddata` are not both true before the timer expires, the
  attempt fails with `Camera connection timed out`.
- The error and the last completed real milestone are visible in the log.
- `RETRY CONNECTION` tears down the failed attempt and starts a new one with the
  same car ID.
- `RETURN TO QUEUE` neutralizes and closes the attempt before navigating.
- Attempt identifiers or cancellation guards prevent callbacks from an older
  attempt from making a retry ready or changing its log.

## Assets and Performance

- Generate `loading-background.webp` from `background.PNG` using high-quality lossy WebP.
- Generate `loading-logo.webp` from `logo.PNG`, preserving transparency if present.
- Do not ship the original PNG files through the web public directory.
- Use responsive image sizing and preload only the full-viewport background needed above the fold.

## Verification

- Type-check the web application and run relevant unit tests.
- Verify `/loading?demo=1` in the in-app browser at the reference aspect ratio and at one narrow mobile viewport.
- Confirm page identity, visible content, no framework overlay, no relevant console errors, and motion of exactly two adjacent demo segments.
- Verify the queue action opens the real ride with the full-screen overlay before any camera UI is visible.
- Prove that `DIRECT` without `loadeddata` does not reveal the ride.
- Prove that `loadeddata` without `DIRECT` does not reveal the ride.
- Prove that the second signal reveals the already-connected camera without
  constructing another `RideSessionClient`.
- Prove that the control loop remains stopped and disarmed until readiness.
- Prove the 15-second timeout, retry teardown, stale-attempt isolation, and
  return-to-queue cleanup.
- Test the successful connection with deterministic injected WebSocket, WebRTC,
  MediaStream, and video events; a live Raspberry Pi is not required for
  automated acceptance. Browser QA covers the shared loading presentation,
  while the two-signal production gate is covered by controller and component
  tests until the Pi is available for a live end-to-end check.
- Compare the rendered desktop screenshot with `loading_page_imgs/ref.PNG`, record mismatches in `design-qa.md`, and fix all P0/P1/P2 issues before handoff.
- Keep the local preview running and provide the clickable demo URL.

## Scope Boundaries

- No new backend endpoints, persistence layer, authentication behavior, or deployment.
- No separate duplicated static HTML implementation; the demo route exercises the same production component to prevent visual drift.
- No unrelated redesign of the queue or ride screens.
- No global WebRTC provider or cross-route transfer manager.
- No claim that a real camera connection has passed until the peer is direct and
  the browser has decoded the first frame.
