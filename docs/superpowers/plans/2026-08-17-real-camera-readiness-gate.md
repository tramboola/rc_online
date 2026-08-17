# Real Camera Readiness Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the RC Mania connection screen over the real ride until WebRTC is direct and the browser has decoded the first onboard-camera frame.

**Architecture:** The real ride mounts once and owns the WebRTC client for its whole lifetime. A controlled loading overlay covers the ride while a focused connection-attempt controller creates the drive session, tracks real connection milestones, waits for `DIRECT` plus `loadeddata`, and keeps the control loop stopped until both signals are present. The standalone `/loading?demo=1` route reuses the same overlay with deterministic demo state.

**Tech Stack:** Next.js 16, React 19, TypeScript, Vitest, browser WebSocket/WebRTC/MediaStream APIs, existing RC Mania components and CSS.

## Global Constraints

- Production readiness requires both WebRTC `DIRECT` and video `loadeddata` from the same attempt.
- Production has no fixed 3.2-second success delay.
- Connection timeout is exactly 15 seconds per attempt.
- Keyboard controls and the browser control loop remain stopped and disarmed while the overlay is visible.
- Retry must close the old client and stop its loop before creating a new drive session.
- `/loading?demo=1` never calls production APIs or creates WebRTC.
- No global WebRTC provider, backend endpoint, dependency, deployment, or unrelated redesign.
- Preserve all unrelated untracked files in the repository root.

---

### Task 1: Controlled Loading Overlay

**Files:**
- Modify: `apps/web/app/connection-loading-screen.test.tsx`
- Modify: `apps/web/app/connection-loading-screen.tsx`
- Modify: `apps/web/app/styles.css`

**Interfaces:**
- Produces: `ConnectionLogEntry`, `ConnectionLoadingStatus`, and `ConnectionLoadingOverlay(props)`.
- Preserves: `ConnectionLoadingScreen`, `getActiveLoadingSegments`, and `/loading?demo=1` behavior.

- [ ] **Step 1: Write failing overlay render tests**

Add a controlled rendering case that supplies real state instead of allowing the component to start networking:

```tsx
const markup = renderToStaticMarkup(
  <ConnectionLoadingOverlay
    activeStep={4}
    entries={[{ time: "10:00:00", code: "VIDEO", message: "First frame decoded" }]}
    errorMessage=""
    onRetry={() => undefined}
    onReturn={() => undefined}
    status="connected"
  />,
);

expect(markup).toContain("CONNECTED");
expect(markup).toContain("First frame decoded");
expect(markup).not.toContain("RETRY CONNECTION");
```

Add a failed-state case and assert that both `RETRY CONNECTION` and `RETURN TO QUEUE` are present.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm.cmd --filter @rc/web test -- app/connection-loading-screen.test.tsx`

Expected: FAIL because `ConnectionLoadingOverlay` and its public types do not exist.

- [ ] **Step 3: Extract the controlled overlay**

Export these types:

```ts
export type ConnectionLoadingStatus = "connecting" | "connected" | "failed";

export type ConnectionLogEntry = {
  time: string;
  code: string;
  message: string;
  tone?: "default" | "success" | "danger";
};
```

Implement `ConnectionLoadingOverlay` as presentation only:

```ts
export type ConnectionLoadingOverlayProps = {
  activeStep: number;
  entries: readonly ConnectionLogEntry[];
  errorMessage: string;
  onRetry: () => void;
  onReturn: () => void;
  status: ConnectionLoadingStatus;
};
```

Move the existing artwork, title, progressbar, log panel, status label, and failed actions into this component. Keep `ConnectionLoadingScreen` as a demo wrapper that owns only demo timers and passes deterministic props. Remove production session creation and redirect effects from the demo wrapper.

- [ ] **Step 4: Add overlay positioning without changing demo layout**

Add `.connection-loading-overlay` as a fixed, viewport-filling layer with a z-index above every ride control. Reuse `.connection-loading-page` inside it. The standalone demo omits the fixed wrapper so its desktop and mobile screenshots remain unchanged.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run: `pnpm.cmd --filter @rc/web test -- app/connection-loading-screen.test.tsx app/simulation-screen.render.test.tsx`

Expected: PASS, with demo output still containing eight segments and exactly two active segments.

- [ ] **Step 6: Commit**

```text
git add apps/web/app/connection-loading-screen.tsx apps/web/app/connection-loading-screen.test.tsx apps/web/app/styles.css
git commit -m "Extract controlled connection loading overlay"
```

### Task 2: Real WebRTC Progress Events

**Files:**
- Modify: `apps/web/app/ride-session-client.test.ts`
- Modify: `apps/web/app/ride-session-client.ts`

**Interfaces:**
- Produces: `RideConnectionProgress` and `RideSessionClient.onProgress`.
- Preserves: existing signaling protocol, `onState`, `onStream`, `onError`, and channel configuration.

- [ ] **Step 1: Write failing progress tests**

Register `client.onProgress = progress.push` in the existing harness and prove these events:

```ts
expect(progress).toContain("gateway.connecting");
socket.readyState = 1;
socket.onopen?.();
expect(progress).toContain("gateway.connected");

socket.onmessage?.({ data: JSON.stringify(sessionStartMessage) });
await vi.waitFor(() => expect(progress).toContain("webrtc.offer-sent"));

socket.onmessage?.({ data: JSON.stringify(answerMessage) });
await vi.waitFor(() => expect(progress).toContain("webrtc.answer-applied"));

peer.connectionState = "connected";
peer.onconnectionstatechange?.();
expect(progress).toContain("webrtc.direct");

peer.ontrack?.({ streams: [stream] });
expect(progress).toContain("video.track-received");
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm.cmd --filter @rc/web test -- app/ride-session-client.test.ts`

Expected: FAIL because `onProgress` is not part of `RideSessionClient`.

- [ ] **Step 3: Add the bounded progress contract**

Export:

```ts
export type RideConnectionProgress =
  | "gateway.connecting"
  | "gateway.connected"
  | "session.started"
  | "webrtc.offer-sent"
  | "webrtc.answer-applied"
  | "webrtc.direct"
  | "video.track-received";
```

Add:

```ts
onProgress: (progress: RideConnectionProgress) => void = () => undefined;
```

Emit only from the real lifecycle point represented by each event. Do not synthesize progress with timers.

- [ ] **Step 4: Run tests and verify GREEN**

Run: `pnpm.cmd --filter @rc/web test -- app/ride-session-client.test.ts`

Expected: PASS together with all existing authentication, signaling, stream, and close tests.

- [ ] **Step 5: Commit**

```text
git add apps/web/app/ride-session-client.ts apps/web/app/ride-session-client.test.ts
git commit -m "Expose real ride connection progress"
```

### Task 3: One Attempt Camera Readiness Controller

**Files:**
- Create: `apps/web/app/ride-connection-attempt.test.ts`
- Create: `apps/web/app/ride-connection-attempt.ts`

**Interfaces:**
- Consumes: `StoredDriveSession`, `RideSessionClient`, `RideConnectionProgress`, `BrowserControlLoop`, and `createAdminDriveSession` through injected dependencies.
- Produces: `RideConnectionAttempt`, `RideConnectionSnapshot`, and `RideConnectionAttemptCallbacks`.

- [ ] **Step 1: Write failing readiness-gate tests**

Define fakes for session creation, client, loop, timeout scheduling, and callbacks. Prove independently:

```ts
await attempt.start();
client.onState("DIRECT");
expect(callbacks.onReady).not.toHaveBeenCalled();
expect(loop.start).not.toHaveBeenCalled();

attempt.markVideoLoadedData();
expect(callbacks.onReady).toHaveBeenCalledTimes(1);
expect(loop.start).toHaveBeenCalledTimes(1);
expect(loop.arm).toHaveBeenCalledTimes(1);
```

Add the inverse order test: `markVideoLoadedData()` first, then `DIRECT`. Add timeout and close tests that assert the loop is disarmed/stopped, the client is closed, and `onFailed("Camera connection timed out")` fires. Add a stale-attempt test proving callbacks after `close()` do nothing.

- [ ] **Step 2: Run the new test and verify RED**

Run: `pnpm.cmd --filter @rc/web test -- app/ride-connection-attempt.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the controller contract**

Use these public shapes:

```ts
export type RideConnectionSnapshot = {
  activeStep: number;
  entries: readonly ConnectionLogEntry[];
  errorMessage: string;
  status: ConnectionLoadingStatus;
};

export type RideConnectionAttemptCallbacks = {
  onSnapshot: (snapshot: RideConnectionSnapshot) => void;
  onStream: (stream: MediaStream) => void;
  onReady: (loop: BrowserControlLoop) => void;
};
```

`RideConnectionAttempt.start()` must:

1. publish `Creating drive session`;
2. schedule one 15,000ms timeout;
3. await `createAdminDriveSession(carId)`;
4. create one client and one loop;
5. bind client progress/state/error/stream callbacks;
6. call `client.connect()` and bind its channels to the still-stopped loop.

Map real progress events to concise log codes and monotonic steps. Store `direct` and `videoLoadedData` booleans. Call `onReady` exactly once only when both are true. Then clear the timeout, append `Camera ready`, set `connected`, start and arm the loop.

`close(reason)` and failure paths must cancel the timeout, disarm/stop the loop, close the client, invalidate callbacks, and never call `onReady` later.

Expose `fail(message: string)` for video playback rejection. Session creation
errors, `client.onError`, terminal `DISCONNECTED` before readiness, timeout, and
`fail()` all use the same idempotent teardown path.

- [ ] **Step 4: Run controller tests and verify GREEN**

Run: `pnpm.cmd --filter @rc/web test -- app/ride-connection-attempt.test.ts`

Expected: PASS for both signal orders, timeout, cleanup, and stale callbacks.

- [ ] **Step 5: Commit**

```text
git add apps/web/app/ride-connection-attempt.ts apps/web/app/ride-connection-attempt.test.ts
git commit -m "Gate rides on real camera readiness"
```

### Task 4: Real Ride Overlay and Control Activation

**Files:**
- Modify: `apps/web/app/real-ride-screen.test.ts`
- Modify: `apps/web/app/real-ride-screen.tsx`
- Modify: `apps/web/app/simulation-screen.render.test.tsx`
- Modify: `apps/web/app/simulation-screen.tsx`

**Interfaces:**
- Consumes: `getRideUrl(carId)`, `RideConnectionAttempt`, `ConnectionLoadingOverlay`, and the ready `BrowserControlLoop` callback.
- Produces: queue-to-ride navigation and a real ride hidden until camera readiness.

- [ ] **Step 1: Write failing navigation and integration assertions**

Replace the loading URL expectation with:

```ts
expect(getRideUrl("car id/01")).toBe("/ride?car=car%20id%2F01");
```

Update the real-ride source assertions to require:

```ts
expect(source).toContain("ConnectionLoadingOverlay");
expect(source).toContain("onLoadedData");
expect(source).toContain("markVideoLoadedData");
expect(source).not.toContain("loop.start();\n    loop.arm();");
```

Add an assertion that the queue action uses `getRideUrl(selectedCar)` and no longer routes production through `/loading?car=`.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `pnpm.cmd --filter @rc/web test -- app/real-ride-screen.test.ts app/connection-loading-screen.test.tsx app/simulation-screen.render.test.tsx`

Expected: FAIL because production still navigates through `/loading` and the real ride has no controlled overlay.

- [ ] **Step 3: Route the selected car directly to the covered ride**

Export from the loading module or a focused route helper:

```ts
export function getRideUrl(carId: string): string {
  return `/ride?car=${encodeURIComponent(carId)}`;
}
```

Change `QueueScreen.accept()` to push `getRideUrl(selectedCar)`. Preserve `/loading?demo=1` as the standalone demo route.

- [ ] **Step 4: Integrate one connection attempt into `RealRideScreen`**

Read `car` from `useSearchParams`. On mount and retry:

- create one `RideConnectionAttempt`;
- send snapshots to React state;
- attach `onStream` to the existing muted `playsInline` video;
- call `video.play()` and report a playback rejection as an attempt failure;
- call `attempt.markVideoLoadedData()` from the video `onLoadedData` handler;
- store the loop received by `onReady` and only then attach keyboard/focus/visibility listeners;
- render `ConnectionLoadingOverlay` above the entire ride until snapshot status is `connected`;
- retry by closing the current attempt and incrementing an attempt key;
- return by closing the current attempt and pushing `/queue`.

Do not create a second `RideSessionClient` after readiness. Remove the old `loadDriveSession()` connection effect from `RealRideScreen`.

- [ ] **Step 5: Run focused and full web tests**

Run: `pnpm.cmd --filter @rc/web test -- app/real-ride-screen.test.ts app/ride-connection-attempt.test.ts app/ride-session-client.test.ts app/connection-loading-screen.test.tsx app/simulation-screen.render.test.tsx`

Expected: PASS.

Run: `pnpm.cmd --filter @rc/web test`

Expected: all web tests PASS.

- [ ] **Step 6: Commit**

```text
git add apps/web/app/real-ride-screen.tsx apps/web/app/real-ride-screen.test.ts apps/web/app/simulation-screen.tsx apps/web/app/simulation-screen.render.test.tsx
git commit -m "Wait for the real camera before showing rides"
```

### Task 5: Complete Verification and Browser QA

**Files:**
- Modify only if a verified defect is found: files from Tasks 1-4 and their tests.

**Interfaces:**
- Consumes: completed camera readiness flow.
- Produces: fresh automated and visual evidence; no deployment.

- [ ] **Step 1: Run static and production checks**

Run:

```text
pnpm.cmd --filter @rc/web typecheck
pnpm.cmd --filter @rc/web lint
pnpm.cmd --filter @rc/web test
pnpm.cmd --filter @rc/web build
```

Expected: every command exits 0 with no relevant warning or error.

- [ ] **Step 2: Run the complete monorepo test suite**

Run: `pnpm.cmd test`

Expected: every Turbo task succeeds.

- [ ] **Step 3: Verify the standalone demo in the in-app Browser**

At desktop and 390x844 viewports, open `/loading?demo=1`. Confirm meaningful content, no framework overlay, no console errors, valid WebP assets, exactly two active segments, stable responsive layout, and no redirect.

- [ ] **Step 4: Verify production gating with deterministic fakes**

Run the focused client, controller, and component tests with injected session,
WebSocket, WebRTC, MediaStream, timer, and video events. Confirm:

1. overlay fully covers the ride initially;
2. `DIRECT` alone leaves the overlay visible;
3. `loadeddata` then marks the attempt ready and component tests remove the overlay;
4. reversing event order has the same result;
5. no keyboard input is accepted before readiness;
6. timeout leaves the overlay with Retry and Return;
7. Retry creates one new attempt and ignores old callbacks.

- [ ] **Step 5: Inspect the final diff and repository state**

Run `git diff --check`, review every changed file, and confirm the unrelated untracked documents and `loading_page_imgs/` remain untouched.

- [ ] **Step 6: Final commit for any QA-only corrections**

If Task 5 required a correction, commit only the corrected source and matching regression test with:

```text
git commit -m "Polish real camera connection gating"
```

If no correction was needed, do not create an empty commit.
