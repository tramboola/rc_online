from __future__ import annotations

import math
from dataclasses import dataclass


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


@dataclass(frozen=True, slots=True)
class LiveConfig:
    steering_left_us: int = 1000
    steering_neutral_us: int = 1500
    steering_right_us: int = 2000
    throttle_reverse_us: int = 1250
    throttle_neutral_us: int = 1500
    throttle_forward_us: int = 1750
    watchdog_s: float = 0.2
    reverse_brake_s: float = 0.3
    reverse_neutral_s: float = 0.5

    def __post_init__(self) -> None:
        if not self.steering_left_us < self.steering_neutral_us < self.steering_right_us:
            raise ValueError("steering pulses must be ordered left, neutral, right")
        if not self.throttle_reverse_us < self.throttle_neutral_us < self.throttle_forward_us:
            raise ValueError("throttle pulses must be ordered reverse, neutral, forward")
        if not 0.05 <= self.watchdog_s <= 1.0:
            raise ValueError("watchdog_s must be between 0.05 and 1.0")
        if self.reverse_brake_s <= 0 or self.reverse_neutral_s <= 0:
            raise ValueError("reverse phase durations must be positive")


@dataclass(frozen=True, slots=True)
class OutputState:
    steering_us: int
    throttle_us: int
    armed: bool
    stale: bool
    reverse_phase: str


class LiveControl:
    def __init__(self, config: LiveConfig | None = None) -> None:
        self._config = config or LiveConfig()
        self._reverse_phase = "idle"
        self._reverse_phase_started = 0.0

    def step(self, frame: InputFrame | None, now: float) -> OutputState:
        if frame is None or now - frame.received_at > self._config.watchdog_s:
            self._reset_reverse()
            return self._neutral(stale=True)
        if not frame.armed:
            self._reset_reverse()
            return self._neutral(stale=False)

        steering_us = {
            -1: self._config.steering_left_us,
            0: self._config.steering_neutral_us,
            1: self._config.steering_right_us,
        }[frame.steering]
        throttle_us = self._throttle(
            frame.throttle,
            frame.throttle_limit_percent,
            now,
        )
        return OutputState(
            steering_us=steering_us,
            throttle_us=throttle_us,
            armed=True,
            stale=False,
            reverse_phase=self._reverse_phase,
        )

    def _throttle(self, throttle: int, limit_percent: int, now: float) -> int:
        forward_us = self._scaled_throttle_us(
            self._config.throttle_forward_us,
            limit_percent,
        )
        reverse_us = self._scaled_throttle_us(
            self._config.throttle_reverse_us,
            limit_percent,
        )
        if throttle == 1:
            self._reset_reverse()
            return forward_us
        if throttle == 0:
            self._reset_reverse()
            return self._config.throttle_neutral_us

        if self._reverse_phase == "idle":
            self._reverse_phase = "brake"
            self._reverse_phase_started = now
            return reverse_us

        elapsed = now - self._reverse_phase_started
        if self._reverse_phase == "brake":
            if elapsed < self._config.reverse_brake_s:
                return reverse_us
            self._reverse_phase = "neutral"
            self._reverse_phase_started = now
            return self._config.throttle_neutral_us

        if self._reverse_phase == "neutral":
            if elapsed < self._config.reverse_neutral_s:
                return self._config.throttle_neutral_us
            self._reverse_phase = "reverse"
            self._reverse_phase_started = now

        return reverse_us

    def _scaled_throttle_us(self, endpoint_us: int, limit_percent: int) -> int:
        neutral_us = self._config.throttle_neutral_us
        delta_us = endpoint_us - neutral_us
        scaled_delta_us = (abs(delta_us) * limit_percent + 50) // 100
        return neutral_us + (scaled_delta_us if delta_us > 0 else -scaled_delta_us)

    def _neutral(self, *, stale: bool) -> OutputState:
        return OutputState(
            steering_us=self._config.steering_neutral_us,
            throttle_us=self._config.throttle_neutral_us,
            armed=False,
            stale=stale,
            reverse_phase="idle",
        )

    def _reset_reverse(self) -> None:
        self._reverse_phase = "idle"
        self._reverse_phase_started = 0.0
