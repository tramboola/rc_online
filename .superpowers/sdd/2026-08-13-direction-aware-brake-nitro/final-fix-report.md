# Direction-Aware Brake and Nitro Final Fix Report

## Result

Status: DONE

Commit: `HEAD` (`Fix direction-aware reverse re-entry`). The exact immutable
SHA is returned with the task result; a commit cannot embed its own final SHA
inside a file that participates in that SHA.

## Changed files

- `tests/hardware/pi-direct-pwm/rc_bench/live_control.py`
- `tests/hardware/pi-direct-pwm/tests/test_live_control.py`
- `tests/hardware/pi-direct-pwm/README.md`
- `docs/superpowers/specs/2026-08-13-direction-aware-brake-nitro-design.md`
- `docs/superpowers/plans/2026-08-13-direction-aware-brake-nitro.md`
- `.superpowers/sdd/2026-08-13-direction-aware-brake-nitro/final-fix-report.md`

## RED

Command, run from `tests/hardware/pi-direct-pwm` before production changes:

```powershell
python -m unittest tests.test_live_control.LiveControlTests.test_completed_reverse_reentry_after_ordinary_neutral_skips_handshake tests.test_live_control.LiveControlTests.test_releasing_reverse_origin_brake_uses_only_neutral_before_reverse -v
```

Actual result: exit 1, 2 tests run, 2 expected assertion failures.

- Ordinary neutral re-entry returned `(1250, "brake")` instead of
  `(1342, "reverse")`.
- Reverse-origin manual-brake release returned `(1250, "brake")` instead of
  `(1500, "neutral")`.

## GREEN and final verification

Focused regression command after the state-machine change:

```powershell
python -m unittest tests.test_live_control.LiveControlTests.test_completed_reverse_reentry_after_ordinary_neutral_skips_handshake tests.test_live_control.LiveControlTests.test_releasing_reverse_origin_brake_uses_only_neutral_before_reverse -v
```

Actual result: exit 0, 2 tests run, OK.

Focused live-control suite:

```powershell
python -m unittest tests.test_live_control -v
```

Actual result: exit 0, 20 tests run, OK.

Complete bench suite:

```powershell
python -m unittest discover -s tests -v
```

Actual result: exit 0, 64 tests run, OK.

Source and whitespace checks:

```powershell
python -m compileall -q rc_bench tests
git -C ..\..\.. diff --check
```

Actual result: both commands exited 0. `compileall` produced no diagnostics;
`git diff --check` reported no whitespace errors (Git emitted only configured
LF-to-CRLF working-copy notices).

## State-transition explanation

The root cause was that ordinary neutral and manual brake both reset the
reverse phase to `idle`, while every `idle` reverse request unconditionally
entered the 1250 microsecond brake phase. Remembered direction stayed reverse,
but the reverse-entry branch ignored it.

The minimal correction adds one state bit,
`_reverse_reentry_needs_neutral`, alongside the existing phase and remembered
direction:

- unknown or forward direction plus `S` keeps the full configured handshake:
  1250 microseconds, then 1500, then fixed 1342 reverse;
- completed reverse, ordinary armed neutral, then `S` enters the reverse phase
  immediately at 1342, without 1250 or a handshake;
- `Space` after completed reverse remains 1750 and marks neutral-only re-entry;
  releasing it while `S` remains held starts the existing configured reverse
  neutral dwell at 1500, then returns to 1342, without 1250;
- ordinary neutral, forward drive, disarm, and watchdog expiry clear the
  neutral-only marker as appropriate;
- Nitro does not participate in reverse output selection, and existing manual
  brake endpoints remain 1750 after reverse and 1250 after forward.

## Self-review

- The implementation changes only `LiveControl` reverse-entry state; mailbox,
  HTTP, browser, GPIO, timing configuration, and output limits are untouched.
- Regression assertions use literal pulse values and observable phases. The
  two defect tests failed against the old production code for the expected
  branch, then passed after the fix.
- A retained-behaviour test explicitly protects `forward -> S` as the original
  1250/1500/1342 handshake.
- Design, implementation plan, and operator README now describe the two
  known-reverse re-entry paths and no longer claim an unconditional handshake.
- Final diff review found and corrected a stale `_reset_motion()` example in
  the implementation plan before commit.

## Concerns and boundaries

- No Raspberry Pi, real GPIO, server deployment, push, or physical ESC test was
  performed, as required. Hardware confirmation remains a separate
  suspended-wheel step after explicit authorization.
- No known local test or source-check failures remain.
