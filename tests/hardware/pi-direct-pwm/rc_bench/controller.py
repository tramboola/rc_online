from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Protocol


class PulseOutput(Protocol):
    def apply(self, steering_us: int, throttle_us: int) -> None: ...


@dataclass(frozen=True, slots=True)
class SafetyLimits:
    steering_neutral_us: int
    throttle_neutral_us: int
    steering_min_us: int
    steering_max_us: int
    throttle_min_us: int
    throttle_max_us: int
    watchdog_ms: int

    def __post_init__(self) -> None:
        if not self.steering_min_us <= self.steering_neutral_us <= self.steering_max_us:
            raise ValueError("steering neutral must be inside steering limits")
        if not self.throttle_min_us <= self.throttle_neutral_us <= self.throttle_max_us:
            raise ValueError("throttle neutral must be inside throttle limits")
        if not 50 <= self.watchdog_ms <= 1_000:
            raise ValueError("watchdog must be between 50 and 1000 ms")


@dataclass(frozen=True, slots=True)
class ControllerStatus:
    armed: bool
    steering_us: int
    throttle_us: int
    deadline: float | None


class BenchController:
    def __init__(
        self,
        output: PulseOutput,
        clock: Callable[[], float],
        limits: SafetyLimits,
    ) -> None:
        self._output = output
        self._clock = clock
        self._limits = limits
        self._armed = False
        self._steering_us = limits.steering_neutral_us
        self._throttle_us = limits.throttle_neutral_us
        self._deadline: float | None = None
        self._apply_neutral()

    def status(self) -> ControllerStatus:
        return ControllerStatus(
            armed=self._armed,
            steering_us=self._steering_us,
            throttle_us=self._throttle_us,
            deadline=self._deadline,
        )

    def arm(self) -> None:
        self._apply_neutral()
        self._armed = True

    def neutral(self) -> None:
        self._apply_neutral()
        self._armed = False

    def set_pulses(self, steering_us: int, throttle_us: int) -> None:
        if not self._armed:
            self._apply_neutral()
            raise PermissionError("controller must be armed before a non-neutral command")
        if not (
            self._limits.steering_min_us <= steering_us <= self._limits.steering_max_us
            and self._limits.throttle_min_us <= throttle_us <= self._limits.throttle_max_us
        ):
            self.neutral()
            raise ValueError("command is outside configured bench limits")
        self._output.apply(steering_us, throttle_us)
        self._steering_us = steering_us
        self._throttle_us = throttle_us
        self._deadline = self._clock() + self._limits.watchdog_ms / 1_000

    def expire_if_needed(self) -> bool:
        if self._deadline is None or self._clock() < self._deadline:
            return False
        self.neutral()
        return True

    def _apply_neutral(self) -> None:
        self._output.apply(
            self._limits.steering_neutral_us,
            self._limits.throttle_neutral_us,
        )
        self._steering_us = self._limits.steering_neutral_us
        self._throttle_us = self._limits.throttle_neutral_us
        self._deadline = None
