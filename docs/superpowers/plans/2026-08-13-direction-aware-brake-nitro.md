# RC Bench Direction-Aware Brake and Nitro Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `Space` brake against the last commanded drive direction and replace the throttle slider with forward-only `N` Nitro: 63% normal drive, 100% forward Nitro, and fixed 63% reverse.

**Architecture:** Replace the browser-selected percentage in `InputFrame` with a validated `nitro` boolean, while keeping all percentage-to-PWM mapping and direction tracking in `LiveControl` on Raspberry Pi. The control state machine remembers only completed forward/reverse drive commands, never brake endpoints, and chooses the opposite verified endpoint for manual braking. The browser becomes a normalized key-state client with a display-only Nitro indicator.

**Tech Stack:** Python 3 standard library, `unittest`, dependency-free HTML/CSS/JavaScript, `lgpio` on Raspberry Pi.

## Global Constraints

- Normal forward is exactly 63% of the verified 1500-to-1750 microsecond deviation: 1658 microseconds.
- Forward with `N` is exactly 100% of the verified deviation: 1750 microseconds.
- Reverse drive is always exactly 63% of the verified 1500-to-1250 microsecond deviation: 1342 microseconds; `N` never changes it.
- `N` without an unopposed `W` / up-arrow request has no PWM effect and does not activate the indicator.
- `Space` overrides drive and Nitro while preserving steering and arming.
- Manual brake after forward is 1250 microseconds; manual brake after reverse is 1750 microseconds; unknown direction produces neutral.
- Remembered drive direction persists through armed neutral, but resets on disarm and watchdog expiry.
- Reverse from an unknown or forward last drive direction remains full 1250 microsecond brake for 60 ms, neutral for 60 ms, then 1342 microsecond reverse drive.
- Completed reverse followed by ordinary armed neutral and another `S` request resumes 1342 microseconds immediately, without a handshake or 1250 microsecond output.
- Releasing reverse-origin `Space` while `S` remains held outputs neutral for exactly `reverse_neutral_s` (60 ms by default), then resumes 1342 microseconds without outputting 1250 microseconds.
- Brake and reverse-handshake endpoints do not update remembered drive direction.
- `W+S` remains neutral; `Esc`, Stop, blur, hidden/closed tab, stale heartbeat, and shutdown retain neutral-and-disarm behaviour.
- The 200 ms watchdog, single-client ownership, token checks, 50 Hz output loop, GPIO pins, and 1250-1750 microsecond safety cap must not change.
- No new runtime dependency is allowed.
- Automated verification must use fake output or `--dry-run`; real GPIO testing remains a suspended-wheel operator step after deployment.

---

## File Structure

- `tests/hardware/pi-direct-pwm/rc_bench/live_control.py`: validates `nitro`, owns fixed drive scaling, remembers drive direction, and selects direction-aware manual brake output.
- `tests/hardware/pi-direct-pwm/rc_bench/live_server.py`: validates and propagates the optional `nitro` API field while removing the browser percentage contract.
- `tests/hardware/pi-direct-pwm/web/live.html`: maps `KeyN`, sends eligible Nitro state, replaces the slider with a display-only indicator, and updates telemetry/help.
- `tests/hardware/pi-direct-pwm/tests/test_live_control.py`: verifies exact PWM values, Nitro eligibility, brake priority, direction memory, and reverse phase classification.
- `tests/hardware/pi-direct-pwm/tests/test_live_server.py`: verifies browser markup, mailbox/API compatibility and validation, and changed runtime pulses.
- `tests/hardware/pi-direct-pwm/README.md`: documents the final keyboard controls, exact power levels, direction-aware brake, and retained reverse timings.

### Task 1: Fixed Drive Power, Nitro, and Direction-Aware Brake

**Files:**
- Modify: `tests/hardware/pi-direct-pwm/rc_bench/live_control.py:7-148`
- Test: `tests/hardware/pi-direct-pwm/tests/test_live_control.py:8-185`

**Interfaces:**
- Consumes: normalized `armed`, `steering`, `throttle`, `brake`, `nitro`, `received_at`, and monotonic `now`.
- Produces: `InputFrame(armed: bool, steering: int, throttle: int, received_at: float, brake: bool = False, nitro: bool = False)` and unchanged `OutputState` fields.
- Produces: `LiveControl._last_drive_direction: int | None`, where `1` is forward, `-1` is reverse, and `None` means no safe direction assumption.

- [ ] **Step 1: Replace percentage tests with failing fixed-power and Nitro tests**

Change the test helper to carry `nitro` and remove `throttle_limit_percent`:

```python
def frame(
    self,
    now: float,
    *,
    armed: bool = True,
    steering: int = 0,
    throttle: int = 0,
    brake: bool = False,
    nitro: bool = False,
) -> InputFrame:
    return InputFrame(
        armed=armed,
        steering=steering,
        throttle=throttle,
        received_at=now,
        brake=brake,
        nitro=nitro,
    )
```

Replace the forward endpoint assertion and slider tests with exact fixed-power coverage:

```python
def test_normal_forward_and_nitro_use_fixed_safe_pulses(self) -> None:
    normal = self.control.step(self.frame(2.0, throttle=1), now=2.0)
    nitro = self.control.step(
        self.frame(2.1, throttle=1, nitro=True),
        now=2.1,
    )

    self.assertEqual(normal.throttle_us, 1658)
    self.assertEqual(nitro.throttle_us, 1750)

def test_nitro_without_forward_has_no_effect(self) -> None:
    neutral = self.control.step(self.frame(2.0, nitro=True), now=2.0)
    reverse_brake = self.control.step(
        self.frame(2.1, throttle=-1, nitro=True),
        now=2.1,
    )
    self.control.step(self.frame(2.161, throttle=-1, nitro=True), now=2.161)
    reverse_drive = self.control.step(
        self.frame(2.222, throttle=-1, nitro=True),
        now=2.222,
    )

    self.assertEqual(neutral.throttle_us, 1500)
    self.assertEqual((reverse_brake.throttle_us, reverse_brake.reverse_phase), (1250, "brake"))
    self.assertEqual((reverse_drive.throttle_us, reverse_drive.reverse_phase), (1342, "reverse"))

def test_nitro_must_be_boolean(self) -> None:
    for value in (0, 1, "true", None):
        with self.subTest(value=value):
            with self.assertRaisesRegex(ValueError, "nitro"):
                self.frame(2.0, nitro=value)
```

In the existing steering/forward and watchdog tests, use the new normal-drive
expectations:

```python
self.assertEqual((forward.steering_us, forward.throttle_us), (1500, 1658))
self.assertEqual(active.throttle_us, 1658)
```

In the existing 60/60 millisecond reverse test, retain 1250 for both automatic
brake assertions and change only the final drive assertion:

```python
self.assertEqual((reverse.throttle_us, reverse.reverse_phase), (1342, "reverse"))
```

- [ ] **Step 2: Add failing direction-memory and brake-priority tests**

Replace the old context-free manual-brake tests with:

```python
def test_manual_brake_opposes_last_forward_and_preserves_steering(self) -> None:
    self.control.step(self.frame(3.0, throttle=1), now=3.0)
    braking = self.control.step(
        self.frame(3.01, steering=-1, throttle=1, brake=True, nitro=True),
        now=3.01,
    )

    self.assertEqual((braking.steering_us, braking.throttle_us), (1000, 1250))
    self.assertTrue(braking.armed)
    self.assertEqual(braking.reverse_phase, "idle")

def test_manual_brake_opposes_completed_reverse_drive(self) -> None:
    self.control.step(self.frame(4.0, throttle=-1), now=4.0)
    self.control.step(self.frame(4.061, throttle=-1), now=4.061)
    reverse = self.control.step(self.frame(4.122, throttle=-1), now=4.122)
    braking = self.control.step(
        self.frame(4.13, throttle=-1, brake=True, nitro=True),
        now=4.13,
    )

    self.assertEqual((reverse.throttle_us, reverse.reverse_phase), (1342, "reverse"))
    self.assertEqual((braking.throttle_us, braking.reverse_phase), (1750, "idle"))

def test_manual_brake_is_neutral_when_direction_is_unknown(self) -> None:
    braking = self.control.step(self.frame(5.0, brake=True), now=5.0)

    self.assertEqual(braking.throttle_us, 1500)

def test_direction_persists_through_armed_neutral(self) -> None:
    self.control.step(self.frame(5.0, throttle=-1), now=5.0)
    self.control.step(self.frame(5.061, throttle=-1), now=5.061)
    self.control.step(self.frame(5.122, throttle=-1), now=5.122)
    self.control.step(self.frame(5.13, throttle=0), now=5.13)
    braking = self.control.step(self.frame(5.14, brake=True), now=5.14)

    self.assertEqual(braking.throttle_us, 1750)

def test_disarm_and_watchdog_clear_remembered_direction(self) -> None:
    self.control.step(self.frame(6.0, throttle=1), now=6.0)
    self.control.step(self.frame(6.01, armed=False), now=6.01)
    after_disarm = self.control.step(self.frame(6.02, brake=True), now=6.02)

    self.control.step(self.frame(7.0, throttle=1), now=7.0)
    self.control.step(self.frame(7.0, throttle=1), now=7.201)
    after_watchdog = self.control.step(self.frame(7.21, brake=True), now=7.21)

    self.assertEqual(after_disarm.throttle_us, 1500)
    self.assertEqual(after_watchdog.throttle_us, 1500)

def test_reverse_brake_phase_does_not_record_reverse_direction(self) -> None:
    automatic_brake = self.control.step(self.frame(8.0, throttle=-1), now=8.0)
    manual_brake = self.control.step(
        self.frame(8.01, throttle=-1, brake=True),
        now=8.01,
    )

    self.assertEqual((automatic_brake.throttle_us, automatic_brake.reverse_phase), (1250, "brake"))
    self.assertEqual(manual_brake.throttle_us, 1500)

def test_releasing_brake_resumes_held_forward_with_current_nitro_state(self) -> None:
    self.control.step(self.frame(9.0, throttle=1), now=9.0)
    self.control.step(
        self.frame(9.01, throttle=1, brake=True, nitro=True),
        now=9.01,
    )
    resumed = self.control.step(
        self.frame(9.02, throttle=1, nitro=True),
        now=9.02,
    )

    self.assertEqual(resumed.throttle_us, 1750)
```

- [ ] **Step 3: Run the control tests and verify RED**

Run from `tests/hardware/pi-direct-pwm`:

```powershell
python -m unittest tests.test_live_control -v
```

Expected: failures because `InputFrame` still requires `throttle_limit_percent`, has no `nitro`, normal drive still defaults to the full endpoints, and manual brake always returns 1250.

- [ ] **Step 4: Implement fixed scaling, Nitro validation, and direction tracking**

Replace the percentage field with `nitro` and validate both booleans strictly:

```python
NORMAL_DRIVE_PERCENT = 63


@dataclass(frozen=True, slots=True)
class InputFrame:
    armed: bool
    steering: int
    throttle: int
    received_at: float
    brake: bool = False
    nitro: bool = False

    def __post_init__(self) -> None:
        if self.steering not in (-1, 0, 1):
            raise ValueError("steering must be -1, 0, or 1")
        if self.throttle not in (-1, 0, 1):
            raise ValueError("throttle must be -1, 0, or 1")
        if not math.isfinite(self.received_at):
            raise ValueError("received_at must be finite")
        if not isinstance(self.brake, bool):
            raise ValueError("brake must be boolean")
        if not isinstance(self.nitro, bool):
            raise ValueError("nitro must be boolean")
```

Initialize remembered direction and clear it only on stale/disarmed input:

```python
def __init__(self, config: LiveConfig | None = None) -> None:
    self._config = config or LiveConfig()
    self._reverse_phase = "idle"
    self._reverse_phase_started = 0.0
    self._reverse_reentry_needs_neutral = False
    self._last_drive_direction: int | None = None

def _reset_motion(self) -> None:
    self._reset_reverse()
    self._reverse_reentry_needs_neutral = False
    self._last_drive_direction = None
```

In both stale and disarmed branches call `_reset_motion()` before returning neutral. Pass `frame.nitro` into `_throttle()` and implement this priority/state logic:

```python
def _throttle(
    self,
    throttle: int,
    brake: bool,
    nitro: bool,
    now: float,
) -> int:
    forward_us = self._scaled_throttle_us(
        self._config.throttle_forward_us,
        NORMAL_DRIVE_PERCENT,
    )
    reverse_us = self._scaled_throttle_us(
        self._config.throttle_reverse_us,
        NORMAL_DRIVE_PERCENT,
    )
    if brake:
        self._reset_reverse()
        self._reverse_reentry_needs_neutral = self._last_drive_direction == -1
        if self._last_drive_direction == 1:
            return self._config.throttle_reverse_us
        if self._last_drive_direction == -1:
            return self._config.throttle_forward_us
        return self._config.throttle_neutral_us
    if throttle == 1:
        self._reset_reverse()
        self._reverse_reentry_needs_neutral = False
        self._last_drive_direction = 1
        return self._config.throttle_forward_us if nitro else forward_us
    if throttle == 0:
        self._reset_reverse()
        self._reverse_reentry_needs_neutral = False
        return self._config.throttle_neutral_us

    if self._reverse_phase == "idle":
        if self._last_drive_direction == -1:
            if self._reverse_reentry_needs_neutral:
                self._reverse_phase = "neutral"
                self._reverse_phase_started = now
                self._reverse_reentry_needs_neutral = False
                return self._config.throttle_neutral_us
            self._reverse_phase = "reverse"
            self._reverse_phase_started = now
            return reverse_us
        self._reverse_reentry_needs_neutral = False
        self._reverse_phase = "brake"
        self._reverse_phase_started = now
        return self._config.throttle_reverse_us

    elapsed = now - self._reverse_phase_started
    if self._reverse_phase == "brake":
        if elapsed < self._config.reverse_brake_s:
            return self._config.throttle_reverse_us
        self._reverse_phase = "neutral"
        self._reverse_phase_started = now
        return self._config.throttle_neutral_us

    if self._reverse_phase == "neutral":
        if elapsed < self._config.reverse_neutral_s:
            return self._config.throttle_neutral_us
        self._reverse_phase = "reverse"
        self._reverse_phase_started = now

    self._last_drive_direction = -1
    return reverse_us
```

Do not set `_last_drive_direction` in manual brake, automatic brake, automatic neutral, or ordinary neutral branches.

- [ ] **Step 5: Run focused and complete control tests and verify GREEN**

Run:

```powershell
python -m unittest tests.test_live_control -v
```

Expected: all control tests pass with exact 1658, 1750, 1500, 1342, and direction-dependent brake pulses.

- [ ] **Step 6: Commit the control state machine**

```powershell
git add tests/hardware/pi-direct-pwm/rc_bench/live_control.py tests/hardware/pi-direct-pwm/tests/test_live_control.py
git commit -m "Add direction-aware brake and Nitro control"
```

### Task 2: Replace the Percentage API with a Safe Nitro Flag

**Files:**
- Modify: `tests/hardware/pi-direct-pwm/rc_bench/live_server.py:34-165`
- Test: `tests/hardware/pi-direct-pwm/tests/test_live_server.py:89-180`
- Test: `tests/hardware/pi-direct-pwm/tests/test_live_server.py:334-467`

**Interfaces:**
- Consumes: `InputFrame(..., brake: bool = False, nitro: bool = False)` from Task 1.
- Produces: `CommandMailbox.publish(client_id, sequence, armed, steering, throttle, brake=False, nitro=False, *, now) -> InputFrame`.
- Produces: optional `/api/control` JSON field `nitro: boolean`, defaulting to `false`; legacy unknown `throttle_limit_percent` is ignored.

- [ ] **Step 1: Replace mailbox percentage tests with failing Nitro tests**

Replace `test_preserves_throttle_limit_in_published_frame` and invalid-limit coverage with:

```python
def test_preserves_nitro_in_published_frame(self) -> None:
    mailbox = CommandMailbox()

    frame = mailbox.publish(
        "browser-a",
        1,
        True,
        0,
        1,
        nitro=True,
        now=12.0,
    )

    self.assertTrue(frame.nitro)

def test_invalid_nitro_does_not_replace_last_valid_frame(self) -> None:
    mailbox = CommandMailbox()
    mailbox.publish("browser-a", 1, True, 0, 0, nitro=True, now=12.0)

    with self.assertRaisesRegex(ValueError, "nitro"):
        mailbox.publish("browser-a", 2, True, 0, 1, nitro=1, now=12.1)

    self.assertTrue(mailbox.snapshot().nitro)
```

- [ ] **Step 2: Replace HTTP percentage tests with failing Nitro and compatibility tests**

Update the valid-frame payload to include `"nitro": True` and assert `frame.nitro`. Replace the missing/invalid limit tests with:

```python
def test_missing_nitro_defaults_to_false_and_legacy_limit_is_ignored(self) -> None:
    status, _response = self.request(
        "/api/control",
        method="POST",
        payload={
            "client_id": "browser-a",
            "sequence": 1,
            "armed": True,
            "steering": 0,
            "throttle": 1,
            "throttle_limit_percent": 100,
        },
    )

    self.assertEqual(status, 202)
    self.assertFalse(self.mailbox.snapshot().nitro)

def test_non_boolean_nitro_is_rejected_without_replacing_frame(self) -> None:
    self.request(
        "/api/control",
        method="POST",
        payload={
            "client_id": "browser-a",
            "sequence": 1,
            "armed": True,
            "steering": 0,
            "throttle": 1,
            "nitro": True,
        },
    )
    status, error = self.request(
        "/api/control",
        method="POST",
        payload={
            "client_id": "browser-a",
            "sequence": 2,
            "armed": True,
            "steering": 0,
            "throttle": 1,
            "nitro": 1,
        },
    )

    self.assertEqual(status, 400)
    self.assertEqual(error["error"], "invalid_request")
    self.assertTrue(self.mailbox.snapshot().nitro)
```

Update `LiveRuntimeTests.test_applies_command_then_watchdog_returns_to_neutral` to expect `(1000, 1658)` for normal forward.

- [ ] **Step 3: Run mailbox, HTTP, and runtime tests and verify RED**

Run from `tests/hardware/pi-direct-pwm`:

```powershell
python -m unittest tests.test_live_server.CommandMailboxTests tests.test_live_server.LiveHttpTests tests.test_live_server.LiveRuntimeTests -v
```

Expected: signature/attribute failures because the mailbox and HTTP handler still propagate `throttle_limit_percent` and do not carry `nitro`.

- [ ] **Step 4: Implement Nitro propagation and remove the percentage contract**

Change the mailbox signature and frame construction:

```python
def publish(
    self,
    client_id: str,
    sequence: int,
    armed: bool,
    steering: int,
    throttle: int,
    brake: bool = False,
    nitro: bool = False,
    *,
    now: float,
) -> InputFrame:
    # Existing client, sequence, armed, steering, and throttle validation stays.
    frame = InputFrame(
        armed=armed,
        steering=steering,
        throttle=throttle,
        received_at=now,
        brake=brake,
        nitro=nitro,
    )
```

Change the HTTP publication call to:

```python
mailbox.publish(
    payload["client_id"],
    payload["sequence"],
    payload["armed"],
    payload["steering"],
    payload["throttle"],
    brake=payload.get("brake", False),
    nitro=payload.get("nitro", False),
    now=clock(),
)
```

Do not read `payload["throttle_limit_percent"]`. The existing JSON object parser intentionally ignores unknown keys, making a cached slider page safe: without `nitro`, normal forward is fixed at 63%.

- [ ] **Step 5: Run API and control regressions and verify GREEN**

Run:

```powershell
python -m unittest tests.test_live_control tests.test_live_server.CommandMailboxTests tests.test_live_server.LiveHttpTests tests.test_live_server.LiveRuntimeTests -v
```

Expected: all selected tests pass; missing Nitro is false, invalid Nitro is rejected before mailbox mutation, and runtime normal forward is 1658 microseconds.

- [ ] **Step 6: Commit the API contract**

```powershell
git add tests/hardware/pi-direct-pwm/rc_bench/live_server.py tests/hardware/pi-direct-pwm/tests/test_live_server.py
git commit -m "Replace throttle limit API with Nitro flag"
```

### Task 3: Replace the Slider with the Forward-Only Nitro Indicator

**Files:**
- Modify: `tests/hardware/pi-direct-pwm/web/live.html:244-317`
- Modify: `tests/hardware/pi-direct-pwm/web/live.html:432-658`
- Test: `tests/hardware/pi-direct-pwm/tests/test_live_server.py:20-87`

**Interfaces:**
- Consumes: optional `/api/control` field `nitro: boolean` from Task 2.
- Produces: normalized `KeyN` state; `axes() -> {steering: number, throttle: number, brake: boolean, nitro: boolean}`; display-only `#nitro-indicator[data-active]`.

- [ ] **Step 1: Replace slider page tests with failing Nitro indicator tests**

Replace all throttle-slider presentation tests with:

```python
def test_page_replaces_slider_with_nitro_indicator(self) -> None:
    self.assertNotIn('id="throttle-limit"', self.page)
    self.assertNotIn("throttle_limit_percent", self.page)
    self.assertIn('id="nitro-indicator"', self.page)
    self.assertIn('data-key="NITRO"', self.page)
    self.assertIn("NITRO", self.page)

def test_page_sends_forward_only_nitro_state(self) -> None:
    self.assertIn('["KeyN", "NITRO"]', self.page)
    self.assertIn(
        'const nitro = forward && !reverse && !brake && pressed.has("NITRO")',
        self.page,
    )
    self.assertIn("nitro: armed && current.nitro", self.page)
    self.assertIn(
        "nitroIndicator.dataset.active = String(armed && current.nitro)",
        self.page,
    )

def test_visible_help_describes_fixed_power_nitro_and_brake(self) -> None:
    self.assertIn("63% forward", self.page)
    self.assertIn("N</strong> Nitro 100% with forward only", self.page)
    self.assertIn("reverse at 63%", self.page)
    self.assertIn("Space</strong> brake while held", self.page)
    self.assertIn("Esc</strong> emergency stop", self.page)
```

Keep the existing Space/Escape assertions. In the brake-key-state test, retain
the `pressed.has("BRAKE")`, returned `brake`, and request-payload assertions,
then replace the old single-line telemetry assertion with:

```python
self.assertIn('current.brake\n    ? "BRAKE"', self.page)
```

- [ ] **Step 2: Run the page contract tests and verify RED**

Run from `tests/hardware/pi-direct-pwm`:

```powershell
python -m unittest tests.test_live_server.LivePageTests -v
```

Expected: failures because the page still contains the slider, has no `KeyN` mapping, and sends `throttle_limit_percent`.

- [ ] **Step 3: Implement the display-only Nitro panel**

Replace `.throttle-limit-*` rules with a non-interactive indicator. Preserve the existing visual language and reduced-motion rule:

```css
.nitro-indicator {
  display: grid;
  grid-template-columns: 58px 1fr;
  align-items: center;
  gap: 14px;
  margin: 0 0 22px;
  padding: 14px;
  border: 1px solid var(--line);
  background: rgba(5, 9, 13, .5);
  color: var(--muted);
  transition: border-color 100ms ease, color 100ms ease, box-shadow 100ms ease;
}

.nitro-key {
  display: grid;
  place-items: center;
  height: 48px;
  border: 1px solid #344a56;
  background: #0b151b;
  color: #b8c6cd;
  font: 900 20px/1 ui-monospace, SFMono-Regular, Consolas, monospace;
  box-shadow: inset 0 -4px 0 rgba(0, 0, 0, .35);
}

.nitro-label strong { display: block; color: var(--text); letter-spacing: .12em; }
.nitro-label span { display: block; margin-top: 6px; font-size: 10px; line-height: 1.4; }
.nitro-indicator[data-active="true"] {
  border-color: var(--lime);
  color: var(--lime);
  box-shadow: 0 0 28px rgba(199, 255, 62, .12);
}
.nitro-indicator[data-active="true"] .nitro-key {
  border-color: var(--lime);
  background: rgba(199, 255, 62, .12);
  color: var(--lime);
}
```

Replace the slider markup with:

```html
<div class="nitro-indicator" id="nitro-indicator" data-active="false" aria-live="polite">
  <div class="nitro-key" data-key="NITRO" data-active="false">N</div>
  <div class="nitro-label">
    <strong>NITRO</strong>
    <span>Hold N with forward for 100% · otherwise 63%</span>
  </div>
</div>
```

This element has no button semantics and no click handler; it is an indicator, not a mouse control.

- [ ] **Step 4: Implement forward-only key eligibility and request payload**

Add `KeyN`, compute Nitro only for unopposed forward without brake, and return it from `axes()`:

```javascript
const keyMap = new Map([
  ["KeyW", "W"], ["ArrowUp", "W"],
  ["KeyA", "A"], ["ArrowLeft", "A"],
  ["KeyS", "S"], ["ArrowDown", "S"],
  ["KeyD", "D"], ["ArrowRight", "D"],
  ["Space", "BRAKE"],
  ["KeyN", "NITRO"],
]);

function axes() {
  const left = pressed.has("A");
  const right = pressed.has("D");
  const forward = pressed.has("W");
  const reverse = pressed.has("S");
  const brake = pressed.has("BRAKE");
  const nitro = forward && !reverse && !brake && pressed.has("NITRO");
  return {
    steering: left === right ? 0 : left ? -1 : 1,
    throttle: forward === reverse ? 0 : forward ? 1 : -1,
    brake,
    nitro,
  };
}
```

Query `#nitro-indicator`, delete slider queries and `updateThrottleLimitUi()`, and add this to `updateLocalUi()`:

```javascript
nitroIndicator.dataset.active = String(armed && current.nitro);
```

Use these telemetry labels:

```javascript
throttleState.textContent = !armed
  ? "NEUTRAL"
  : current.brake
    ? "BRAKE"
    : current.throttle === 0
      ? "NEUTRAL"
      : current.throttle > 0
        ? current.nitro ? "NITRO 100%" : "FORWARD 63%"
        : "REVERSE 63%";
```

Replace the slider field in normal control frames with:

```javascript
nitro: armed && current.nitro,
```

Replace the slider field in the unload frame with `nitro: false`. Delete the slider `input` listener and initial `updateThrottleLimitUi()` call. Keep request coalescing, 50 ms heartbeat, Escape, blur, visibility, and unload behaviour unchanged.

Update the warning and hint to include the exact searchable phrases from Step 1 and explain that `N` is inactive without forward and during reverse.

- [ ] **Step 5: Run browser, HTTP, and control regressions and verify GREEN**

Run:

```powershell
python -m unittest tests.test_live_server.LivePageTests tests.test_live_server.LiveHttpTests tests.test_live_control -v
```

Expected: all selected tests pass; the page contains no slider contract, sends only eligible Nitro, and keeps Space/Escape safety behaviour.

- [ ] **Step 6: Commit the browser control and indicator**

```powershell
git add tests/hardware/pi-direct-pwm/web/live.html tests/hardware/pi-direct-pwm/tests/test_live_server.py
git commit -m "Replace throttle slider with Nitro indicator"
```

### Task 4: Operator Documentation and Full No-GPIO Verification

**Files:**
- Modify: `tests/hardware/pi-direct-pwm/README.md:79-108`
- Verify: `tests/hardware/pi-direct-pwm/rc_bench/*.py`
- Verify: `tests/hardware/pi-direct-pwm/tests/*.py`
- Verify: `tests/hardware/pi-direct-pwm/web/live.html`

**Interfaces:**
- Consumes: completed control, API, and browser behaviour from Tasks 1-3.
- Produces: operator instructions and a locally verified implementation ready for Raspberry Pi deployment after the Pi is powered on.

- [ ] **Step 1: Update the Level 2 operator instructions**

Replace slider documentation with these exact behaviours:

```markdown
- `W` / up arrow: forward at 63%;
- hold `N` together with `W` / up arrow: forward Nitro at 100%; `N` alone,
  during reverse, or while braking has no effect;
- `S` / down arrow: from unknown or forward direction, 60 ms fixed brake and
  60 ms neutral before reverse at 63%; after completed reverse and ordinary
  neutral, another `S` resumes reverse immediately;
- `Space`: direction-aware brake while held; after forward it sends the reverse
  brake endpoint, after reverse it sends the forward brake endpoint, and
  steering stays active; releasing a reverse-origin brake while `S` remains
  held sends 60 ms neutral before resuming reverse, never 1250 microseconds;
- `A` / left arrow and `D` / right arrow: full steering, including while braking;
- `Escape` or Stop: neutral and disarm.
```

State that 63% means 1658 microseconds forward and 1342 microseconds reverse relative to the verified 1250-1750 stand cap; Nitro is 1750 microseconds forward. Retain the 60 ms defaults, 20-1000 ms CLI bounds, tuning example, suspended-wheel warning, and statement that this is not the production safety controller.

- [ ] **Step 2: Run source and formatting checks**

Run from the repository root:

```powershell
git diff --check
python -m compileall -q tests/hardware/pi-direct-pwm/rc_bench tests/hardware/pi-direct-pwm/tests
```

Expected: both commands exit zero with no diagnostics.

- [ ] **Step 3: Run the complete bench test suite**

Run from `tests/hardware/pi-direct-pwm`:

```powershell
python -m unittest discover -s tests -v
```

Expected: every test passes with no errors or failures.

- [ ] **Step 4: Run the server in no-GPIO mode and inspect startup/shutdown safety**

Run from `tests/hardware/pi-direct-pwm`:

```powershell
python -m rc_bench.live_server --dry-run --host 127.0.0.1 --port 8765 --public-host 127.0.0.1 --token nitro-check
```

Expected startup output includes `steering=1500us throttle=1500us` and the tokenized URL. Stop with `Ctrl+C`; expected shutdown output ends with neutral output followed by `PWM off`. No `/dev/gpiochip0` access occurs because `--dry-run` selects `ConsolePulseOutput`.

Pulse transitions themselves are verified deterministically by `LiveControlTests` and `LiveRuntimeTests`: normal forward 1658, Nitro forward 1750, reverse drive 1342, forward-origin brake 1250, reverse-origin brake 1750, and watchdog/disarm neutral 1500.

- [ ] **Step 5: Inspect the final diff and commit documentation**

```powershell
git diff --check
git diff --stat
git status --short
git add tests/hardware/pi-direct-pwm/README.md
git commit -m "Document direction-aware brake and Nitro controls"
```

Expected: only the six planned implementation/test/documentation files differ before the documentation commit, every task has its own focused commit, and no unrelated user changes are staged.

- [ ] **Step 6: Record deployment boundary**

Do not push, write persistent Raspberry Pi storage, reboot, or energize GPIO as part of local implementation. Report the exact commits and verification results. Deployment is a separate external step once Raspberry Pi is powered on and the user authorizes it.
