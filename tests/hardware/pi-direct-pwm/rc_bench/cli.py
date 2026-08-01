from __future__ import annotations

import argparse
import time
from collections.abc import Callable, Sequence
from typing import Protocol

from .controller import SafetyLimits
from .hardware import LgpioPulseOutput
from .runner import TestCommand, execute_test


class CloseableOutput(Protocol):
    def apply(self, steering_us: int, throttle_us: int) -> None: ...

    def close(self) -> None: ...


LIMITS = SafetyLimits(
    steering_neutral_us=1500,
    throttle_neutral_us=1500,
    steering_min_us=1000,
    steering_max_us=2000,
    throttle_min_us=1250,
    throttle_max_us=1750,
    watchdog_ms=250,
)

PROFILES = {
    "neutral": TestCommand(1500, 1500, duration_s=1.0, settle_s=0),
    "steer-left": TestCommand(1000, 1500, duration_s=2.0, settle_s=0.5),
    "steer-right": TestCommand(2000, 1500, duration_s=2.0, settle_s=0.5),
    "motor-forward": TestCommand(1500, 1750, duration_s=2.0, settle_s=3.0),
    "motor-reverse": TestCommand(1500, 1250, duration_s=2.0, settle_s=0.5),
}

REVERSE_BRAKE = TestCommand(1500, 1250, duration_s=0.3, settle_s=3.0)


class ConsolePulseOutput:
    def __init__(self) -> None:
        self._last: tuple[int, int] | None = None

    def apply(self, steering_us: int, throttle_us: int) -> None:
        command = (steering_us, throttle_us)
        if command != self._last:
            print(f"steering={steering_us}us throttle={throttle_us}us")
            self._last = command

    def close(self) -> None:
        print("PWM off")


def create_output(dry_run: bool) -> CloseableOutput:
    if dry_run:
        return ConsolePulseOutput()
    import lgpio

    return LgpioPulseOutput(
        lgpio,
        chip=0,
        steering_gpio=18,
        throttle_gpio=19,
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Short, safety-bounded GPIO18/GPIO19 RC bench tests."
    )
    parser.add_argument("action", choices=(*PROFILES, "gpio-check"))
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="print pulses without claiming GPIO",
    )
    return parser


def main(
    argv: Sequence[str] | None = None,
    *,
    output_factory: Callable[[bool], CloseableOutput] = create_output,
    clock: Callable[[], float] = time.monotonic,
    sleeper: Callable[[float], None] = time.sleep,
) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    output = output_factory(args.dry_run)
    try:
        if args.action == "gpio-check":
            return 0
        if args.action == "motor-reverse":
            execute_test(output, clock, sleeper, LIMITS, REVERSE_BRAKE)
        execute_test(output, clock, sleeper, LIMITS, PROFILES[args.action])
        sleeper(0.1)
    finally:
        output.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
