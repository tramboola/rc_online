# Keyboard arcade controls

The real ride screen applies this model to keyboard input when the car negotiates
control protocol v5. Phone tilt/touch controls and legacy v3/v4 keyboard commands
are unchanged. No Raspberry Pi firmware or database migration is required.

## Reverse

- S / ArrowDown sends a full reverse command for the first 500 ms of an effective hold.
- At 500 ms the command steps down to 40% reverse until release.
- Release returns to neutral immediately, including during the initial 500 ms.
- A fresh effective reverse hold restarts the initial period. Key repeat and
  overlapping S / ArrowDown holds do not restart it.

These percentages describe the requested axis, not measured motor power or speed.
There is no automatic brake/neutral/reverse sequence or Space binding. The car's
speed controller still determines whether a reverse command brakes or reverses.

## Steering

On a new effective turn, capture how long forward gas has already been held and
whether Nitro is active (effective forward gas plus N):

`time_to_full_turn_ms = (nitro_at_turn_start ? 600 : 450) * clamp(forward_hold_ms / 1000, 0, 1)`

Steering then increases linearly from neutral to the requested direction over that
duration. The duration is fixed for that turn, not recalculated on each frame.

| Forward hold before turning | Normal gas: neutral to full | Nitro: neutral to full |
| --- | --- | --- |
| None | Immediate | Immediate |
| 0.1 s | 0.045 s | 0.06 s |
| 0.7 s | 0.315 s | 0.42 s |
| 1 s or more | 0.45 s | 0.6 s |

- Pressing or releasing N during a held turn changes acceleration on the next
  control tick, but does not change or restart the captured steering ramp. The
  next new/opposite turn uses the Nitro state at that moment.
- Releasing forward gas immediately makes a held turn full-strength. Pressing gas
  again while holding that same turn does not pull steering back toward neutral.
- Releasing the turn immediately returns steering to neutral.
- A new/opposite effective turn starts from neutral with a newly captured duration.
- Contradictory left/right or forward/reverse inputs produce a neutral axis.
- Normal forward throttle and Nitro acceleration outputs are unchanged. N without
  effective forward gas does not enable Nitro or introduce steering smoothing.

## Execution and safety

`KeyboardDriveModel` is sampled immediately before encoding each command by the
existing 50 Hz browser control loop. It uses `performance.now()` and does not
depend on OS key-repeat timing or React re-renders. There is no extra send timer.
Transitions are transmitted on the next control tick (nominally within 20 ms);
browser scheduling and network delivery can add delay.

Blur, hidden-page state, disarming, ride expiry, and connection cleanup clear the
keyboard model. Stale repeated keydown events do not restore a lost-focus hold.
Phone input explicitly takes ownership and clears the keyboard sampler.

Tests cover the pure model and real ride-screen-to-protocol integration with a
local channel sink; they do not move a physical car. Start physical testing at low
speed in a clear area: gas release intentionally causes an abrupt full-steering
command when a turn is held.

## Deployment

Deploy only the web image from the feature branch. Preserve the previous web image
and release directory for rollback. Do not restart the gateway, PostgreSQL, TURN,
or the Pi for this change. Drivers must reload the page before starting a new ride
to load the new browser code.
