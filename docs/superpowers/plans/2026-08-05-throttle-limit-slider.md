# RC Bench Throttle Limit Slider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a live 10-100% browser slider that symmetrically reduces the existing verified forward and reverse throttle limits while keeping PWM calculation and validation on Raspberry Pi.

**Architecture:** Extend each normalized control frame with an integer `throttle_limit_percent`, defaulting to 100 for compatibility. Validate it at the HTTP/mailbox boundary, then scale the existing 1500-to-1750/1250 microsecond deviations inside `LiveControl`; the browser only selects and displays the percentage.

**Tech Stack:** Python 3.11 standard library, `unittest`, dependency-free HTML/CSS/JavaScript, existing threaded HTTP server.

## Global Constraints

- The slider range is 10 through 100 inclusive, in integer 1% steps, and defaults to 100 after page reload.
- 100% means the existing verified stand cap: 1750 microseconds forward and 1250 microseconds reverse; it must never expand to the ESC's full 1000-2000 microsecond range.
- The same percentage applies to forward, reverse braking, and reverse drive; neutral remains exactly 1500 microseconds.
- Exact half-microsecond results round away from neutral so positive and negative outputs remain symmetric.
- Invalid percentages never replace the last valid mailbox frame or reach GPIO; a missing field defaults to 100%.
- Existing steering, arming, watchdog, ownership, emergency-stop, and reverse timing behaviour must remain unchanged.
- Add no runtime dependencies and do not run real GPIO during software verification.

## File map

- `tests/hardware/pi-direct-pwm/rc_bench/live_control.py`: owns validated frame data and server-side percentage-to-PWM mapping.
- `tests/hardware/pi-direct-pwm/rc_bench/live_server.py`: validates and transports the percentage through HTTP and the mailbox.
- `tests/hardware/pi-direct-pwm/web/live.html`: renders the slider, displays its value, and includes it in every control request.
- `tests/hardware/pi-direct-pwm/tests/test_live_control.py`: verifies pulse scaling, rounding, defaults, reverse behaviour, and value validation.
- `tests/hardware/pi-direct-pwm/tests/test_live_server.py`: verifies mailbox/HTTP propagation, compatibility defaults, invalid-request isolation, and browser document wiring.
- `tests/hardware/pi-direct-pwm/README.md`: explains runtime use and the safety meaning of 100%.

---

### Task 1: Server-side throttle scaling

**Files:**
- Modify: `tests/hardware/pi-direct-pwm/tests/test_live_control.py`
- Modify: `tests/hardware/pi-direct-pwm/rc_bench/live_control.py`

**Interfaces:**
- Consumes: existing `LiveConfig` throttle endpoints and `InputFrame` normalized throttle values `-1`, `0`, and `1`.
- Produces: `InputFrame(armed, steering, throttle, received_at, throttle_limit_percent=100)` and `LiveControl.step(...) -> OutputState` with the scaled `throttle_us`.

- [ ] **Step 1: Write failing scaling and validation tests**

Update the test helper to accept the wished-for field:

```python
def frame(
    self,
    now: float,
    *,
    armed: bool = True,
    steering: int = 0,
    throttle: int = 0,
    throttle_limit_percent: int = 100,
) -> InputFrame:
    return InputFrame(
        armed=armed,
        steering=steering,
        throttle=throttle,
        received_at=now,
        throttle_limit_percent=throttle_limit_percent,
    )
```

Add focused tests:

```python
def test_throttle_limit_scales_forward_and_reverse_symmetrically(self) -> None:
    forward = self.control.step(
        self.frame(6.0, throttle=1, throttle_limit_percent=10), now=6.0
    )
    reverse = self.control.step(
        self.frame(6.1, throttle=-1, throttle_limit_percent=10), now=6.1
    )

    self.assertEqual(forward.throttle_us, 1525)
    self.assertEqual((reverse.throttle_us, reverse.reverse_phase), (1475, "brake"))

def test_throttle_limit_rounds_half_microseconds_away_from_neutral(self) -> None:
    forward = self.control.step(
        self.frame(7.0, throttle=1, throttle_limit_percent=33), now=7.0
    )
    reverse = self.control.step(
        self.frame(7.1, throttle=-1, throttle_limit_percent=33), now=7.1
    )

    self.assertEqual(forward.throttle_us, 1583)
    self.assertEqual(reverse.throttle_us, 1417)

def test_throttle_limit_preserves_neutral_and_default_endpoints(self) -> None:
    neutral = self.control.step(
        self.frame(8.0, throttle=0, throttle_limit_percent=10), now=8.0
    )
    forward = self.control.step(self.frame(8.1, throttle=1), now=8.1)

    self.assertEqual(neutral.throttle_us, 1500)
    self.assertEqual(forward.throttle_us, 1750)

def test_invalid_throttle_limit_is_rejected(self) -> None:
    for value in (True, 9, 101, 10.5):
        with self.subTest(value=value):
            with self.assertRaisesRegex(ValueError, "throttle_limit_percent"):
                InputFrame(
                    True,
                    steering=0,
                    throttle=0,
                    received_at=1.0,
                    throttle_limit_percent=value,
                )
```

- [ ] **Step 2: Run the tests and verify the expected failure**

Run from `tests/hardware/pi-direct-pwm`:

```powershell
python -m unittest tests.test_live_control -v
```

Expected: the new tests fail because `InputFrame` does not accept `throttle_limit_percent`.

- [ ] **Step 3: Add the validated frame field and scaling helper**

Append a backwards-compatible field to `InputFrame` and validate it:

```python
@dataclass(frozen=True, slots=True)
class InputFrame:
    armed: bool
    steering: int
    throttle: int
    received_at: float
    throttle_limit_percent: int = 100

    def __post_init__(self) -> None:
        if self.steering not in (-1, 0, 1):
            raise ValueError("steering must be -1, 0, or 1")
        if self.throttle not in (-1, 0, 1):
            raise ValueError("throttle must be -1, 0, or 1")
        if not math.isfinite(self.received_at):
            raise ValueError("received_at must be finite")
        if (
            isinstance(self.throttle_limit_percent, bool)
            or not isinstance(self.throttle_limit_percent, int)
            or not 10 <= self.throttle_limit_percent <= 100
        ):
            raise ValueError("throttle_limit_percent must be an integer from 10 to 100")
```

Pass the percentage into `_throttle`, then scale the configured endpoint with integer arithmetic:

```python
throttle_us = self._throttle(
    frame.throttle,
    frame.throttle_limit_percent,
    now,
)

def _scaled_throttle_us(self, endpoint_us: int, limit_percent: int) -> int:
    neutral_us = self._config.throttle_neutral_us
    delta_us = endpoint_us - neutral_us
    scaled_delta_us = (abs(delta_us) * limit_percent + 50) // 100
    return neutral_us + (scaled_delta_us if delta_us > 0 else -scaled_delta_us)
```

Change `_throttle` to accept `limit_percent`. Compute `forward_us` and `reverse_us` at the start, return `forward_us` for throttle `1`, and use `reverse_us` for both the `brake` and `reverse` phases. Keep every neutral return unchanged at `self._config.throttle_neutral_us`.

- [ ] **Step 4: Run the focused control tests**

```powershell
python -m unittest tests.test_live_control -v
```

Expected: all `LiveControlTests` pass, including existing watchdog and reverse-sequence tests.

- [ ] **Step 5: Commit the independently testable control-layer change**

```powershell
git add tests/hardware/pi-direct-pwm/rc_bench/live_control.py tests/hardware/pi-direct-pwm/tests/test_live_control.py
git commit -m "Add server-side throttle limit scaling"
```

---

### Task 2: HTTP and mailbox propagation

**Files:**
- Modify: `tests/hardware/pi-direct-pwm/tests/test_live_server.py`
- Modify: `tests/hardware/pi-direct-pwm/rc_bench/live_server.py`

**Interfaces:**
- Consumes: `InputFrame(..., throttle_limit_percent: int = 100)` from Task 1.
- Produces: `CommandMailbox.publish(..., throttle_limit_percent: int = 100, *, now: float) -> InputFrame`; `/api/control` accepts optional JSON field `throttle_limit_percent`.

- [ ] **Step 1: Write failing mailbox and HTTP tests**

Add a mailbox propagation test:

```python
def test_preserves_throttle_limit_in_published_frame(self) -> None:
    mailbox = CommandMailbox()

    frame = mailbox.publish(
        "browser-a",
        1,
        True,
        0,
        1,
        throttle_limit_percent=40,
        now=12.0,
    )

    self.assertEqual(frame.throttle_limit_percent, 40)
```

Extend the existing valid HTTP test with `"throttle_limit_percent": 40` and assert `frame.throttle_limit_percent == 40`. Add compatibility and rejection tests:

```python
def test_missing_throttle_limit_defaults_to_100_percent(self) -> None:
    status, _response = self.request(
        "/api/control",
        method="POST",
        payload={
            "client_id": "browser-a",
            "sequence": 1,
            "armed": True,
            "steering": 0,
            "throttle": 1,
        },
    )

    self.assertEqual(status, 202)
    self.assertEqual(self.mailbox.snapshot().throttle_limit_percent, 100)

def test_invalid_throttle_limit_does_not_replace_last_valid_frame(self) -> None:
    self.request(
        "/api/control",
        method="POST",
        payload={
            "client_id": "browser-a",
            "sequence": 1,
            "armed": True,
            "steering": 0,
            "throttle": 1,
            "throttle_limit_percent": 40,
        },
    )

    for sequence, value in enumerate((True, 9, 101, 10.5), start=2):
        with self.subTest(value=value):
            status, error = self.request(
                "/api/control",
                method="POST",
                payload={
                    "client_id": "browser-a",
                    "sequence": sequence,
                    "armed": True,
                    "steering": 0,
                    "throttle": 1,
                    "throttle_limit_percent": value,
                },
            )
            self.assertEqual(status, 400)
            self.assertEqual(error["error"], "invalid_request")
            self.assertEqual(self.mailbox.snapshot().throttle_limit_percent, 40)
```

- [ ] **Step 2: Run the server tests and verify the expected failure**

```powershell
python -m unittest tests.test_live_server -v
```

Expected: the mailbox call fails because `publish` lacks the new keyword, and HTTP propagation assertions fail because the handler drops the field.

- [ ] **Step 3: Transport the percentage through the mailbox and handler**

Extend `CommandMailbox.publish` without breaking existing callers:

```python
def publish(
    self,
    client_id: str,
    sequence: int,
    armed: bool,
    steering: int,
    throttle: int,
    throttle_limit_percent: int = 100,
    *,
    now: float,
) -> InputFrame:
```

Construct the frame with named data so the new field is explicit:

```python
frame = InputFrame(
    armed=armed,
    steering=steering,
    throttle=throttle,
    received_at=now,
    throttle_limit_percent=throttle_limit_percent,
)
```

Pass the JSON field from the request with the compatibility default:

```python
mailbox.publish(
    payload["client_id"],
    payload["sequence"],
    payload["armed"],
    payload["steering"],
    payload["throttle"],
    throttle_limit_percent=payload.get("throttle_limit_percent", 100),
    now=clock(),
)
```

Rely on `InputFrame.__post_init__` for the integer/range check so validation happens before the mailbox lock mutates ownership, sequence, or the last frame.

- [ ] **Step 4: Run server and control tests together**

```powershell
python -m unittest tests.test_live_server tests.test_live_control -v
```

Expected: all mailbox, HTTP, runtime, and control tests pass.

- [ ] **Step 5: Commit the transport change**

```powershell
git add tests/hardware/pi-direct-pwm/rc_bench/live_server.py tests/hardware/pi-direct-pwm/tests/test_live_server.py
git commit -m "Carry throttle limit through live control API"
```

---

### Task 3: Browser slider and operator documentation

**Files:**
- Modify: `tests/hardware/pi-direct-pwm/tests/test_live_server.py`
- Modify: `tests/hardware/pi-direct-pwm/web/live.html`
- Modify: `tests/hardware/pi-direct-pwm/README.md`

**Interfaces:**
- Consumes: optional `/api/control` field `throttle_limit_percent` from Task 2.
- Produces: accessible `#throttle-limit` range input, `#throttle-limit-value` output, immediate armed updates, and documented operator semantics.

- [ ] **Step 1: Write a failing browser document test**

Import `Path`, load the real page once, and assert the stable UI/API contract:

```python
from pathlib import Path


class LivePageTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.page = (
            Path(__file__).resolve().parents[1] / "web" / "live.html"
        ).read_text(encoding="utf-8")

    def test_page_exposes_safe_throttle_limit_slider(self) -> None:
        self.assertIn('id="throttle-limit"', self.page)
        self.assertIn('min="10"', self.page)
        self.assertIn('max="100"', self.page)
        self.assertIn('step="1"', self.page)
        self.assertIn('value="100"', self.page)
        self.assertIn('id="throttle-limit-value"', self.page)
        self.assertIn("100% = current stand cap", self.page)

    def test_page_sends_limit_and_reacts_while_armed(self) -> None:
        self.assertIn(
            "throttle_limit_percent: Number(throttleLimit.value)",
            self.page,
        )
        self.assertIn(
            'throttleLimit.addEventListener("input", () => {\n'
            "        updateThrottleLimitUi();\n"
            "        if (armed) void sendControl();\n"
            "      });",
            self.page,
        )
```

- [ ] **Step 2: Run the page test and verify the expected failure**

```powershell
python -m unittest tests.test_live_server.LivePageTests -v
```

Expected: both tests fail because the page has no throttle slider or request field.

- [ ] **Step 3: Add the slider markup and focused styling**

Insert this block between `.keyboard` and `.actions`:

```html
<div class="throttle-limit-control">
  <div class="throttle-limit-head">
    <label for="throttle-limit">Throttle limit</label>
    <output id="throttle-limit-value" for="throttle-limit">100%</output>
  </div>
  <input id="throttle-limit" type="range" min="10" max="100" step="1" value="100" aria-describedby="throttle-limit-note">
  <p id="throttle-limit-note">100% = current stand cap · 1750 / 1250 µs</p>
</div>
```

Add styles near the existing control styles. Keep the range native and accessible while matching the current cyan diagnostic UI:

```css
.throttle-limit-control {
  margin: 0 0 22px;
  padding: 16px;
  border: 1px solid var(--line);
  background: rgba(5, 9, 13, .5);
}

.throttle-limit-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 16px;
  color: var(--muted);
  font: 800 11px/1 ui-monospace, SFMono-Regular, Consolas, monospace;
  letter-spacing: .1em;
  text-transform: uppercase;
}

#throttle-limit-value { color: var(--cyan); font-size: 16px; }

#throttle-limit {
  width: 100%;
  height: 4px;
  margin: 18px 0 12px;
  appearance: none;
  cursor: pointer;
  border-radius: 999px;
  background: linear-gradient(
    90deg,
    var(--cyan) 0 var(--limit-fill, 100%),
    #30434d var(--limit-fill, 100%) 100%
  );
  transition: background 120ms ease-out;
}

#throttle-limit::-webkit-slider-thumb {
  width: 18px;
  height: 18px;
  appearance: none;
  border: 2px solid var(--bg);
  border-radius: 50%;
  background: var(--cyan);
  box-shadow: 0 0 14px rgba(60, 219, 255, .35);
}

#throttle-limit::-moz-range-thumb {
  width: 14px;
  height: 14px;
  border: 2px solid var(--bg);
  border-radius: 50%;
  background: var(--cyan);
  box-shadow: 0 0 14px rgba(60, 219, 255, .35);
}

#throttle-limit:focus-visible { outline: 2px solid white; outline-offset: 6px; }
#throttle-limit-note { margin: 0; color: var(--muted); font-size: 10px; line-height: 1.4; }
```

The existing `prefers-reduced-motion` rule already reduces the new background transition.

- [ ] **Step 4: Wire display updates and request transport**

Query the new elements with the existing control references:

```javascript
const throttleLimit = document.querySelector("#throttle-limit");
const throttleLimitValue = document.querySelector("#throttle-limit-value");
```

Add a local display helper. The fill maps the allowed 10-100 range onto the visual track's 0-100% length:

```javascript
function updateThrottleLimitUi() {
  const value = Number(throttleLimit.value);
  const fill = ((value - 10) / 90) * 100;
  throttleLimitValue.value = `${value}%`;
  throttleLimitValue.textContent = `${value}%`;
  throttleLimit.style.setProperty("--limit-fill", `${fill}%`);
}
```

Include the value in the main control body and the `beforeunload` neutral body:

```javascript
throttle_limit_percent: Number(throttleLimit.value),
```

Register immediate local/armed behaviour:

```javascript
throttleLimit.addEventListener("input", () => {
  updateThrottleLimitUi();
  if (armed) void sendControl();
});
```

Call `updateThrottleLimitUi()` immediately before the existing first `updateLocalUi()` call. Request coalescing already ensures rapid pointer input produces at most one active request plus one queued refresh.

- [ ] **Step 5: Document the operator-visible semantics**

Add this paragraph to the Level 2 section after the keyboard list:

```markdown
The **Throttle limit** slider applies equally to forward and reverse and can
be changed while a throttle key is held. Its 10-100% scale is relative to the
bench's verified 1250-1750 microsecond cap: 100% remains 1750 forward / 1250
reverse, while 10% produces 1525 forward / 1475 reverse. Reloading the page
returns the slider to 100%. It never unlocks the ESC's full pulse range.
```

- [ ] **Step 6: Run the browser document and complete bench suites**

From `tests/hardware/pi-direct-pwm`:

```powershell
python -m unittest tests.test_live_server.LivePageTests -v
python -m unittest discover -s tests -q
```

Expected: the page tests pass, then the complete bench suite reports zero failures.

- [ ] **Step 7: Commit the browser and documentation change**

```powershell
git add tests/hardware/pi-direct-pwm/web/live.html tests/hardware/pi-direct-pwm/tests/test_live_server.py tests/hardware/pi-direct-pwm/README.md
git commit -m "Add live throttle limit slider"
```

---

### Task 4: Final regression and dry-run verification

**Files:**
- Verify: `tests/hardware/pi-direct-pwm/rc_bench/live_control.py`
- Verify: `tests/hardware/pi-direct-pwm/rc_bench/live_server.py`
- Verify: `tests/hardware/pi-direct-pwm/web/live.html`
- Verify: `tests/hardware/pi-direct-pwm/README.md`

**Interfaces:**
- Consumes: the completed control, transport, and browser changes from Tasks 1-3.
- Produces: fresh test, diff, and dry-run evidence suitable for completion reporting.

- [ ] **Step 1: Run the full repository software suite**

From the repository root:

```powershell
python -m unittest discover -s tests -q
```

Expected: all repository tests pass with zero failures.

- [ ] **Step 2: Run the isolated bench suite again**

From `tests/hardware/pi-direct-pwm`:

```powershell
python -m unittest discover -s tests -q
```

Expected: all bench tests, including the new slider coverage, pass with zero failures.

- [ ] **Step 3: Inspect code health and scope**

```powershell
git diff --check HEAD~3..HEAD
git status --short
```

Expected: no whitespace errors and no unrelated working-tree changes.

- [ ] **Step 4: Verify browser behaviour without GPIO**

Start `rc-bench-live` in `--dry-run` with a fixed test token, open the local page, and confirm:

1. The slider starts at 100% and shows the stand-cap explanation.
2. Mouse and keyboard input cover every integer value from 10 through 100.
3. At 10%, holding `W` reports 1525 microseconds and holding `S` reports 1475 microseconds during brake/reverse.
4. At 100%, the same keys report 1750 and 1250 microseconds.
5. Moving the slider while holding either throttle key changes telemetry without disarming.
6. `Space`, `Escape`, blur, and stop still return 1500 microseconds and disarm.
7. The browser console has no errors at desktop and narrow widths.

Do not start real GPIO output for this verification.

- [ ] **Step 5: Report the verified outcome**

Include the modified files, exact test commands and counts, dry-run observations, and the explicit limitation that 100% is the existing stand cap rather than full ESC output. Do not push or deploy to Raspberry Pi without a separate user request.
