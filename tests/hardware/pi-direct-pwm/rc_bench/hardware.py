from __future__ import annotations

from typing import Any


class LgpioPulseOutput:
    def __init__(
        self,
        lgpio_module: Any,
        *,
        chip: int,
        steering_gpio: int,
        throttle_gpio: int,
    ) -> None:
        self._lgpio = lgpio_module
        self._steering_gpio = steering_gpio
        self._throttle_gpio = throttle_gpio
        self._handle = self._check(lgpio_module.gpiochip_open(chip), "open gpiochip")
        self._claimed: list[int] = []
        try:
            for gpio in (steering_gpio, throttle_gpio):
                self._check(
                    lgpio_module.gpio_claim_output(self._handle, gpio, 0),
                    f"claim GPIO {gpio}",
                )
                self._claimed.append(gpio)
        except Exception:
            self.close()
            raise

    def apply(self, steering_us: int, throttle_us: int) -> None:
        if self._handle is None:
            raise RuntimeError("GPIO output is already closed")
        try:
            self._servo(self._steering_gpio, steering_us)
            self._servo(self._throttle_gpio, throttle_us)
        except Exception:
            self._stop_pulses()
            raise

    def close(self) -> None:
        if self._handle is None:
            return
        stop_error: Exception | None = None
        try:
            self._stop_pulses()
        except Exception as error:
            stop_error = error
        finally:
            for gpio in reversed(self._claimed):
                self._lgpio.gpio_free(self._handle, gpio)
            self._claimed.clear()
            self._lgpio.gpiochip_close(self._handle)
            self._handle = None
        if stop_error is not None:
            raise stop_error

    def _servo(self, gpio: int, pulse_width: int) -> None:
        if self._handle is None:
            raise RuntimeError("GPIO output is already closed")
        self._check(
            self._lgpio.tx_servo(self._handle, gpio, pulse_width, 50, 0, 0),
            f"send servo pulse on GPIO {gpio}",
        )

    def _stop_pulses(self) -> None:
        if self._handle is None:
            return
        first_error: Exception | None = None
        for gpio in (self._steering_gpio, self._throttle_gpio):
            try:
                self._check(
                    self._lgpio.tx_pwm(self._handle, gpio, 50, 0, 0, 0),
                    f"stop PWM on GPIO {gpio}",
                )
            except Exception as error:
                if first_error is None:
                    first_error = error
        if first_error is not None:
            raise first_error

    @staticmethod
    def _check(result: int, operation: str) -> int:
        if result < 0:
            raise OSError(f"lgpio failed to {operation}: error {result}")
        return result
