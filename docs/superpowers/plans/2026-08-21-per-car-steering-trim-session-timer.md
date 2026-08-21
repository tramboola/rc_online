# Per-Car Steering Trim and Five-Minute Session Timer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist a safe `-20..20%` neutral-steering trim per car, apply it through direct WebRTC on Raspberry Pi, and end every drive at the existing server-issued five-minute expiry with a visible `MM:SS` countdown and redirect to Pricing.

**Architecture:** PostgreSQL is the only persistent trim source. Session creation returns the car trim and five-minute `expiresAt`; the browser applies trim immediately in v4 control frames and persists it through an active-session-scoped endpoint. Raspberry Pi accepts v3 as zero trim and v4 with validated trim, applies it only to armed center steering, and keeps all fail-safe neutral paths untrimmed.

**Tech Stack:** PostgreSQL 16, Drizzle ORM, Next.js 16, React 19, TypeScript 5.9, Vitest 4, WebRTC DataChannel, Python 3, pytest, aiortc, Raspberry Pi hardware PWM.

**Spec:** `docs/superpowers/specs/2026-08-21-per-car-steering-trim-session-timer-design.md`

## Global Constraints

- Car trim is an integer from `-20` through `20`; database default is `0`.
- Negative moves neutral left, positive moves neutral right, and endpoints never move.
- Disarmed, stale, malformed, disconnected, startup, and shutdown states use the untrimmed hardware center.
- Drive-session expiry remains exactly five minutes from server-side creation.
- Countdown derives from the returned absolute `expiresAt`; it never starts an independent five-minute clock.
- Expiry clears input, neutralizes, closes the session once, and uses `router.replace("/pricing")`.
- Pi accepts fast-control v3 as zero trim and v4 with a required bounded trim field.
- Reliable arm/neutral messages remain v3 because their wire contract is unchanged.
- Website must not emit v4 in production before the compatible Pi agent is installed.
- No new UI framework, animation package, or client data-fetching dependency.
- Do not stage or modify the pre-existing untracked plan files or `loading_page_imgs/`.
- Production publication is a separate explicitly authorized operation.

## File Responsibility Map

### RC repository

- `packages/database/migrations/0005_car_steering_trim.sql`: additive database column and range constraint.
- `packages/database/src/schema.ts`: Drizzle field and constraint.
- `packages/database/src/migrations.test.ts`: executable migration contract.
- `apps/web/app/drive-session-store.ts`: reserve a car, read its trim, and issue a five-minute expiry.
- `apps/web/app/drive-session-store.test.ts`: pure five-minute expiry behavior.
- `apps/web/app/api/admin/drive-sessions/route.ts`: include trim in the created-session response.
- `apps/web/app/api/admin/drive-sessions/route.test.ts`: response contract and server time assertions.
- `apps/web/app/steering-trim-store.ts`: active-session-authorized PostgreSQL update.
- `apps/web/app/api/drive-sessions/[sessionId]/steering-trim/route.ts`: authenticated same-origin trim endpoint.
- `apps/web/app/api/drive-sessions/[sessionId]/steering-trim/route.test.ts`: endpoint authorization and validation.
- `apps/web/app/session-countdown.ts`: deterministic remaining-time formatter/controller.
- `apps/web/app/session-countdown.test.ts`: timer boundaries and one-shot expiry.
- `apps/web/app/steering-trim.ts`: trim bounds plus browser persistence request.
- `apps/web/app/steering-trim.test.ts`: normalization and request contract.
- `apps/web/app/control-loop.ts`: v4 fast frame and current trim state.
- `apps/web/app/control-loop.test.ts`: v4 payload and unchanged reliable messages.
- `apps/web/app/ride-connection-attempt.ts`: surface the server-created session to the ride UI.
- `apps/web/app/ride-connection-attempt.test.ts`: created-session callback ordering.
- `apps/web/app/real-ride-screen.tsx`: countdown, expiry teardown, live trim, persistence status.
- `apps/web/app/real-ride-screen.render.test.tsx`: timer/trim markup and accessible controls.
- `apps/web/app/styles.css`: top-right timer and bottom-center trim strip.
- `tests/hardware/pi-direct-pwm/rc_bench/live_control.py`: bench-side neutral trim mapping.
- `tests/hardware/pi-direct-pwm/rc_bench/live_server.py`: accept bounded bench trim input.
- `tests/hardware/pi-direct-pwm/tests/test_live_control.py`: bench mapping and fail-safe tests.
- `tests/hardware/pi-direct-pwm/tests/test_live_server.py`: bench request validation.

### tether-rally-mjx repository

- `pi-agent/rc_pi_agent/control.py`: command trim field and side-aware center calculation.
- `pi-agent/rc_pi_agent/runtime.py`: carry trim into the state machine.
- `pi-agent/rc_pi_agent/webrtc.py`: strict v3/v4 parsing with v3 fallback to zero.
- `pi-agent/tests/test_control.py`: symmetric/asymmetric PWM behavior and fail-safe center.
- `pi-agent/tests/test_runtime.py`: runtime propagation.
- `pi-agent/tests/test_webrtc.py`: version compatibility and malformed-frame rejection.

---

### Task 1: Add the per-car database trim contract

**Repository:** `RC`

**Files:**
- Create: `packages/database/migrations/0005_car_steering_trim.sql`
- Modify: `packages/database/src/schema.ts`
- Modify: `packages/database/src/migrations.test.ts`

**Interfaces:**
- Produces: `cars.steeringTrimPercent: number`, persisted as `steering_trim_percent`.
- Range: integer `-20..20`, non-null, default `0`.

- [ ] **Step 1: Write the failing migration test**

Add this behavior to `migrations.test.ts`:

```ts
it("adds bounded per-car steering trim", async () => {
  const sql = await readFile(
    path.resolve(here, "../migrations/0005_car_steering_trim.sql"),
    "utf8",
  );
  expect(sql).toMatch(/alter table cars\s+add column steering_trim_percent integer not null default 0/i);
  expect(sql).toMatch(/check \(steering_trim_percent between -20 and 20\)/i);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm.cmd --filter @rc/database test -- migrations.test.ts`

Expected: FAIL because migration `0005_car_steering_trim.sql` does not exist.

- [ ] **Step 3: Add the migration**

```sql
alter table cars
  add column steering_trim_percent integer not null default 0,
  add constraint cars_steering_trim_range
    check (steering_trim_percent between -20 and 20);
```

- [ ] **Step 4: Add the Drizzle field and matching check**

Inside `cars`:

```ts
steeringTrimPercent: integer("steering_trim_percent").notNull().default(0),
```

Inside the car table checks:

```ts
check(
  "cars_steering_trim_range",
  sql`${table.steeringTrimPercent} between -20 and 20`,
),
```

- [ ] **Step 5: Verify database tests and typecheck GREEN**

Run: `pnpm.cmd --filter @rc/database test`

Run: `pnpm.cmd --filter @rc/database typecheck`

Expected: both exit `0`.

- [ ] **Step 6: Commit**

```powershell
git add -- packages/database/migrations/0005_car_steering_trim.sql packages/database/src/schema.ts packages/database/src/migrations.test.ts
git commit -m "Add per-car steering trim storage"
```

### Task 2: Return trim and exact server expiry with drive sessions

**Repository:** `RC`

**Files:**
- Modify: `apps/web/app/drive-session-store.ts`
- Create: `apps/web/app/drive-session-store.test.ts`
- Modify: `apps/web/app/api/admin/drive-sessions/route.ts`
- Modify: `apps/web/app/api/admin/drive-sessions/route.test.ts`
- Modify: `apps/web/app/ride-session-client.ts`

**Interfaces:**
- Produces: `CreatedDriveSession = { sessionId: string; expiresAt: Date; steeringTrimPercent: number }`.
- Produces: `driveSessionExpiresAt(now: Date): Date`.
- Extends: `StoredDriveSession` with `steeringTrimPercent: number`.

- [ ] **Step 1: Write failing store and route tests**

Create `drive-session-store.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { driveSessionExpiresAt } from "./drive-session-store";

describe("driveSessionExpiresAt", () => {
  it("expires a drive exactly five minutes after server creation", () => {
    expect(driveSessionExpiresAt(new Date("2026-08-21T12:00:00.000Z"))).toEqual(
      new Date("2026-08-21T12:05:00.000Z"),
    );
  });
});
```

Update the successful route fixture to return `steeringTrimPercent: -7` and assert:

```ts
expect(body).toMatchObject({
  sessionId,
  expiresAt: "2026-08-13T10:05:00.000Z",
  steeringTrimPercent: -7,
});
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `pnpm.cmd --filter @rc/web test -- drive-session-store.test.ts route.test.ts`

Expected: FAIL because the expiry helper and trim response do not exist.

- [ ] **Step 3: Implement the five-minute helper and transactional trim read**

```ts
export const DRIVE_SESSION_DURATION_MS = 5 * 60_000;

export function driveSessionExpiresAt(now: Date): Date {
  return new Date(now.getTime() + DRIVE_SESSION_DURATION_MS);
}
```

Select both `cars.id` and `cars.steeringTrimPercent` when locking the available
car. Return that value with the inserted session:

```ts
return session ? {
  sessionId: session.id,
  expiresAt,
  steeringTrimPercent: available.steeringTrimPercent,
} : null;
```

- [ ] **Step 4: Extend route and browser session contracts**

Include `steeringTrimPercent` in the route dependency type and JSON response.
Add the required number to `StoredDriveSession` and keep session-storage parsing
strict enough to reject non-integer or out-of-range trim values.

- [ ] **Step 5: Run focused and complete web tests GREEN**

Run: `pnpm.cmd --filter @rc/web test -- drive-session-store.test.ts route.test.ts ride-session-client.test.ts`

Run: `pnpm.cmd --filter @rc/web typecheck`

Expected: both exit `0`.

- [ ] **Step 6: Commit**

```powershell
git add -- apps/web/app/drive-session-store.ts apps/web/app/drive-session-store.test.ts apps/web/app/api/admin/drive-sessions/route.ts apps/web/app/api/admin/drive-sessions/route.test.ts apps/web/app/ride-session-client.ts apps/web/app/ride-session-client.test.ts
git commit -m "Return steering trim with drive sessions"
```

### Task 3: Persist trim only through the active session owner

**Repository:** `RC`

**Files:**
- Create: `apps/web/app/steering-trim-store.ts`
- Create: `apps/web/app/api/drive-sessions/[sessionId]/steering-trim/route.ts`
- Create: `apps/web/app/api/drive-sessions/[sessionId]/steering-trim/route.test.ts`

**Interfaces:**
- Produces: `SteeringTrimStore.update(userId, sessionId, trim, now): Promise<number | null>`.
- Produces: `createSteeringTrimPatch(dependencies)` for route-level unit tests.
- HTTP: `PATCH /api/drive-sessions/:sessionId/steering-trim` with `{ steeringTrimPercent: integer }`.

- [ ] **Step 1: Write failing endpoint tests**

Cover these literal outcomes:

```ts
expect((await patchWithUser(null)(request(0))).status).toBe(401);
expect((await patchWithOrigin("https://evil.example")(request(0))).status).toBe(403);
expect((await patchWithUser(userId)(request(21))).status).toBe(400);
expect((await patchWithStore(async () => null)(request(5))).status).toBe(409);

const response = await patchWithStore(async (requestedUser, requestedSession, trim, now) => {
  expect({ requestedUser, requestedSession, trim, now }).toEqual({
    requestedUser: userId,
    requestedSession: sessionId,
    trim: -12,
    now: new Date("2026-08-21T12:01:00.000Z"),
  });
  return -12;
})(request(-12));
expect(await response.json()).toEqual({ steeringTrimPercent: -12 });
```

- [ ] **Step 2: Run the route test and verify RED**

Run: `pnpm.cmd --filter @rc/web test -- steering-trim/route.test.ts`

Expected: FAIL because the route module does not exist.

- [ ] **Step 3: Implement strict route validation**

Use a strict Zod body:

```ts
const bodySchema = z.object({
  steeringTrimPercent: z.number().int().min(-20).max(20),
}).strict();
```

Reuse the trusted reverse-proxy same-origin rule from drive-session creation.
Return `409` when no active owned session can be updated.

- [ ] **Step 4: Implement the PostgreSQL update**

In one transaction, select a drive session matching:

```ts
and(
  eq(driveSessions.id, sessionId),
  eq(driveSessions.userId, userId),
  inArray(driveSessions.status, ["created", "negotiating", "active"]),
  gt(driveSessions.expiresAt, now),
)
```

Update only `cars.id === session.carId`, set `steeringTrimPercent` and
`updatedAt`, then return the persisted integer.

- [ ] **Step 5: Verify focused tests and typecheck GREEN**

Run: `pnpm.cmd --filter @rc/web test -- steering-trim/route.test.ts`

Run: `pnpm.cmd --filter @rc/web typecheck`

Expected: both exit `0`.

- [ ] **Step 6: Commit**

```powershell
git add -- apps/web/app/steering-trim-store.ts 'apps/web/app/api/drive-sessions/[sessionId]/steering-trim/route.ts' 'apps/web/app/api/drive-sessions/[sessionId]/steering-trim/route.test.ts'
git commit -m "Persist trim through active drive sessions"
```

### Task 4: Build deterministic countdown and trim client primitives

**Repository:** `RC`

**Files:**
- Create: `apps/web/app/session-countdown.ts`
- Create: `apps/web/app/session-countdown.test.ts`
- Create: `apps/web/app/steering-trim.ts`
- Create: `apps/web/app/steering-trim.test.ts`

**Interfaces:**
- Produces: `remainingSessionSeconds(expiresAt: string, now: Date): number`.
- Produces: `formatSessionTime(seconds: number): string`.
- Produces: `SessionCountdown` with `start(expiresAt)`, `stop()`, one-shot `onExpire`.
- Produces: `normalizeSteeringTrim(value: number): number`.
- Produces: `saveSteeringTrim(sessionId, trim, fetcher?): Promise<number>`.

- [ ] **Step 1: Write failing pure-behavior tests**

```ts
expect(remainingSessionSeconds("2026-08-21T12:05:00.000Z", new Date("2026-08-21T12:00:00.001Z"))).toBe(300);
expect(remainingSessionSeconds("2026-08-21T12:05:00.000Z", new Date("2026-08-21T12:04:00.001Z"))).toBe(60);
expect(remainingSessionSeconds("2026-08-21T12:05:00.000Z", new Date("2026-08-21T12:05:00.000Z"))).toBe(0);
expect(formatSessionTime(300)).toBe("05:00");
expect(formatSessionTime(9)).toBe("00:09");
expect(normalizeSteeringTrim(-30)).toBe(-20);
expect(normalizeSteeringTrim(7.7)).toBe(8);
```

With injected fake scheduling, assert that expiry calls `onTick(0)` and
`onExpire()` once even when tick runs again.

For the save request, assert the real boundary contract:

```ts
expect(fetcher).toHaveBeenCalledWith(
  `/api/drive-sessions/${sessionId}/steering-trim`,
  expect.objectContaining({
    method: "PATCH",
    body: JSON.stringify({ steeringTrimPercent: 12 }),
  }),
);
```

- [ ] **Step 2: Run tests and verify RED**

Run: `pnpm.cmd --filter @rc/web test -- session-countdown.test.ts steering-trim.test.ts`

Expected: FAIL because both production modules are missing.

- [ ] **Step 3: Implement countdown from absolute server time**

Use `Math.ceil((expiryMs - now.getTime()) / 1000)` clamped at zero. The
controller schedules 250 ms ticks, computes from injected `now`, and guards
expiry with a private boolean.

- [ ] **Step 4: Implement trim normalization and persistence client**

Clamp rounded finite values to `-20..20`. Reject non-finite values. Treat a
non-2xx response or malformed response body as a save failure.

- [ ] **Step 5: Run focused tests GREEN**

Run: `pnpm.cmd --filter @rc/web test -- session-countdown.test.ts steering-trim.test.ts`

Expected: all new tests pass.

- [ ] **Step 6: Commit**

```powershell
git add -- apps/web/app/session-countdown.ts apps/web/app/session-countdown.test.ts apps/web/app/steering-trim.ts apps/web/app/steering-trim.test.ts
git commit -m "Add session countdown and trim client primitives"
```

### Task 5: Send v4 trim frames and expose created sessions to the ride UI

**Repository:** `RC`

**Files:**
- Modify: `apps/web/app/control-loop.ts`
- Modify: `apps/web/app/control-loop.test.ts`
- Modify: `apps/web/app/ride-connection-attempt.ts`
- Modify: `apps/web/app/ride-connection-attempt.test.ts`

**Interfaces:**
- `DriveCommand.v` becomes literal `4`.
- `DriveCommand.steeringTrimPercent` is required.
- `BrowserControlLoop.setSteeringTrim(percent: number): void` updates the next fast frame.
- `RideConnectionAttemptCallbacks.onSession(session: StoredDriveSession): void` fires after creation and before client connection.

- [ ] **Step 1: Write failing v4 and session-callback tests**

Update the control-loop expected frame:

```ts
loop.setSteeringTrim(-14);
expect(frame).toMatchObject({
  v: 4,
  steeringTrimPercent: -14,
  steering: -1,
  throttle: 1,
});
expect(reliableArm).toMatchObject({ v: 3, type: "arm" });
```

Add out-of-range normalization assertions for `setSteeringTrim(-21)` and
`setSteeringTrim(21)`.

In the connection-attempt harness, add `onSession: vi.fn()` and assert after
`start()`:

```ts
expect(callbacks.onSession).toHaveBeenCalledWith(session);
expect(client.connect).toHaveBeenCalledTimes(1);
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `pnpm.cmd --filter @rc/web test -- control-loop.test.ts ride-connection-attempt.test.ts`

Expected: FAIL because v4 trim and `onSession` are absent.

- [ ] **Step 3: Implement bounded trim in `BrowserControlLoop`**

Store a private `#steeringTrimPercent = 0`, expose `setSteeringTrim`, and include
the value in every fast frame. Do not add trim to reliable messages.

- [ ] **Step 4: Surface the exact created session**

Invoke `callbacks.onSession(session)` only while the attempt is active,
immediately after `createSession` resolves and before client/loop creation.

- [ ] **Step 5: Run focused tests and typecheck GREEN**

Run: `pnpm.cmd --filter @rc/web test -- control-loop.test.ts ride-connection-attempt.test.ts`

Run: `pnpm.cmd --filter @rc/web typecheck`

Expected: both exit `0`.

- [ ] **Step 6: Commit**

```powershell
git add -- apps/web/app/control-loop.ts apps/web/app/control-loop.test.ts apps/web/app/ride-connection-attempt.ts apps/web/app/ride-connection-attempt.test.ts
git commit -m "Send steering trim in v4 control frames"
```

### Task 6: Add the timer and steering-neutral strip to the real ride

**Repository:** `RC`

**Files:**
- Modify: `apps/web/app/real-ride-screen.tsx`
- Create: `apps/web/app/real-ride-screen.render.test.tsx`
- Modify: `apps/web/app/styles.css`

**Interfaces:**
- Consumes: `StoredDriveSession.expiresAt`, `StoredDriveSession.steeringTrimPercent`.
- Consumes: `SessionCountdown`, `saveSteeringTrim`, `BrowserControlLoop.setSteeringTrim`.

- [ ] **Step 1: Write the failing render test**

Mock `next/navigation`, connection dependencies, and render the component's
presentational trim/timer exports. Assert:

```ts
expect(markup).toContain("SESSION");
expect(markup).toContain("05:00");
expect(markup).toContain("STEERING NEUTRAL");
expect(markup).toContain("LEFT -20%");
expect(markup).toContain("RIGHT +20%");
expect(markup).toContain('min="-20"');
expect(markup).toContain('max="20"');
expect(markup).toContain('step="1"');
expect(markup).toContain("RESET");
```

- [ ] **Step 2: Run the render test and verify RED**

Run: `pnpm.cmd --filter @rc/web test -- real-ride-screen.render.test.tsx`

Expected: FAIL because timer and trim controls are not rendered.

- [ ] **Step 3: Wire session state and one-shot expiry**

On `onSession`, store the session, initialize trim, call
`loop.setSteeringTrim` as soon as the loop exists, and start the countdown.
The expiry callback must execute only once:

```ts
pressedRef.current = new Set();
loopRef.current?.disarm("session expired");
attemptRef.current?.close("session expired");
router.replace("/pricing");
```

Cleanup stops the countdown before tearing down the connection attempt.

- [ ] **Step 4: Wire live trim and debounced persistence**

Slider input immediately updates React state and the current control loop.
Schedule one save 300 ms after the last change; pointer/key interaction end
flushes the current value. Use an incrementing request generation so a slow old
response cannot overwrite a newer status. Reset applies and saves `0`.

- [ ] **Step 5: Add focused RC Mania styling**

Add fixed overlay classes with no surrounding dark frame:

```css
.real-session-timer {
  position: absolute;
  top: 34px;
  right: 34px;
  min-width: 150px;
  text-align: right;
}
.real-steering-trim {
  position: absolute;
  left: 50%;
  bottom: 34px;
  translate: -50% 0;
  width: min(680px, 44vw);
}
```

Give the slider a visible center tick, cyan active track/thumb, `SAVED` lime,
`SAVING` cyan, and `NOT SAVED` red. Keep keyboard panel left and End Session
right at the same bottom baseline.

- [ ] **Step 6: Run render, focused, and complete web tests GREEN**

Run: `pnpm.cmd --filter @rc/web test -- real-ride-screen.render.test.tsx session-countdown.test.ts steering-trim.test.ts control-loop.test.ts ride-connection-attempt.test.ts`

Run: `pnpm.cmd --filter @rc/web test`

Run: `pnpm.cmd --filter @rc/web typecheck`

Expected: all tests pass and typecheck exits `0`.

- [ ] **Step 7: Run local browser QA**

Start the mock web app with production-shaped auth environment values. Open the
real ride in demo/test presentation at 1920x1080 and verify:

- timer is top-right and does not overlap telemetry;
- trim strip is bottom-center and does not overlap keyboard or End Session;
- slider keyboard arrows and Reset work;
- value/status text remains legible at `-20`, `0`, and `+20`;
- no console errors or hydration warnings.

Save a screenshot under the current Codex visualization directory.

- [ ] **Step 8: Commit**

```powershell
git add -- apps/web/app/real-ride-screen.tsx apps/web/app/real-ride-screen.render.test.tsx apps/web/app/styles.css
git commit -m "Add steering trim and ride countdown UI"
```

### Task 7: Accept v3/v4 and apply safe trim on Raspberry Pi

**Repository:** `tether-rally-mjx`

**Files:**
- Modify: `pi-agent/rc_pi_agent/control.py`
- Modify: `pi-agent/rc_pi_agent/runtime.py`
- Modify: `pi-agent/rc_pi_agent/webrtc.py`
- Modify: `pi-agent/tests/test_control.py`
- Modify: `pi-agent/tests/test_runtime.py`
- Modify: `pi-agent/tests/test_webrtc.py`

**Interfaces:**
- `NormalizedCommand.steering_trim_percent: int = 0`.
- `DirectPwmRuntime.submit(..., steering_trim_percent: int = 0)`.
- `Runtime.submit(..., steering_trim_percent: int = 0)`.
- v3 fast frames map to trim `0`; v4 requires `steeringTrimPercent`.

- [ ] **Step 1: Write failing PWM mapping tests**

Add symmetric and asymmetric cases:

```py
@pytest.mark.parametrize(
    ("trim", "want"),
    [(-20, 1400), (-7, 1465), (0, 1500), (12, 1560), (20, 1600)],
)
def test_trim_moves_only_armed_neutral(trim: int, want: int) -> None:
    machine = PwmStateMachine(PwmConfig.from_env({}))
    neutral = machine.step(NormalizedCommand(True, 0, 0, 1.0, steering_trim_percent=trim), 1.0)
    left = machine.step(NormalizedCommand(True, -1, 0, 1.0, steering_trim_percent=trim), 1.0)
    right = machine.step(NormalizedCommand(True, 1, 0, 1.0, steering_trim_percent=trim), 1.0)
    assert neutral.steering_us == want
    assert left.steering_us == 1000
    assert right.steering_us == 2000
```

Add a `PwmConfig` fixture with left/center/right `1100/1475/2050` and hand-check
`-20 => 1400`, `+20 => 1590`.

Assert stale and disarmed commands with trim still produce configured center.

- [ ] **Step 2: Write failing v3/v4 parser tests**

```py
assert control.handle_fast(v3_frame) is True
assert runtime.submissions[-1].steering_trim_percent == 0

assert control.handle_fast({
    **v4_frame,
    "v": 4,
    "steeringTrimPercent": -13,
}) is True
assert runtime.submissions[-1].steering_trim_percent == -13
```

Reject v4 missing trim, v4 trim `-21`, `21`, `True`, `1.5`, and v3 containing
the extra trim field. Each rejection must append `malformed-command` and add no
runtime submission.

- [ ] **Step 3: Run focused Pi tests and verify RED**

Run from `tether-rally-mjx`:

`python -m pytest -q pi-agent/tests/test_control.py pi-agent/tests/test_runtime.py pi-agent/tests/test_webrtc.py`

Expected: FAIL because command/runtime/parser do not support trim or v4.

- [ ] **Step 4: Implement side-aware neutral mapping**

Validate the dataclass field with plain-int semantics and `-20..20`. Add:

```py
def _trimmed_center_us(self, trim: int) -> int:
    center = self._config.steering_center_us
    if trim < 0:
        span = center - self._config.steering_left_us
    else:
        span = self._config.steering_right_us - center
    return max(
        self._config.steering_left_us,
        min(self._config.steering_right_us, center + round(span * trim / 100)),
    )
```

Use it only in the armed `steering == 0` branch. Keep `_neutral()` untrimmed.

- [ ] **Step 5: Propagate trim through runtime and strict parser**

Pass the value into `NormalizedCommand`. Define separate exact field sets for
v3 and v4; v3 supplies zero and v4 requires a plain bounded integer. Reliable
messages continue requiring v3.

- [ ] **Step 6: Run Pi tests and compile GREEN**

Run: `python -m pytest -q pi-agent`

Run: `python -m compileall -q pi-agent/rc_pi_agent`

Expected: both exit `0`.

- [ ] **Step 7: Commit**

```powershell
git add -- pi-agent/rc_pi_agent/control.py pi-agent/rc_pi_agent/runtime.py pi-agent/rc_pi_agent/webrtc.py pi-agent/tests/test_control.py pi-agent/tests/test_runtime.py pi-agent/tests/test_webrtc.py
git commit -m "Apply per-car steering trim on Pi"
```

### Task 8: Keep the local direct-PWM bench behavior aligned

**Repository:** `RC`

**Files:**
- Modify: `tests/hardware/pi-direct-pwm/rc_bench/live_control.py`
- Modify: `tests/hardware/pi-direct-pwm/rc_bench/live_server.py`
- Modify: `tests/hardware/pi-direct-pwm/web/live.html`
- Modify: `tests/hardware/pi-direct-pwm/tests/test_live_control.py`
- Modify: `tests/hardware/pi-direct-pwm/tests/test_live_server.py`

**Interfaces:**
- `InputFrame.steering_trim_percent: int = 0`.
- Local HTTP control payload accepts `steering_trim_percent` in `-20..20`.

- [ ] **Step 1: Write failing local bench tests**

Assert the same `-20/0/+20` pulse values as the product agent, full endpoints
unchanged, and disarmed/stale center untrimmed. Add HTTP `202` for a bounded
trim and `400` for `-21`, `21`, boolean, float, or unknown property.

- [ ] **Step 2: Run focused bench tests and verify RED**

Run: `python -m pytest -q tests/hardware/pi-direct-pwm/tests/test_live_control.py tests/hardware/pi-direct-pwm/tests/test_live_server.py`

Expected: FAIL because bench input has no trim.

- [ ] **Step 3: Implement the shared semantics in the bench**

Add the integer field, side-aware center helper, strict request validation, and
a `-20..20` slider in `live.html`. Send `steering_trim_percent` with each local
control request. Do not alter endpoint or fail-safe behavior.

- [ ] **Step 4: Run complete bench suite GREEN**

Run: `python -m pytest -q tests/hardware/pi-direct-pwm/tests`

Run: `python -m compileall -q tests/hardware/pi-direct-pwm/rc_bench`

Expected: both exit `0`.

- [ ] **Step 5: Commit**

```powershell
git add -- tests/hardware/pi-direct-pwm/rc_bench/live_control.py tests/hardware/pi-direct-pwm/rc_bench/live_server.py tests/hardware/pi-direct-pwm/web/live.html tests/hardware/pi-direct-pwm/tests/test_live_control.py tests/hardware/pi-direct-pwm/tests/test_live_server.py
git commit -m "Align bench steering trim behavior"
```

### Task 9: Complete cross-repository verification and prepare coordinated rollout

**Repositories:** `RC`, `tether-rally-mjx`

**Files:**
- Modify only if verification finds a directly related defect.

**Interfaces:**
- Verifies every requirement from the approved spec; creates no new behavior.

- [ ] **Step 1: Run the complete RC verification**

From `RC`:

```powershell
pnpm.cmd test
pnpm.cmd typecheck
$env:DATABASE_URL='postgresql://rcmania:test-password@localhost:5432/rcmania'
$env:AUTH_SECRET='0123456789012345678901234567890123456789'
$env:AUTH_URL='https://rcmania.live'
$env:GOOGLE_OAUTH_CLIENT_ID='test.apps.googleusercontent.com'
$env:GOOGLE_OAUTH_CLIENT_SECRET='test-secret'
pnpm.cmd --filter @rc/web build
git diff --check
```

Expected: all commands exit `0` with no failed tests.

- [ ] **Step 2: Run the complete Pi verification**

From `tether-rally-mjx`:

```powershell
python -m pytest -q pi-agent
python -m compileall -q pi-agent/rc_pi_agent
git diff --check
```

Expected: all commands exit `0`.

- [ ] **Step 3: Review protocol mutations explicitly**

Confirm automated tests fail if any of these realistic bugs are introduced:

- browser emits v3 while expecting trim;
- v4 omits trim;
- Pi accepts `21`;
- Pi applies trim to a full left/right endpoint;
- fail-safe neutral applies browser trim;
- timer starts from component mount rather than `expiresAt`;
- expiry pushes instead of replacing Pricing;
- a foreign or expired user session persists trim.

- [ ] **Step 4: Verify clean scoped Git states**

In `RC`, confirm only the two pre-existing untracked plan files and
`loading_page_imgs/` remain unrelated. In `tether-rally-mjx`, confirm no
uncommitted files remain after feature commits.

- [ ] **Step 5: Check Raspberry Pi reachability without changing it**

Attempt SSH and, if reachable, record:

```text
systemctl is-active rc-pi-agent.service
systemctl show rc-pi-agent.service --property=ExecStart
readlink -f /opt/rc-pi-agent
```

If local SSH remains unavailable while the production gateway reports a fresh
heartbeat, report outbound availability separately from inbound SSH
reachability. Do not treat one as proof of the other.

- [ ] **Step 6: Produce the rollout handoff**

Report:

- exact RC and Pi commit SHAs;
- test counts, typecheck/build status, and screenshot path;
- migration name and rollback behavior;
- required publication order: database migration, compatible Pi, then v4 web;
- explicit physical-test prerequisite: traction battery disconnected or wheels
  safely suspended;
- no production publication performed without a later explicit instruction.
