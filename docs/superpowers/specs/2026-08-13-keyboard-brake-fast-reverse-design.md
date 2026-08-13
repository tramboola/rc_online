# RC Bench Keyboard Brake and Fast Reverse Design

## Purpose

Separate manual braking from emergency disarm in the Level 2 browser control
and make the ESC reverse handshake substantially faster. `Space` becomes a
momentary brake that preserves steering and arming, while `S` / down arrow
continues to request reverse through a server-controlled brake-neutral-reverse
sequence.

This remains a suspended-wheel test stand. The change does not make the
Linux-based controller suitable for driving the car on the ground.

## Keyboard behaviour

- `W` / up arrow requests forward drive.
- `S` / down arrow requests automatic reverse.
- Holding `Space` requests manual brake. Brake has priority over both forward
  and reverse, but steering remains active.
- Releasing `Space` immediately exposes the keys that are still physically
  held. A held `W` / up arrow resumes forward on the next browser request and
  control-loop tick. A held `S` / down arrow starts the automatic reverse
  sequence. With neither throttle key held, output returns to neutral.
- `W` and `S` held together without `Space` request neutral, preserving the
  existing conflicting-axis behaviour.
- `Space` and `S` held together request manual brake. Releasing `Space` while
  `S` remains held starts a fresh automatic reverse sequence.
- `Esc`, the Stop button, browser blur, a hidden or closed tab, stale
  heartbeat, and server shutdown retain their existing neutral-and-disarm
  behaviour. Only `Space` stops disarming the controller.

The browser continues to send a heartbeat every 50 milliseconds while armed.
Key repeat does not restart either braking or reverse state.

## ESC output sequence

The Raspberry Pi remains authoritative for PWM timing and pulse limits.

- Neutral is 1500 microseconds.
- Manual `Space` braking uses the existing verified 1250 microsecond safe
  endpoint for as long as `Space` is held.
- An automatic `S` / down-arrow request starts with 1250 microseconds for 60
  milliseconds, sends neutral for 60 milliseconds, then sends the
  slider-limited reverse drive pulse while the key remains held.
- At the 50 Hz control rate, each 60 millisecond phase spans approximately
  three complete PWM periods. Timing is measured on Raspberry Pi with the
  monotonic clock and does not depend on browser timers.
- The manual and automatic brake phases do not use the throttle-limit slider.
  A brake command must remain far enough outside the ESC deadband to be
  recognised. The reverse drive phase still uses the same 10-100% limit as
  forward drive.
- Releasing `S`, pressing conflicting `W+S`, disarming, or losing the
  heartbeat immediately requests neutral and resets the reverse sequence.
- A manual brake interrupts and resets any automatic reverse sequence. If
  `S` is still held when the brake is released, the sequence starts again at
  its brake phase.

The initial timings are deliberately aggressive. If the ESC does not
recognise them, the operator can increase them through optional integer CLI
arguments `--reverse-brake-ms` and `--reverse-neutral-ms`. Both default to 60
milliseconds and accept a bounded 20-1000 millisecond range. The ordinary
launch command does not need to change while the defaults are suitable.

## Control frame and server behaviour

Every browser `/api/control` request gains a `brake` boolean. The browser
retains the physical forward and reverse key state while `Space` is held and
sends that state together with `brake=true`; the server gives `brake` higher
priority than throttle.

`CommandMailbox` and `InputFrame` validate and carry the field. A missing
field defaults to `false` so an older cached page remains compatible. A
non-boolean value receives the existing `invalid_request` response without
replacing the last valid frame.

`LiveControl` applies commands in this order:

1. Missing, stale, or disarmed input returns neutral and resets reverse.
2. Steering is calculated independently.
3. `brake=true` returns the fixed brake pulse and resets automatic reverse.
4. Forward and neutral retain their existing mapping.
5. Reverse advances through the configured brake, neutral, and drive phases.

`LiveRuntime` receives a validated `LiveConfig` built from the CLI timing
arguments. Existing ownership, watchdog, GPIO shutdown, and token controls do
not change.

## Browser presentation

The keyboard hint and warning text distinguish momentary brake from emergency
stop:

- `Space`: brake while held;
- `Esc`: neutral and disarm;
- `S` / down arrow: fast brake-neutral-reverse.

The local throttle state reads `BRAKE` while `Space` is held. The existing
server-side reverse phase telemetry continues to show the automatic sequence.
The throttle-limit note continues to describe forward and reverse drive; it
must not imply that braking is weakened by the slider.

## Verification

- Control tests cover fixed manual braking, steering during braking, forward
  resumption after brake release, brake priority, reverse-sequence reset, and
  exact 60/60 millisecond phase boundaries.
- Existing tests continue to cover watchdog neutralisation, disarm, throttle
  limiting, conflicting axes, and safe pulse endpoints.
- Mailbox and HTTP tests cover propagation, compatibility default, boolean
  validation, and preservation of the last valid frame after invalid input.
- Browser document tests verify that `Space` sends brake instead of calling
  disarm, `Space` keyup releases brake without losing held throttle keys,
  `Escape` still disarms, and the visible keyboard help matches behaviour.
- Parser/runtime tests verify the 60 millisecond defaults, accepted overrides,
  and rejection of values outside the bounded range.
- Run the complete local Python suite, then launch `rc-bench-live --dry-run`
  and inspect the emitted pulse sequence. Dry-run verification must not claim
  GPIO or energise the ESC.
- After deployment, perform the first real test with wheels suspended and a
  low reverse-drive limit. If the ESC does not enter reverse, increase one
  timing at a time, beginning with neutral, while keeping the verified pulse
  endpoints unchanged.
