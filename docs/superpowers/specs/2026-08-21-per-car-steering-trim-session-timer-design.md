# Per-Car Steering Trim and Five-Minute Session Timer Design

**Date:** 2026-08-21
**Status:** Approved for implementation

## Goal

Add a fast steering-neutral adjustment to the real driving screen and make the
existing five-minute drive-session limit visible and deterministic for the
driver.

The steering setting belongs to the physical car. The most recently saved
value is loaded for every later session using that car, regardless of which
user or browser starts the session. The database is the source of truth;
Raspberry Pi applies the value received for the active session and does not
maintain a competing persistent copy.

## Steering Trim Semantics

Each car has an integer `steering_trim_percent` in the inclusive range
`-20..20`, defaulting to `0`.

- Negative values move the neutral steering position toward the configured
  left endpoint.
- Positive values move the neutral steering position toward the configured
  right endpoint.
- `0` uses the configured hardware center.
- The setting changes only the neutral output produced for `steering: 0`.
- Full left and full right commands continue to use their existing calibrated
  endpoints. Trim cannot expand either endpoint or command the servo outside
  the configured range.
- Disarmed, stale, malformed, disconnected, startup, and shutdown states use
  the untrimmed hardware center. This keeps fail-safe neutral independent of a
  browser preference.

For asymmetric hardware calibration, conversion is side-aware:

```text
trim > 0: center + (right - center) * trim / 100
trim < 0: center + (center - left) * trim / 100
```

The result is rounded to the nearest whole microsecond and clamped to the
configured left/right endpoints. With a 1000/1500/2000 microsecond calibration,
`-20%` maps to 1400 microseconds and `+20%` maps to 1600 microseconds.

## Persistence and Authorization

PostgreSQL adds a backward-compatible non-null car column:

```text
cars.steering_trim_percent integer not null default 0
check (steering_trim_percent between -20 and 20)
```

Drive-session creation reads and returns the car's current trim in the same
transaction that reserves the car. The browser therefore starts from a
server-supplied value and never guesses from stale local storage.

The web application exposes a same-origin endpoint scoped to the active drive
session. A write is accepted only when:

- the caller is authenticated;
- the drive session belongs to that caller;
- the session targets the same car;
- the session is in an active pre-expiry state;
- the requested value is an integer in `-20..20`.

The endpoint updates the car row and returns the persisted value. It is not an
administrator-wide car-edit endpoint, so it remains usable when normal users
are later allowed to drive.

The slider updates the live WebRTC command immediately. Database writes are
debounced and the final value is flushed when the interaction finishes. A save
failure does not interrupt the current drive: the current session continues to
use the selected value, while the interface marks the value as unsaved and
offers a retry. The next session still begins with the last successfully saved
database value.

Concurrent sessions for the same car are already prohibited. Therefore a
last-write conflict between two active drivers cannot occur.

## Driving Interface

The real ride screen adds a wide bottom-center control strip without changing
the existing keyboard panel or end-session action.

The strip contains:

- heading `STEERING NEUTRAL`;
- a horizontal range from `LEFT -20%` through a visible zero mark to
  `RIGHT +20%`;
- integer steps of one percent;
- a prominent live value such as `-7%`, `0%`, or `+12%`;
- a `RESET` action that returns the value to `0%`;
- compact persistence feedback: `SAVED`, `SAVING`, or `NOT SAVED`.

The range input is keyboard accessible and has an explicit accessible label.
Its visual state uses existing RC Mania colors and does not introduce an
animation or component dependency.

The top-right corner adds a compact `SESSION` timer containing only `MM:SS` as
the primary value. It remains visually separate from connection telemetry.
The timer appears when the real ride is ready and uses the server-provided
expiry timestamp, so connection time is honestly included in the five-minute
reservation.

## Five-Minute Session Lifecycle

The existing drive-session store already creates `expires_at` exactly five
minutes after server-side session creation. That database value remains the
single time authority.

The browser does not decrement an independent five-minute counter. On each UI
tick it calculates:

```text
remaining = max(0, expiresAt - current wall-clock time)
```

This avoids timer drift when a tab is briefly throttled. Display rounds up to
the next whole second while time remains, then shows `00:00` at expiry.

At expiry the browser performs the following idempotent sequence once:

1. clear held keyboard input;
2. disarm and send reliable neutral;
3. close the WebRTC and gateway session with reason `session expired`;
4. replace the current route with `/pricing` so Back does not reopen a dead
   ride screen.

The gateway remains authoritative and continues expiring sessions even if the
browser is suspended or disconnected. Raspberry Pi's command watchdog remains
the final software path to neutral when browser commands stop.

## WebRTC Control Protocol

The fast control frame advances from version 3 to version 4 and adds one
required field:

```text
v, type, sessionId, sequence, steering, throttle, nitro, armed,
steeringTrimPercent
```

`steeringTrimPercent` is an integer in `-20..20`. Browser control frames carry
the current trim at the existing approximately 50 Hz rate. No separate
reliable trim command is required, so packet loss cannot leave a stale setting
for more than one subsequent control frame.

For safe rolling deployment, the updated Pi agent accepts both versions:

- v3 uses `steeringTrimPercent = 0`;
- v4 requires and validates `steeringTrimPercent`;
- unknown versions, extra fields, non-integers, and out-of-range values fail
  closed and neutralize control.

The website switches to v4 only after the compatible Pi agent has been
installed. Rolling the website back to v3 remains compatible with the updated
Pi.

## Raspberry Pi Runtime

The canonical Pi implementation remains in the `tether-rally-mjx` repository.
Its WebRTC parser passes validated trim through `ControlSession`,
`DirectPwmRuntime`, and `NormalizedCommand` into `PwmStateMachine`.

The runtime applies trim only while all of the following are true:

- the current session is armed;
- the latest command is fresh and valid;
- `steering` equals `0`.

Left/right endpoints, throttle, reverse, Nitro, watchdog, replay protection,
session binding, and single GPIO ownership remain unchanged.

The local direct-PWM bench model is updated to use the same trim calculation so
software-only and suspended-wheel verification exercise the production rule.

## Failure Handling and Safety

- Invalid database values are prevented by both request validation and a
  database constraint.
- Invalid wire values neutralize and disarm the Pi session.
- Failed persistence is visible but does not create a sudden steering change
  during the current drive.
- Loss of the browser, gateway, DataChannel, or fresh commands neutralizes via
  the existing reliable close paths and 200 millisecond Pi watchdog.
- Browser expiry handling is idempotent and cannot send repeated end actions or
  repeated route transitions.
- Server expiry remains effective if browser timers are throttled.
- No timer or trim code changes ESC output limits.

There is still no independent microcontroller fail-safe. Deployment and
physical verification require disconnected traction power or safely suspended
driven wheels until explicit live-motion approval.

## Testing

Implementation follows test-first development.

### Database and web server

- migration applies the default and rejects values outside `-20..20`;
- a session returns the selected car's persisted trim and a five-minute
  `expiresAt`;
- only the active session owner can persist trim for its car;
- expired, ended, foreign, malformed, and unauthenticated writes are rejected;
- successful writes update only the assigned car.

### Browser

- remaining-time formatting covers full time, sub-minute time, and zero;
- the timer derives from `expiresAt`, not from mount time;
- expiry disarms and closes once, then replaces the route with `/pricing`;
- slider bounds, step, Reset, immediate live update, debounced save, and failed
  save feedback behave as specified;
- the real ride render includes the top-right timer and bottom-center trim bar;
- existing keyboard controls and camera readiness gating remain functional.

### Protocol and Raspberry Pi

- browser emits bounded v4 frames containing the current trim;
- Pi accepts v3 with zero trim and v4 with a valid trim;
- malformed, extra-field, wrong-session, replayed, or out-of-range frames fail
  neutral;
- `-20`, `0`, and `+20` map correctly with symmetric and asymmetric calibration;
- trim affects only armed neutral steering;
- full steering endpoints, throttle, reverse, Nitro, watchdog, disarm, and
  shutdown remain unchanged.

### Verification gates

- focused red/green tests in both repositories;
- complete web, gateway, database, and Pi software test suites;
- TypeScript typecheck and production web build;
- Python compile check;
- browser inspection at the supported desktop ride size;
- Pi service compatibility and dry-run checks;
- with explicit physical-test approval: suspended-wheel neutral trim at
  `-20%`, `0%`, and `+20%`, expiry neutralization, and reboot persistence.

## Rollout and Rollback

Deployment is coordinated and preserves the previous working revisions:

1. back up PostgreSQL and record current web, gateway, and Pi revisions;
2. apply the backward-compatible database migration;
3. install the Pi agent that accepts both v3 and v4 while traction power is
   disconnected or the wheels are safely suspended;
4. verify the Pi reconnects, remains available, and still accepts v3;
5. deploy the v4 website and any required gateway/database package changes;
6. verify the timer, persistence, direct WebRTC/TURN fallback, watchdog, and
   neutral output;
7. restore overlayroot only after persistent installation checks pass.

Rollback restores the previous website while leaving the additive database
column in place. The compatible Pi agent may remain because it still accepts
v3; if its runtime must also be rolled back, restore the recorded package and
restart only `rc-pi-agent.service`.

No VPS, database, or Raspberry Pi publication is included in implementation
approval. Production deployment requires a separate explicit instruction.
