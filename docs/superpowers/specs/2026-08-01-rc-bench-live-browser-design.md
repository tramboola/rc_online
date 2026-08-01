# RC Bench Level 2: Live Browser Control Design

## Purpose

Add a second, clearly named bench-test level for controlling the suspended RC
car from a computer keyboard in a local browser. Existing `rc-bench-test`
commands remain Level 1 one-shot tests. The new `rc-bench-live` command is
Level 2 interactive control and never starts automatically after boot.

## User flow

1. Start `rc-bench-live` on the Raspberry Pi.
2. Open the tokenized local URL on the controlling computer.
3. The page opens `DISARMED` and sends neutral only.
4. Click **Arm keyboard**.
5. Hold `W/S` or arrow up/down for throttle and `A/D` or arrow left/right for
   steering. Releasing a key returns that axis to neutral.
6. `Space`, `Escape`, window blur, hidden tab, lost heartbeat, client loss, or
   server shutdown immediately requests neutral and disarms.

## Architecture

- Python 3.11+ standard library HTTP server; no new runtime dependencies.
- A browser page served from the Raspberry Pi posts normalized axes rather
  than arbitrary PWM values.
- A single thread-safe mailbox accepts one client, monotonically increasing
  sequence numbers, and heartbeats.
- A 50 Hz control loop maps normalized axes to the existing GPIO18 steering
  and GPIO19 ESC outputs.
- A 200 ms server-side watchdog returns both channels to 1500 microseconds.
- Reverse uses the confirmed bench sequence: brake for 0.3 seconds, neutral
  for 0.5 seconds, then reverse while the key remains held.
- A random token is required for API calls. The service is local-only in
  intent and is started as a transient systemd service, not a boot service.

## Limits

- Steering: 1000 / 1500 / 2000 microseconds.
- Throttle: 1250 reverse, 1500 neutral, 1750 forward.
- Browser heartbeat: every 50 ms.
- Watchdog: 200 ms.
- One active client; a stale client can be replaced after one second.
- Every exit path closes `lgpio`, which sends neutral and disables PWM.

## UI

The compact dark control screen is visually related to RC Racing but remains
a diagnostic tool. It shows `LEVEL 2 / LIVE BENCH`, armed state, connection,
heartbeat age, steering, throttle, reverse phase, keyboard mapping, and a
prominent emergency stop. It uses code-native HTML/CSS/JavaScript and no
external assets or fonts.

## Verification

- Unit tests cover watchdog neutral, key release, conflicting axes, full
  steering, forward throttle, reverse phase ordering, ownership, and stale
  sequence rejection.
- HTTP integration tests cover token rejection, initial disarmed state, and a
  valid command round trip without GPIO.
- Browser QA uses Level 2 in `--dry-run` mode to verify page identity, console
  health, arming, keyboard state, blur/disarm, and desktop/mobile layout.
- Raspberry deployment runs tests and dry-run before any live service starts.

