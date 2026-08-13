# RC Bench Direction-Aware Brake and Nitro Design

## Purpose

Fix manual braking while the car is reversing and replace the adjustable
throttle-limit slider with a momentary keyboard Nitro control. Normal forward
and reverse drive use 63% of the existing verified PWM deviation. Holding
`N` together with forward throttle temporarily raises forward drive to 100%.

The Raspberry Pi remains authoritative for direction-aware braking, Nitro
eligibility, PWM timing, and pulse limits. This remains a suspended-wheel test
stand and does not make the Linux-based controller suitable for driving the
car on the ground.

## Keyboard behaviour

- `W` / up arrow requests forward drive at 63%.
- `W` / up arrow together with `N` requests forward drive at 100%.
- `N` without forward throttle has no effect on PWM output.
- `S` / down arrow requests automatic reverse at 63%. `N` never changes
  reverse power.
- `W` and `S` held together request neutral. `N` does not override this
  conflicting-axis behaviour.
- Holding `Space` requests manual brake and has priority over forward,
  reverse, and Nitro. Steering and arming remain active.
- Releasing `Space` immediately exposes the keys still held. Therefore held
  `W+N` resumes 100% forward, held `W` resumes 63% forward, and held `S`
  starts the automatic reverse sequence.
- `Esc`, Stop, browser blur, a hidden or closed tab, stale heartbeat, and
  server shutdown retain their neutral-and-disarm behaviour.

The browser continues to send normalized key state. It cannot choose a PWM
pulse or an arbitrary percentage.

## Fixed drive power and Nitro

Percentages scale the existing verified 250 microsecond deviation from the
1500 microsecond neutral pulse; they are not percentages of the full ESC
electrical range.

- Normal forward at 63% is 1658 microseconds.
- Nitro forward at 100% is 1750 microseconds.
- Reverse drive at 63% is 1342 microseconds.
- Neutral remains exactly 1500 microseconds.
- Automatic and manual brake pulses remain at the full verified endpoints and
  are not weakened by the 63% drive limit.

The 63% multiplication uses the existing nearest-integer rule with exact
half-microsecond results rounded away from neutral. Nitro applies only when
the validated frame is armed, requests forward, requests no brake, and has
`nitro=true`. In every other state the flag is ignored.

## Direction-aware manual brake

The current defect occurs because `Space` always returns 1250 microseconds.
That is a braking command after forward drive, but it is a stronger reverse
drive command while the car is already reversing.

`LiveControl` will track the direction of the last actual drive command it
issued, rather than infer motion from whichever key happens to be held when
`Space` arrives:

- after a forward drive command, `Space` returns 1250 microseconds;
- after a completed reverse drive command, `Space` returns 1750
  microseconds;
- with no known prior drive direction, `Space` returns neutral instead of
  guessing and potentially initiating motion.

The remembered direction persists through an ordinary armed neutral command,
allowing the operator to brake while the car is coasting after releasing the
throttle. It resets on disarm or watchdog expiry because the controller can no
longer make a safe assumption about physical motion when control resumes.

Brake endpoints and automatic reverse-handshake phases must not update the
remembered drive direction. In particular, the 1250 microsecond brake phase
that precedes reverse is still classified as braking; direction becomes
reverse only when the state machine reaches the 1342 microsecond reverse-drive
phase. A held manual brake keeps using the direction captured from the last
drive command and cannot turn itself into drive merely because its output is
an opposite-direction endpoint.

This is direction-aware based on the last command, not wheel-speed sensing.
The stand has no motion sensor, so the first real verification remains a
suspended-wheel test.

## Automatic reverse sequence

The existing `S` / down-arrow handshake is preserved:

1. full 1250 microsecond brake for 60 milliseconds;
2. neutral for 60 milliseconds;
3. 1342 microsecond reverse drive while reverse remains requested.

Pressing manual brake interrupts and resets this sequence. Releasing `Space`
while `S` remains held starts a fresh 60/60 millisecond reverse sequence.
The existing bounded CLI overrides for the two phase durations remain
available.

## Control frame and compatibility

The browser sends a `nitro` boolean in each `/api/control` frame. `InputFrame`
and `CommandMailbox` validate and carry it. A missing field defaults to
`false`, so an older or manually constructed client cannot accidentally
request full forward power. A non-boolean value receives the existing
`invalid_request` response without replacing the last valid frame.

`throttle_limit_percent` is removed from the browser, mailbox, and control
model. An older cached page may still include that unknown JSON field; the HTTP
endpoint ignores unknown fields, and the server applies the new fixed 63%
limit because `nitro` is absent. Thus an old slider can no longer raise or
lower drive power.

`LiveControl` applies commands in this order:

1. Missing, stale, or disarmed input returns neutral and clears remembered
   direction and the reverse sequence.
2. Steering is calculated independently.
3. Manual brake uses the opposite endpoint for the remembered direction and
   resets the automatic reverse sequence.
4. Conflicting or neutral throttle returns neutral while retaining remembered
   direction.
5. Forward returns 1658 microseconds, or 1750 only when Nitro is valid and
   active, and records forward direction.
6. Reverse advances through brake, neutral, and fixed 63% reverse drive,
   recording reverse direction only in the drive phase.

Ownership, watchdog timing, GPIO shutdown, token authorization, steering, and
request coalescing do not change.

## Browser presentation

The throttle slider, percentage output, explanatory note, slider styles, and
slider event handler are removed. Their place in the keyboard panel becomes a
visible `N / NITRO` indicator.

The indicator is active only when Nitro is actually eligible: the controller
is armed, forward is requested without a conflicting reverse key, `N` is
held, and `Space` is not held. It stays inactive for `N` alone, reverse,
neutral, conflicting throttle keys, braking, and disarmed state. The throttle
readout distinguishes normal forward from active Nitro, while reverse remains
labelled as 63% drive. Visible help explains the exact key combinations.

The indicator is display-only; mouse interaction cannot activate Nitro.

## Verification

- Control tests cover 63% forward and reverse pulses, 100% forward Nitro,
  ignored Nitro at neutral and in reverse, and brake priority over Nitro.
- Direction tests cover forward-to-brake, reverse-to-brake, unknown-direction
  neutral, direction persistence through armed neutral, and direction reset on
  disarm and watchdog expiry.
- Reverse tests prove that handshake brake and neutral phases do not falsely
  record reverse direction, and that the final reverse phase does.
- Mailbox and HTTP tests cover Nitro propagation, safe missing-field default,
  strict boolean validation, last-valid-frame preservation, and the removal of
  adjustable throttle limits.
- Browser document tests verify `KeyN` handling, absence of the slider,
  active-indicator eligibility, the `nitro` request field, and visible help.
- Existing tests continue to cover steering during braking, key conflict,
  60/60 millisecond reverse timing, watchdog neutralisation, disarm, client
  ownership, and safe endpoint bounds.
- Run the complete local Python suite and a deterministic `--dry-run` pulse
  sequence. Dry-run verification must not claim GPIO or energise the ESC.
- After deployment, test with wheels suspended: establish reverse at 63%,
  press and hold `Space`, and confirm wheel speed falls rather than rises.
  Release into neutral before testing any subsequent direction change. Then
  verify 63% forward, forward-only Nitro, and ignored `N` during reverse.
