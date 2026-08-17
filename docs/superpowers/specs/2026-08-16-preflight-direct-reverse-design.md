# Simplified Preflight and Direct Reverse Design

**Date:** 2026-08-16
**Status:** Approved direction; awaiting written-spec review

## Goal

Make keyboard driving intentionally simple and transparent. The preflight page
only verifies that the browser sees the supported keyboard inputs. The browser
then sends direct steering and throttle intent, while Raspberry Pi maps reverse
immediately to the configured reverse PWM endpoint.

Remove the manual `Space` brake and the automatic
`brake -> neutral -> reverse` state machine from the browser, the RC Mania
control protocol, the Raspberry Pi product agent, and the local Raspberry Pi
bench.

## Approved Physical Behaviour

- `W` or `ArrowUp` requests normal forward drive.
- `S` or `ArrowDown` requests direct full reverse: normalized `throttle: -1`.
- Raspberry Pi maps direct reverse to the configured 1250 microsecond endpoint.
- Releasing `S` or `ArrowDown` requests neutral at exactly 1500 microseconds.
- The software does not remember direction and does not decide whether the ESC
  is braking or reversing.
- If the ESC requires the common double-action sequence, the first press may
  stop the car and the second press, after release to neutral, may engage
  reverse. That interpretation belongs entirely to the ESC.
- `W` retains the existing normal forward limit and `N` retains the existing
  forward-only Nitro behaviour.
- Opposing inputs on one axis remain neutral: `W` plus `S`, or left plus right,
  do not produce motion on that axis.

## Preflight Interface

### Remove completely

The preflight runtime and stylesheet will no longer contain:

- the five-item connection-check strip (`HTTPS SECURE`,
  `WEBSOCKET CONNECTED`, `WEBRTC CONNECTED`, `STUN / TURN REACHABLE`, and
  `VIDEO DECODE SUPPORTED`);
- the complete calibration card, its sliders, driving profiles, component
  state, event handlers, and dedicated styles;
- the `RETEST` button, simulated preflight request, testing state, and related
  fallback behaviour;
- the `Space` keycap, `BRAKE` binding, and all preflight copy describing Space
  as a driving control.

Git history is not rewritten. "No traces" means no rendered element, dormant
component branch, unused state, dead handler, dedicated style, or active test
for the removed calibration interface.

### Keyboard-first layout

- Keyboard is selected by default and is the only available controller.
- The controller card expands to the available content width after calibration
  is removed.
- Gamepad remains visible only as a disabled option labelled `COMING SOON`.
  It cannot be selected and does not render gamepad bindings or imagery.
- The keyboard diagram and binding list show both equivalent inputs:
  `W / Up`, `A / Left`, `S / Down`, and `D / Right` using arrow glyphs in the
  rendered interface.
- `N` remains Nitro and `Esc` remains the emergency end/neutral command.
- Space is neither displayed nor captured. Pressing Space keeps normal browser
  behaviour and never creates a driving command.

### Input feedback

The preflight page listens only while mounted and visually depresses the
logical keycap corresponding to a supported physical key:

- `KeyW` and `ArrowUp` animate the same forward keycap;
- `KeyA` and `ArrowLeft` animate the same left keycap;
- `KeyS` and `ArrowDown` animate the same reverse keycap;
- `KeyD` and `ArrowRight` animate the same right keycap;
- `KeyN` and `Escape` animate their own keycaps.

The pressed style uses the existing RC Mania palette and a short transform,
without introducing an animation dependency. Repeated keydown events do not
accumulate state. Window blur and document visibility loss clear all pressed
visual states. Arrow keys are prevented from scrolling only while preflight is
handling them. Preflight feedback is informational and sends no car commands.

`CONTINUE TO QUEUE` remains the sole action in the lower section and is not
blocked by a fake network or calibration result.

## Browser Controls

The shared keyboard mapper removes `BRAKE` from `DriveKey`, removes Space from
the physical-key map, and removes `brake` from computed control intent.

The real ride page uses the same aliases as preflight:

- `W` / `ArrowUp`: forward;
- `A` / `ArrowLeft`: left;
- `S` / `ArrowDown`: direct reverse;
- `D` / `ArrowRight`: right;
- `N`: Nitro while forward is held;
- `Escape`: immediate end/neutral.

The real ride overlay removes the Space keycap, `BRAKE` status, and brake help
copy. Losing focus, hiding the page, ending the session, closing the control
channel, or pressing Escape still clears held inputs and sends the reliable
neutral/end action.

## Control Protocol

Because removing a field is a breaking wire change, the fast DataChannel
message advances to version 3. Its driving payload is:

```text
v, type, sessionId, sequence, steering, throttle, nitro, armed
```

There is no `brake` field and no replacement phase field. Bounds remain:

- `steering`: `-1`, `0`, or `1`;
- `throttle`: `-1`, `0`, or `1`;
- `nitro`: boolean;
- `armed`: boolean;
- monotonically increasing non-negative sequence scoped to the drive session.

The browser control loop stores and transmits only steering, throttle, Nitro,
and armed state. Its neutral operation resets all three motion inputs and sends
the existing reliable neutral message.

The generic platform actuator/safety model may continue to use a numeric
braking channel where it is unrelated to RC Mania keyboard/WebRTC control. It
must not be wired back into this browser-to-Pi control path.

## Raspberry Pi Runtime

The canonical source of the installed production Pi agent must be restored to
this repository before it is modified. The current Git tree contains the local
bench but not the production `rc_pi_agent` package that is installed on the
device. The implementation will first copy the installed source into the
repository without changing the running Pi, review it, and add tests around the
actual production parser and PWM mapping.

Both the production agent and the local bench then use the same simple model:

- input frame has no `brake` field;
- configuration has no reverse brake/neutral timing values;
- output state has no reverse phase;
- runtime has no remembered direction or reverse state;
- `throttle: 1` maps to existing normal forward output, or full forward when
  Nitro is valid;
- `throttle: 0` maps to 1500 microseconds;
- `throttle: -1` maps directly to 1250 microseconds;
- stale, malformed, replayed, wrong-session, disarmed, or disconnected input
  maps to neutral and disarms where applicable.

Local bench HTTP requests and UI remove the brake property, Space mapping,
reverse phase telemetry, reverse timing command-line options, and all related
copy.

## Safety Boundary

This simplification does not remove fail-safe neutral behaviour:

- neutral on process start and shutdown;
- neutral until the active session is armed;
- the local 200 millisecond command watchdog;
- neutral on malformed or replayed control frames;
- neutral on browser/gateway/DataChannel loss;
- neutral on session end and `Escape`;
- single ownership of the GPIO runtime.

There is still no independent microcontroller fail-safe. Physical traction
power remains the final safety boundary during deployment and suspended-wheel
testing.

## Testing

Implementation follows test-first changes and covers:

### Web

- Space is unmapped and never appears in control intent or transmitted frames.
- WASD and arrow aliases produce identical logical controls.
- `S` / `ArrowDown` produces `throttle: -1` immediately.
- Nitro remains forward-only.
- preflight render has no connection strip, calibration, Retest, Space, or
  brake copy;
- gamepad is disabled and labelled Coming Soon;
- supported keydown/keyup events toggle the correct visual state and blur clears
  it;
- real ride contains no Space/brake control and still neutralizes on safety
  exits.

### Protocol and Raspberry Pi

- version 3 frames accept only the new field set and reject invalid bounds,
  stale sequences, and wrong sessions;
- reverse maps immediately to 1250 microseconds with no intermediate state;
- release maps immediately to 1500 microseconds;
- forward and Nitro outputs remain unchanged;
- watchdog, disarm, disconnect, shutdown, and malformed input remain neutral;
- local bench UI and HTTP tests confirm that `brake`, reverse timing, and
  reverse phase are absent.

### Verification gates

- complete JavaScript/TypeScript test suite;
- typecheck, lint, and production build;
- complete Raspberry Pi software-only test suite;
- local browser inspection of preflight at desktop and narrow widths, including
  live key animations and browser console health;
- repository search confirming no active Space/brake or reverse-state code
  remains in the RC Mania browser-to-Pi path.

## Rollout and Rollback

No VPS or Raspberry Pi publication is part of implementation approval. A later
explicit deployment approval is required.

Because protocol v3 is intentionally incompatible with the old Pi agent, final
deployment uses a short maintenance window rather than a permanent compatibility
shim:

1. keep traction power disconnected or all driven wheels safely suspended;
2. back up the installed Pi agent and record the current web/Pi revisions;
3. stop the active drive service so output returns to neutral;
4. update the Pi agent and website/gateway as one coordinated release;
5. verify v3 connection, video, watchdog, and neutral output before motion;
6. perform the explicitly approved suspended-wheel forward/reverse test;
7. restore overlayroot and verify a persistent reboot.

Rollback restores both the previous web/gateway revision and the backed-up Pi
agent together. Mixing protocol v2 and v3 is treated as unavailable and must
fail neutral.
