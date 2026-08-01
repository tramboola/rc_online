# RC Bench Level 2 Browser Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and launch a local browser keyboard controller for the suspended RC car as a separate Level 2 bench-test mode.

**Architecture:** A dependency-free Python HTTP server accepts tokenized normalized keyboard frames into a single-client mailbox. A 50 Hz control state machine maps frames to the existing `lgpio` pulse output with a 200 ms watchdog and ESC reverse sequence; a static same-origin browser UI sends keydown/keyup heartbeats.

**Tech Stack:** Python 3 standard library, `lgpio`, HTML/CSS/JavaScript, `unittest`, Browser/IAB.

## Global Constraints

- Preserve `rc-bench-test` as Level 1 one-shot tests.
- Add `rc-bench-live` as Level 2; no boot-time autostart.
- Start disarmed and neutral.
- Keep steering at 1000/1500/2000 microseconds and throttle at 1250/1500/1750 microseconds.
- Neutralize after 200 ms without a valid heartbeat.
- Use one active tokenized client and no external Python or browser dependencies.
- Never run real GPIO during automated or browser QA.

---

### Task 1: Live control state machine

**Files:**
- Create: `tests/hardware/pi-direct-pwm/tests/test_live_control.py`
- Create: `tests/hardware/pi-direct-pwm/rc_bench/live_control.py`

**Interfaces:**
- Produces: `InputFrame`, `LiveConfig`, `LiveControl.step(frame, now) -> OutputState`.
- Consumers pass normalized axes `-1`, `0`, or `1`; hardware-specific pulses remain private to the controller.

- [ ] Write failing tests for disarmed neutral, full steering, forward, conflicting axes, stale heartbeat, key release, and the literal reverse transition sequence.
- [ ] Run `python -m unittest tests.test_live_control -v` and verify import/behavior failures.
- [ ] Implement immutable frame/config/output types and the minimal deterministic state machine.
- [ ] Run the focused tests and the full `unittest` suite.

### Task 2: Single-client command mailbox and HTTP API

**Files:**
- Create: `tests/hardware/pi-direct-pwm/tests/test_live_server.py`
- Create: `tests/hardware/pi-direct-pwm/rc_bench/live_server.py`

**Interfaces:**
- Produces: `CommandMailbox.publish(payload, now)`, `snapshot(now)`, and `serve(...)`.
- HTTP: `GET /`, `GET /api/state`, `POST /api/control`; API requires `X-Bench-Token`.

- [ ] Write failing tests for token rejection, malformed axes, stale sequence rejection, one-client ownership, timeout takeover, and valid round trip.
- [ ] Run the focused tests and verify the expected failures.
- [ ] Implement bounded JSON parsing, mailbox locking, HTTP responses, and the 50 Hz output loop with shutdown neutral.
- [ ] Run focused and full tests.

### Task 3: Browser keyboard UI

**Files:**
- Create: `tests/hardware/pi-direct-pwm/web/live.html`
- Create: `tests/hardware/pi-direct-pwm/bin/rc-bench-live`
- Modify: `tests/hardware/pi-direct-pwm/install.sh`

**Interfaces:**
- Browser posts `{client_id, sequence, armed, steering, throttle}` every 50 ms and immediately on key changes.
- Launcher imports `rc_bench.live_server.main` from `/opt/rc-bench-control`.

- [ ] Implement the compact Level 2 screen, explicit arm button, status telemetry, keyboard state, and emergency disarm paths.
- [ ] Add the launcher and install the HTML to `/opt/rc-bench-control/web/live.html`.
- [ ] Run Python compilation, unit tests, and `rc-bench-live --dry-run --help`.

### Task 4: Documentation and browser QA

**Files:**
- Modify: `tests/hardware/pi-direct-pwm/README.md`

**Interfaces:**
- Documents Level 1 versus Level 2, start/stop commands, URL format, key map, and residual ESC/servo risks.

- [ ] Start the local server in `--dry-run` mode.
- [ ] Use Browser/IAB to verify page identity, nonblank render, console health, arm interaction, keyboard state, blur/disarm, and responsive layout.
- [ ] Capture a screenshot outside the repository and inspect it visually.
- [ ] Update documentation and run `git diff --check` plus the full test suite.

### Task 5: Raspberry deployment and launch

**Files:**
- Deploy: `tests/hardware/pi-direct-pwm/**` to `/opt/rc-bench-control` and `/usr/local/bin`.

**Interfaces:**
- Starts as transient `rc-bench-live.service`; does not survive reboot by design.

- [ ] Disable overlay, reboot, upload, install, and run the full test suite on Raspberry Pi.
- [ ] Run `rc-bench-live` in dry-run mode and verify the HTTP state endpoint.
- [ ] Restore overlay, reboot, and verify persistence.
- [ ] Start the live service disarmed with a random token, open its URL, and verify the page is ready without issuing motion commands.

