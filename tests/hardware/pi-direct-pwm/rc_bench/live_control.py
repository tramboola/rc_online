from __future__ import annotations

import math
from dataclasses import dataclass


NORMAL_DRIVE_PERCENT = 63
REVERSE_DRIVE_PERCENT = 30


@dataclass(frozen=True, slots=True)
class InputFrame:
    armed: bool
    steering: int
    throttle: int
    received_at: float
    nitro: bool = False
    steering_trim_percent: int = 0

    def __post_init__(self) -> None:
        if self.steering not in (-1, 0, 1):
            raise ValueError("steering must be -1, 0, or 1")
        if self.throttle not in (-1, 0, 1):
            raise ValueError("throttle must be -1, 0, or 1")
        if not math.isfinite(self.received_at):
            raise ValueError("received_at must be finite")
        if not isinstance(self.nitro, bool):
            raise ValueError("nitro must be boolean")
        if type(self.steering_trim_percent) is not int or not -20 <= self.steering_trim_percent <= 20:
            raise ValueError("steering_trim_percent must be an integer between -20 and 20")


@dataclass(frozen=True, slots=True)
class LiveConfig:
    steering_left_us: int = 1000
    steering_neutral_us: int = 1500
    steering_right_us: int = 2000
    throttle_reverse_us: int = 1250
    throttle_neutral_us: int = 1500
    throttle_forward_us: int = 1750
    watchdog_s: float = 0.2

    def __post_init__(self) -> None:
        if not self.steering_left_us < self.steering_neutral_us < self.steering_right_us:
            raise ValueError("steering pulses must be ordered left, neutral, right")
        if not self.throttle_reverse_us < self.throttle_neutral_us < self.throttle_forward_us:
            raise ValueError("throttle pulses must be ordered reverse, neutral, forward")
        if not 0.05 <= self.watchdog_s <= 1.0:
            raise ValueError("watchdog_s must be between 0.05 and 1.0")


@dataclass(frozen=True, slots=True)
class OutputState:
    steering_us: int
    throttle_us: int
    armed: bool
    stale: bool


class LiveControl:
    def __init__(self, config: LiveConfig | None = None) -> None:
        self._config = config or LiveConfig()

    def step(self, frame: InputFrame | None, now: float) -> OutputState:
        if frame is None or now - frame.received_at > self._config.watchdog_s:
            return self._neutral(stale=True)
        if not frame.armed:
            return self._neutral(stale=False)
        steering_us = self._map_steering(frame.steering, frame.steering_trim_percent)
        if frame.throttle > 0:
            throttle_us = self._config.throttle_forward_us if frame.nitro else self._scaled_forward_us()
        elif frame.throttle < 0:
            throttle_us = self._scaled_reverse_us()
        else:
            throttle_us = self._config.throttle_neutral_us
        return OutputState(steering_us, throttle_us, True, False)

    def _map_steering(self, steering: int, trim_percent: int) -> int:
        if steering < 0:
            return self._config.steering_left_us
        if steering > 0:
            return self._config.steering_right_us
        center_us = self._config.steering_neutral_us
        if trim_percent < 0:
            span_us = center_us - self._config.steering_left_us
            return center_us - (span_us * -trim_percent + 50) // 100
        span_us = self._config.steering_right_us - center_us
        return center_us + (span_us * trim_percent + 50) // 100

    def _scaled_forward_us(self) -> int:
        delta = self._config.throttle_forward_us - self._config.throttle_neutral_us
        return self._config.throttle_neutral_us + (delta * NORMAL_DRIVE_PERCENT + 50) // 100

    def _scaled_reverse_us(self) -> int:
        delta = self._config.throttle_neutral_us - self._config.throttle_reverse_us
        return self._config.throttle_neutral_us - (delta * REVERSE_DRIVE_PERCENT + 50) // 100

    def _neutral(self, *, stale: bool) -> OutputState:
        return OutputState(
            self._config.steering_neutral_us,
            self._config.throttle_neutral_us,
            False,
            stale,
        )
