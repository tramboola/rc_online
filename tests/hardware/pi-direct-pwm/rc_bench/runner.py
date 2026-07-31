from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

from .controller import BenchController, PulseOutput, SafetyLimits


@dataclass(frozen=True, slots=True)
class TestCommand:
    steering_us: int
    throttle_us: int
    duration_s: float
    settle_s: float

    def __post_init__(self) -> None:
        if not 0 < self.duration_s <= 2:
            raise ValueError("duration must be greater than zero and at most two seconds")
        if not 0 <= self.settle_s <= 5:
            raise ValueError("settle time must be between zero and five seconds")


def execute_test(
    output: PulseOutput,
    clock: Callable[[], float],
    sleeper: Callable[[float], None],
    limits: SafetyLimits,
    command: TestCommand,
) -> None:
    controller = BenchController(output, clock, limits)
    refresh_s = min(limits.watchdog_ms / 2_000, 0.1)
    try:
        if command.settle_s:
            sleeper(command.settle_s)
        controller.arm()
        end = clock() + command.duration_s
        while clock() < end:
            controller.set_pulses(command.steering_us, command.throttle_us)
            remaining = end - clock()
            if remaining <= 0:
                break
            sleeper(min(refresh_s, remaining))
            controller.expire_if_needed()
    finally:
        controller.neutral()
