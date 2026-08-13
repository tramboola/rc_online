from __future__ import annotations

import math
from dataclasses import dataclass


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


@dataclass(frozen=True, slots=True)
class LiveConfig:
    steering_left_us: int = 1000
    steering_neutral_us: int = 1500
    steering_right_us: int = 2000
    throttle_reverse_us: int = 1250
    throttle_neutral_us: int = 1500
    throttle_forward_us: int = 1750
    watchdog_s: float = 0.2
    reverse_brake_s: float = 0.06
    reverse_neutral_s: float = 0.06

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
        self._reverse_reentry_needs_neutral = False
        self._last_drive_direction: int | None = None

    def step(self, frame: InputFrame | None, now: float) -> OutputState:
        if frame is None or now - frame.received_at > self._config.watchdog_s:
            self._reset_motion()
            return self._neutral(stale=True)
        if not frame.armed:
            self._reset_motion()
            return self._neutral(stale=False)

        steering_us = {
            -1: self._config.steering_left_us,
            0: self._config.steering_neutral_us,
            1: self._config.steering_right_us,
        }[frame.steering]
        throttle_us = self._throttle(
            frame.throttle,
            frame.brake,
            frame.nitro,
            now,
        )
        return OutputState(
            steering_us=steering_us,
            throttle_us=throttle_us,
            armed=True,
            stale=False,
            reverse_phase=self._reverse_phase,
        )

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

    def _reset_motion(self) -> None:
        self._reset_reverse()
        self._reverse_reentry_needs_neutral = False
        self._last_drive_direction = None
