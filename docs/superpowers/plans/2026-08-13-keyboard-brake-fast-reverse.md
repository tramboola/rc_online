# RC Bench Keyboard Brake and Fast Reverse Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `Space` a steering-compatible momentary brake and make `S` / down arrow enter reverse through a tunable 60 ms brake, 60 ms neutral handshake.

**Architecture:** Extend each normalized browser control frame with an explicit `brake` boolean and keep PWM authority in `LiveControl` on Raspberry Pi. Manual brake and the automatic handshake use the verified fixed 1250 microsecond endpoint; forward and reverse drive remain slider-limited. Existing watchdog, ownership, disarm, and GPIO shutdown paths remain unchanged.

**Tech Stack:** Python 3 standard library, `unittest`, dependency-free HTML/CSS/JavaScript, `lgpio` on Raspberry Pi.

## Global Constraints

- `Space` brakes without disarming; `Esc`, Stop, blur, hidden/closed tab, stale heartbeat, and server shutdown still neutralize and disarm.
- Steering remains active during manual brake.
- Manual brake overrides forward and reverse; releasing it immediately applies still-held throttle keys.
- Automatic reverse defaults to 60 ms brake, 60 ms neutral, then slider-limited reverse.
- Manual and automatic brake use the fixed verified 1250 microsecond endpoint; drive outputs remain within the existing 1250-1750 microsecond stand cap.
- `W+S` without `Space` remains neutral.
- The 200 ms watchdog, single-client ownership, token checks, and 50 Hz output loop must not change.
- No new runtime dependency is allowed.
- Real GPIO verification is not part of automated execution; use `--dry-run` until the operator performs the suspended-wheel test.

---

## File Structure

- `tests/hardware/pi-direct-pwm/rc_bench/live_control.py`: validated control frame, timing configuration, and deterministic brake/reverse state machine.
- `tests/hardware/pi-direct-pwm/rc_bench/live_server.py`: mailbox/API propagation, CLI timing arguments, and runtime configuration injection.
- `tests/hardware/pi-direct-pwm/web/live.html`: keyboard state, request payload, telemetry labels, and visible help.
- `tests/hardware/pi-direct-pwm/tests/test_live_control.py`: pulse-level and state-transition tests.
- `tests/hardware/pi-direct-pwm/tests/test_live_server.py`: page contract, mailbox/API validation, parser, and runtime tests.
- `tests/hardware/pi-direct-pwm/README.md`: operator-facing controls, timing flags, and safety semantics.

### Task 1: Manual Brake and Fast Reverse State Machine

**Files:**
- Modify: `tests/hardware/pi-direct-pwm/rc_bench/live_control.py:8-148`
- Test: `tests/hardware/pi-direct-pwm/tests/test_live_control.py:8-123`

**Interfaces:**
- Consumes: existing normalized `steering`, `throttle`, `throttle_limit_percent`, and monotonic `now` values.
- Produces: `InputFrame(..., brake: bool = False)` and `LiveConfig(reverse_brake_s=0.06, reverse_neutral_s=0.06)`; `LiveControl.step()` gives brake priority while preserving steering.

- [ ] **Step 1: Add failing manual-brake and timing tests**

Add `brake` to the test helper and add focused tests:

```python
def frame(
    self,
    now: float,
    *,
    armed: bool = True,
    steering: int = 0,
    throttle: int = 0,
    throttle_limit_percent: int = 100,
    brake: bool = False,
) -> InputFrame:
    return InputFrame(
        armed=armed,
        steering=steering,
        throttle=throttle,
        received_at=now,
        throttle_limit_percent=throttle_limit_percent,
        brake=brake,
    )

def test_manual_brake_is_fixed_and_preserves_steering(self) -> None:
    braking = self.control.step(
        self.frame(
            3.0,
            steering=-1,
            throttle=1,
            throttle_limit_percent=10,
            brake=True,
        ),
        now=3.0,
    )

    self.assertEqual((braking.steering_us, braking.throttle_us), (1000, 1250))
    self.assertTrue(braking.armed)
    self.assertEqual(braking.reverse_phase, "idle")

def test_releasing_manual_brake_immediately_resumes_held_forward(self) -> None:
    self.control.step(
        self.frame(3.0, throttle=1, throttle_limit_percent=10, brake=True),
        now=3.0,
    )
    resumed = self.control.step(
        self.frame(3.01, throttle=1, throttle_limit_percent=10),
        now=3.01,
    )

    self.assertEqual((resumed.throttle_us, resumed.reverse_phase), (1525, "idle"))

def test_reverse_uses_sixty_millisecond_brake_and_neutral_phases(self) -> None:
    brake = self.control.step(self.frame(4.0, throttle=-1), now=4.0)
    still_braking = self.control.step(self.frame(4.059, throttle=-1), now=4.059)
    neutral = self.control.step(self.frame(4.061, throttle=-1), now=4.061)
    still_neutral = self.control.step(self.frame(4.12, throttle=-1), now=4.12)
    reverse = self.control.step(self.frame(4.122, throttle=-1), now=4.122)

    self.assertEqual((brake.throttle_us, brake.reverse_phase), (1250, "brake"))
    self.assertEqual((still_braking.throttle_us, still_braking.reverse_phase), (1250, "brake"))
    self.assertEqual((neutral.throttle_us, neutral.reverse_phase), (1500, "neutral"))
    self.assertEqual((still_neutral.throttle_us, still_neutral.reverse_phase), (1500, "neutral"))
    self.assertEqual((reverse.throttle_us, reverse.reverse_phase), (1250, "reverse"))

def test_manual_brake_interrupts_and_resets_reverse_sequence(self) -> None:
    self.control.step(self.frame(5.0, throttle=-1), now=5.0)
    manual = self.control.step(
        self.frame(5.03, throttle=-1, brake=True),
        now=5.03,
    )
    restarted = self.control.step(self.frame(5.04, throttle=-1), now=5.04)

    self.assertEqual((manual.throttle_us, manual.reverse_phase), (1250, "idle"))
    self.assertEqual((restarted.throttle_us, restarted.reverse_phase), (1250, "brake"))
```

Update the existing throttle-limit test so the automatic brake is fixed but the eventual reverse drive remains scaled:

```python
reverse_brake = self.control.step(
    self.frame(6.1, throttle=-1, throttle_limit_percent=10), now=6.1
)
self.control.step(
    self.frame(6.161, throttle=-1, throttle_limit_percent=10), now=6.161
)
reverse_drive = self.control.step(
    self.frame(6.222, throttle=-1, throttle_limit_percent=10), now=6.222
)

self.assertEqual((reverse_brake.throttle_us, reverse_brake.reverse_phase), (1250, "brake"))
self.assertEqual((reverse_drive.throttle_us, reverse_drive.reverse_phase), (1475, "reverse"))
```

Add invalid brake values to validation coverage:

```python
def test_brake_must_be_boolean(self) -> None:
    for value in (0, 1, "true", None):
        with self.subTest(value=value):
            with self.assertRaisesRegex(ValueError, "brake"):
                self.frame(8.0, brake=value)
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run from `tests/hardware/pi-direct-pwm`:

```powershell
python -m unittest tests.test_live_control -v
```

Expected: failures because `InputFrame` has no `brake` field and the defaults remain 0.3/0.5 seconds.

- [ ] **Step 3: Implement the minimal control-layer change**

Extend the dataclasses:

```python
@dataclass(frozen=True, slots=True)
class InputFrame:
    armed: bool
    steering: int
    throttle: int
    received_at: float
    throttle_limit_percent: int = 100
    brake: bool = False

    def __post_init__(self) -> None:
        # existing validation remains
        if not isinstance(self.brake, bool):
            raise ValueError("brake must be boolean")

@dataclass(frozen=True, slots=True)
class LiveConfig:
    # existing pulse defaults remain
    watchdog_s: float = 0.2
    reverse_brake_s: float = 0.06
    reverse_neutral_s: float = 0.06
```

Pass `frame.brake` into `_throttle` and give it priority:

```python
throttle_us = self._throttle(
    frame.throttle,
    frame.brake,
    frame.throttle_limit_percent,
    now,
)

def _throttle(
    self,
    throttle: int,
    brake: bool,
    limit_percent: int,
    now: float,
) -> int:
    forward_us = self._scaled_throttle_us(
        self._config.throttle_forward_us,
        limit_percent,
    )
    reverse_us = self._scaled_throttle_us(
        self._config.throttle_reverse_us,
        limit_percent,
    )
    if brake:
        self._reset_reverse()
        return self._config.throttle_reverse_us
    if throttle == 1:
        self._reset_reverse()
        return forward_us
    if throttle == 0:
        self._reset_reverse()
        return self._config.throttle_neutral_us

    if self._reverse_phase == "idle":
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

    return reverse_us
```

- [ ] **Step 4: Run the focused suite and verify GREEN**

Run from `tests/hardware/pi-direct-pwm`:

```powershell
python -m unittest tests.test_live_control -v
```

Expected: all `LiveControlTests` pass, including the watchdog and release/reset regressions.

- [ ] **Step 5: Commit the control state machine**

```powershell
git add tests/hardware/pi-direct-pwm/rc_bench/live_control.py tests/hardware/pi-direct-pwm/tests/test_live_control.py
git commit -m "Add manual brake and fast reverse timing"
```

### Task 2: Carry Brake Through Mailbox and HTTP API

**Files:**
- Modify: `tests/hardware/pi-direct-pwm/rc_bench/live_server.py:34-185`
- Test: `tests/hardware/pi-direct-pwm/tests/test_live_server.py:61-318`

**Interfaces:**
- Consumes: `InputFrame(..., brake: bool = False)` from Task 1.
- Produces: `CommandMailbox.publish(..., throttle_limit_percent: int = 100, brake: bool = False, *, now: float)` and optional JSON field `brake` defaulting to `false`.

- [ ] **Step 1: Add failing mailbox and HTTP tests**

Add mailbox coverage:

```python
def test_preserves_manual_brake_in_published_frame(self) -> None:
    mailbox = CommandMailbox()

    frame = mailbox.publish(
        "browser-a",
        1,
        True,
        0,
        1,
        brake=True,
        now=12.0,
    )

    self.assertTrue(frame.brake)

def test_invalid_brake_does_not_replace_last_valid_frame(self) -> None:
    mailbox = CommandMailbox()
    mailbox.publish("browser-a", 1, True, 0, 0, brake=True, now=12.0)

    with self.assertRaisesRegex(ValueError, "brake"):
        mailbox.publish("browser-a", 2, True, 0, 1, brake=1, now=12.1)

    self.assertTrue(mailbox.snapshot().brake)
```

Add HTTP propagation, compatibility, and validation coverage:

```python
def test_control_frame_carries_manual_brake(self) -> None:
    status, response = self.request(
        "/api/control",
        method="POST",
        payload={
            "client_id": "browser-a",
            "sequence": 1,
            "armed": True,
            "steering": -1,
            "throttle": 1,
            "brake": True,
        },
    )

    self.assertEqual(status, 202)
    self.assertTrue(response["accepted"])
    self.assertTrue(self.mailbox.snapshot().brake)

def test_missing_brake_defaults_to_false(self) -> None:
    status, _response = self.request(
        "/api/control",
        method="POST",
        payload={
            "client_id": "browser-a",
            "sequence": 1,
            "armed": True,
            "steering": 0,
            "throttle": 0,
        },
    )

    self.assertEqual(status, 202)
    self.assertFalse(self.mailbox.snapshot().brake)

def test_non_boolean_brake_is_rejected_without_replacing_frame(self) -> None:
    self.request(
        "/api/control",
        method="POST",
        payload={
            "client_id": "browser-a",
            "sequence": 1,
            "armed": True,
            "steering": 0,
            "throttle": 0,
            "brake": True,
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
            "throttle": 0,
            "brake": 1,
        },
    )

    self.assertEqual(status, 400)
    self.assertEqual(error["error"], "invalid_request")
    self.assertTrue(self.mailbox.snapshot().brake)
```

- [ ] **Step 2: Run server tests and verify RED**

Run from `tests/hardware/pi-direct-pwm`:

```powershell
python -m unittest tests.test_live_server.CommandMailboxTests tests.test_live_server.LiveHttpTests -v
```

Expected: failures because `CommandMailbox.publish()` does not accept or propagate `brake`.

- [ ] **Step 3: Implement API propagation and compatibility default**

Extend the mailbox signature and frame construction:

```python
def publish(
    self,
    client_id: str,
    sequence: int,
    armed: bool,
    steering: int,
    throttle: int,
    throttle_limit_percent: int = 100,
    brake: bool = False,
    *,
    now: float,
) -> InputFrame:
    # existing scalar validation remains
    frame = InputFrame(
        armed=armed,
        steering=steering,
        throttle=throttle,
        received_at=now,
        throttle_limit_percent=throttle_limit_percent,
        brake=brake,
    )
```

Pass the optional field from HTTP JSON:

```python
mailbox.publish(
    payload["client_id"],
    payload["sequence"],
    payload["armed"],
    payload["steering"],
    payload["throttle"],
    throttle_limit_percent=payload.get("throttle_limit_percent", 100),
    brake=payload.get("brake", False),
    now=clock(),
)
```

- [ ] **Step 4: Run mailbox, HTTP, and control tests and verify GREEN**

Run:

```powershell
python -m unittest tests.test_live_control tests.test_live_server.CommandMailboxTests tests.test_live_server.LiveHttpTests -v
```

Expected: all selected tests pass with old requests defaulting to `brake=False`.

- [ ] **Step 5: Commit the control-frame API change**

```powershell
git add tests/hardware/pi-direct-pwm/rc_bench/live_server.py tests/hardware/pi-direct-pwm/tests/test_live_server.py
git commit -m "Carry manual brake through live control API"
```

### Task 3: Tunable Reverse Timing CLI

**Files:**
- Modify: `tests/hardware/pi-direct-pwm/rc_bench/live_server.py:233-330`
- Test: `tests/hardware/pi-direct-pwm/tests/test_live_server.py:142-166`

**Interfaces:**
- Consumes: `LiveConfig(reverse_brake_s: float, reverse_neutral_s: float)` from Task 1.
- Produces: `--reverse-brake-ms` and `--reverse-neutral-ms` integer arguments; `live_config_from_args(args: argparse.Namespace) -> LiveConfig`; `LiveRuntime(..., config: LiveConfig | None = None)`.

- [ ] **Step 1: Add failing parser/configuration tests**

Import `io`, `redirect_stderr`, `LiveConfig`, `build_parser`, and `live_config_from_args`, then add:

```python
class LiveCliTests(unittest.TestCase):
    def test_reverse_timing_defaults_to_sixty_milliseconds(self) -> None:
        args = build_parser().parse_args([])
        config = live_config_from_args(args)

        self.assertEqual(args.reverse_brake_ms, 60)
        self.assertEqual(args.reverse_neutral_ms, 60)
        self.assertEqual(config.reverse_brake_s, 0.06)
        self.assertEqual(config.reverse_neutral_s, 0.06)

    def test_reverse_timing_accepts_bounded_overrides(self) -> None:
        args = build_parser().parse_args(
            ["--reverse-brake-ms", "120", "--reverse-neutral-ms", "80"]
        )
        config = live_config_from_args(args)

        self.assertEqual(config.reverse_brake_s, 0.12)
        self.assertEqual(config.reverse_neutral_s, 0.08)

    def test_reverse_timing_rejects_values_outside_twenty_to_one_thousand(self) -> None:
        for option, value in (
            ("--reverse-brake-ms", "19"),
            ("--reverse-brake-ms", "1001"),
            ("--reverse-neutral-ms", "0"),
        ):
            with self.subTest(option=option, value=value):
                with redirect_stderr(io.StringIO()):
                    with self.assertRaises(SystemExit):
                        build_parser().parse_args([option, value])
```

Extend `LiveRuntimeTests` to prove injected timing reaches the state machine:

```python
def test_runtime_uses_injected_reverse_timing(self) -> None:
    now = [200.0]
    mailbox = CommandMailbox()
    output = FakePulseOutput()
    runtime = LiveRuntime(
        mailbox,
        output,
        clock=lambda: now[0],
        config=LiveConfig(reverse_brake_s=0.1, reverse_neutral_s=0.1),
    )

    mailbox.publish("browser-a", 1, True, 0, -1, now=now[0])
    runtime.tick()
    now[0] += 0.061
    mailbox.publish("browser-a", 2, True, 0, -1, now=now[0])
    state = runtime.tick()

    self.assertEqual((state.throttle_us, state.reverse_phase), (1250, "brake"))
    runtime.close()
```

- [ ] **Step 2: Run CLI/runtime tests and verify RED**

Run from `tests/hardware/pi-direct-pwm`:

```powershell
python -m unittest tests.test_live_server.LiveCliTests tests.test_live_server.LiveRuntimeTests -v
```

Expected: import/signature failures because timing CLI helpers and runtime injection do not exist.

- [ ] **Step 3: Implement bounded arguments and runtime injection**

Import `LiveConfig` beside the existing control imports. Add a strict argument converter:

```python
def _reverse_timing_ms(value: str) -> int:
    milliseconds = int(value)
    if not 20 <= milliseconds <= 1_000:
        raise argparse.ArgumentTypeError(
            "reverse timing must be between 20 and 1000 milliseconds"
        )
    return milliseconds
```

Add parser arguments and the conversion helper:

```python
parser.add_argument("--reverse-brake-ms", type=_reverse_timing_ms, default=60)
parser.add_argument("--reverse-neutral-ms", type=_reverse_timing_ms, default=60)

def live_config_from_args(args: argparse.Namespace) -> LiveConfig:
    return LiveConfig(
        reverse_brake_s=args.reverse_brake_ms / 1_000,
        reverse_neutral_s=args.reverse_neutral_ms / 1_000,
    )
```

Inject configuration into the runtime:

```python
def __init__(
    self,
    mailbox: CommandMailbox,
    output: PulseOutput,
    *,
    clock: Callable[[], float] = time.monotonic,
    config: LiveConfig | None = None,
) -> None:
    self._mailbox = mailbox
    self._output = output
    self._clock = clock
    self._control = LiveControl(config)
```

Build and pass it in `main`:

```python
runtime = LiveRuntime(mailbox, output, config=live_config_from_args(args))
```

- [ ] **Step 4: Run parser/runtime and full server tests and verify GREEN**

Run:

```powershell
python -m unittest tests.test_live_server -v
```

Expected: all page, mailbox, runtime, CLI, and HTTP tests pass.

- [ ] **Step 5: Commit tunable timing support**

```powershell
git add tests/hardware/pi-direct-pwm/rc_bench/live_server.py tests/hardware/pi-direct-pwm/tests/test_live_server.py
git commit -m "Add tunable fast reverse timing"
```

### Task 4: Browser Space-Brake Interaction

**Files:**
- Modify: `tests/hardware/pi-direct-pwm/web/live.html:394-655`
- Test: `tests/hardware/pi-direct-pwm/tests/test_live_server.py:20-59`

**Interfaces:**
- Consumes: optional `/api/control` field `brake: boolean` from Task 2.
- Produces: browser frames with `brake`, Space keydown/keyup state, unchanged Escape disarm, and matching visible help.

- [ ] **Step 1: Add failing browser contract tests**

Add these tests to `LivePageTests`:

```python
def test_space_is_momentary_brake_and_escape_still_disarms(self) -> None:
    self.assertIn('["Space", "BRAKE"]', self.page)
    self.assertIn('if (event.code === "Escape")', self.page)
    self.assertNotIn(
        'if (event.code === "Space" || event.code === "Escape")',
        self.page,
    )
    self.assertIn("brake: armed && current.brake", self.page)

def test_brake_has_local_priority_without_losing_throttle_key_state(self) -> None:
    self.assertIn('const brake = pressed.has("BRAKE")', self.page)
    self.assertIn("return {", self.page)
    self.assertIn("brake,", self.page)
    self.assertIn(
        'throttleState.textContent = !armed ? "NEUTRAL" : current.brake ? "BRAKE"',
        self.page,
    )

def test_visible_help_describes_brake_and_emergency_stop(self) -> None:
    self.assertIn("Space</strong> brake while held", self.page)
    self.assertIn("Esc</strong> emergency stop", self.page)
    self.assertIn("60 ms brake", self.page)
```

- [ ] **Step 2: Run page tests and verify RED**

Run from `tests/hardware/pi-direct-pwm`:

```powershell
python -m unittest tests.test_live_server.LivePageTests -v
```

Expected: failures because Space still calls `disarm()` and no brake field is sent.

- [ ] **Step 3: Implement browser key state and request field**

Extend the key map and `axes()`:

```javascript
const keyMap = new Map([
  ["KeyW", "W"], ["ArrowUp", "W"],
  ["KeyA", "A"], ["ArrowLeft", "A"],
  ["KeyS", "S"], ["ArrowDown", "S"],
  ["KeyD", "D"], ["ArrowRight", "D"],
  ["Space", "BRAKE"],
]);

function axes() {
  const left = pressed.has("A");
  const right = pressed.has("D");
  const forward = pressed.has("W");
  const reverse = pressed.has("S");
  const brake = pressed.has("BRAKE");
  return {
    steering: left === right ? 0 : left ? -1 : 1,
    throttle: forward === reverse ? 0 : forward ? 1 : -1,
    brake,
  };
}
```

Give brake priority in local telemetry without deleting `W` or `S` from `pressed`:

```javascript
throttleState.textContent = !armed
  ? "NEUTRAL"
  : current.brake
    ? "BRAKE"
    : current.throttle === 0
      ? "NEUTRAL"
      : current.throttle > 0
        ? "FORWARD"
        : "REVERSE";
```

Include brake in normal and unload payloads:

```javascript
brake: armed && current.brake,
```

```javascript
body: JSON.stringify({
  client_id: clientId,
  sequence: ++sequence,
  armed: false,
  steering: 0,
  throttle: 0,
  throttle_limit_percent: Number(throttleLimit.value),
  brake: false,
}),
```

Change keydown so only Escape disarms; mapped Space follows the normal keydown/keyup path:

```javascript
function onKeyDown(event) {
  if (event.code === "Escape") {
    event.preventDefault();
    disarm();
    return;
  }
  const key = keyMap.get(event.code);
  if (!key) return;
  event.preventDefault();
  if (!armed) return;
  if (!pressed.has(key)) {
    pressed.add(key);
    updateLocalUi();
    void sendControl();
  }
}
```

Update the warning and hint copy to state that Space brakes while held, S/down uses a 60 ms brake plus 60 ms neutral handshake, and Escape/Stop disarm. Do not change blur/visibility listeners.

- [ ] **Step 4: Run page, HTTP, and control tests and verify GREEN**

Run:

```powershell
python -m unittest tests.test_live_server.LivePageTests tests.test_live_server.LiveHttpTests tests.test_live_control -v
```

Expected: all selected tests pass and no assertion still describes Space as disarm.

- [ ] **Step 5: Commit the browser interaction**

```powershell
git add tests/hardware/pi-direct-pwm/web/live.html tests/hardware/pi-direct-pwm/tests/test_live_server.py
git commit -m "Map Space to momentary ESC brake"
```

### Task 5: Operator Documentation and Full Verification

**Files:**
- Modify: `tests/hardware/pi-direct-pwm/README.md:62-105`
- Verify: `tests/hardware/pi-direct-pwm/rc_bench/*.py`
- Verify: `tests/hardware/pi-direct-pwm/tests/*.py`
- Verify: `tests/hardware/pi-direct-pwm/web/live.html`

**Interfaces:**
- Consumes: completed control, API, CLI, and browser behaviour from Tasks 1-4.
- Produces: operator instructions and a verified local feature commit ready for deployment review.

- [ ] **Step 1: Update the operator instructions**

Document these exact behaviours in the Level 2 section:

```markdown
- `W` / up arrow: slider-limited forward;
- `S` / down arrow: 60 ms fixed brake, 60 ms neutral, then slider-limited reverse;
- `Space`: fixed brake while held; steering stays active and releasing Space
  immediately resumes a still-held throttle key;
- `A` / left arrow and `D` / right arrow: full steering, including while braking;
- `Escape` or Stop: neutral and disarm.
```

Add the tuning example and bounds:

```sh
rc-bench-live --host 0.0.0.0 --public-host office.local \
  --reverse-brake-ms 120 --reverse-neutral-ms 80
```

Explain that both values default to 60 and accept 20-1000 milliseconds, and that the operator should increase neutral first if the ESC does not recognise reverse. State explicitly that the throttle slider limits forward/reverse drive but not the fixed brake command.

- [ ] **Step 2: Run formatting and syntax checks**

Run from the repository root:

```powershell
git diff --check
python -m compileall -q tests/hardware/pi-direct-pwm/rc_bench tests/hardware/pi-direct-pwm/tests
```

Expected: both commands exit zero with no diagnostics.

- [ ] **Step 3: Run the complete bench test suite**

Run:

```powershell
Set-Location tests/hardware/pi-direct-pwm
python -m unittest discover -s tests -v
```

Expected: every test passes with no errors or failures.

- [ ] **Step 4: Run a no-GPIO dry-run smoke test**

Start the server from `tests/hardware/pi-direct-pwm`:

```powershell
python -m rc_bench.live_server --dry-run --host 127.0.0.1 --port 8765 --public-host 127.0.0.1 --token readiness-check
```

In another terminal, open the printed URL, arm the keyboard, and verify the console transitions:

```text
Space held: throttle=1250us while A/D still changes steering
Space released with W held: throttle changes immediately to the slider-limited forward pulse
S held: throttle=1250us, then 1500us about 60 ms later, then reverse drive about 60 ms later
Escape: steering=1500us throttle=1500us and DISARMED
```

Stop with `Ctrl+C`. Expected final lines include neutral output followed by `PWM off`; no `/dev/gpiochip0` access occurs in `--dry-run`.

- [ ] **Step 5: Commit documentation and verification-ready state**

```powershell
git add tests/hardware/pi-direct-pwm/README.md
git commit -m "Document brake and fast reverse controls"
git status --short
```

Expected: the commit succeeds and `git status --short` is empty. Do not push or deploy to Raspberry Pi without confirming that external step with the user.
