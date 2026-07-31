from __future__ import annotations

import unittest

from rc_bench.hardware import LgpioPulseOutput


class FakeLgpio:
    def __init__(self) -> None:
        self.calls: list[tuple[object, ...]] = []
        self.tx_result = 0
        self.pwm_result = 0

    def gpiochip_open(self, chip: int) -> int:
        self.calls.append(("open", chip))
        return 7

    def gpio_claim_output(self, handle: int, gpio: int, level: int) -> int:
        self.calls.append(("claim", handle, gpio, level))
        return 0

    def tx_servo(
        self,
        handle: int,
        gpio: int,
        pulse_width: int,
        frequency: int,
        offset: int,
        cycles: int,
    ) -> int:
        self.calls.append(
            ("servo", handle, gpio, pulse_width, frequency, offset, cycles)
        )
        return self.tx_result

    def gpio_free(self, handle: int, gpio: int) -> int:
        self.calls.append(("free", handle, gpio))
        return 0

    def tx_pwm(
        self,
        handle: int,
        gpio: int,
        frequency: int,
        duty_cycle: int,
        offset: int,
        cycles: int,
    ) -> int:
        self.calls.append(
            ("pwm", handle, gpio, frequency, duty_cycle, offset, cycles)
        )
        return self.pwm_result

    def gpiochip_close(self, handle: int) -> int:
        self.calls.append(("close", handle))
        return 0


class LgpioPulseOutputTests(unittest.TestCase):
    def test_claims_only_the_configured_signal_gpio(self) -> None:
        lgpio = FakeLgpio()
        output = LgpioPulseOutput(lgpio, chip=0, steering_gpio=18, throttle_gpio=19)
        self.assertEqual(
            lgpio.calls,
            [
                ("open", 0),
                ("claim", 7, 18, 0),
                ("claim", 7, 19, 0),
            ],
        )
        output.close()

    def test_applies_50_hz_servo_pulses_to_both_channels(self) -> None:
        lgpio = FakeLgpio()
        output = LgpioPulseOutput(lgpio, chip=0, steering_gpio=18, throttle_gpio=19)
        output.apply(1440, 1550)
        self.assertIn(("servo", 7, 18, 1440, 50, 0, 0), lgpio.calls)
        self.assertIn(("servo", 7, 19, 1550, 50, 0, 0), lgpio.calls)
        output.close()

    def test_negative_lgpio_result_is_reported(self) -> None:
        lgpio = FakeLgpio()
        output = LgpioPulseOutput(lgpio, chip=0, steering_gpio=18, throttle_gpio=19)
        lgpio.tx_result = -5
        with self.assertRaisesRegex(OSError, "lgpio"):
            output.apply(1500, 1500)
        output.close()

    def test_close_stops_pulses_before_releasing_gpio(self) -> None:
        lgpio = FakeLgpio()
        output = LgpioPulseOutput(lgpio, chip=0, steering_gpio=18, throttle_gpio=19)
        output.close()
        stop_calls = [call for call in lgpio.calls if call[0] == "pwm"]
        self.assertEqual(
            stop_calls,
            [
                ("pwm", 7, 18, 50, 0, 0, 0),
                ("pwm", 7, 19, 50, 0, 0, 0),
            ],
        )
        self.assertEqual(lgpio.calls[-1], ("close", 7))

    def test_close_releases_gpio_even_if_stopping_pwm_fails(self) -> None:
        lgpio = FakeLgpio()
        output = LgpioPulseOutput(lgpio, chip=0, steering_gpio=18, throttle_gpio=19)
        lgpio.pwm_result = -5
        with self.assertRaisesRegex(OSError, "stop PWM"):
            output.close()
        self.assertIn(("free", 7, 18), lgpio.calls)
        self.assertIn(("free", 7, 19), lgpio.calls)
        self.assertEqual(lgpio.calls[-1], ("close", 7))


if __name__ == "__main__":
    unittest.main()
