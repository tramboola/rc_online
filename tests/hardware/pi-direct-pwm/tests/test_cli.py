from __future__ import annotations

import unittest

from rc_bench.cli import main


class FakeClock:
    def __init__(self) -> None:
        self.now = 1.0

    def __call__(self) -> float:
        return self.now

    def sleep(self, seconds: float) -> None:
        self.now += seconds


class FakeOutput:
    def __init__(self) -> None:
        self.commands: list[tuple[int, int]] = []
        self.closed = False

    def apply(self, steering_us: int, throttle_us: int) -> None:
        self.commands.append((steering_us, throttle_us))

    def close(self) -> None:
        self.closed = True


class CliTests(unittest.TestCase):
    def test_gpio_check_claims_and_releases_without_generating_a_pulse(self) -> None:
        clock = FakeClock()
        output = FakeOutput()
        result = main(
            ["gpio-check"],
            output_factory=lambda _dry_run: output,
            clock=clock,
            sleeper=clock.sleep,
        )
        self.assertEqual(result, 0)
        self.assertEqual(output.commands, [])
        self.assertTrue(output.closed)

    def test_steering_profile_uses_bounded_pulse_and_closes_gpio(self) -> None:
        clock = FakeClock()
        output = FakeOutput()
        result = main(
            ["steer-left", "--dry-run"],
            output_factory=lambda _dry_run: output,
            clock=clock,
            sleeper=clock.sleep,
        )
        self.assertEqual(result, 0)
        self.assertIn((1440, 1500), output.commands)
        self.assertEqual(output.commands[-1], (1500, 1500))
        self.assertTrue(output.closed)

    def test_motor_profile_runs_without_an_extra_confirmation_flag(self) -> None:
        clock = FakeClock()
        output = FakeOutput()
        result = main(
            ["motor-forward", "--dry-run"],
            output_factory=lambda _dry_run: output,
            clock=clock,
            sleeper=clock.sleep,
        )
        self.assertEqual(result, 0)
        self.assertIn((1500, 1550), output.commands)
        self.assertEqual(output.commands[-1], (1500, 1500))
        self.assertLessEqual(clock.now, 4.5)
        self.assertTrue(output.closed)


if __name__ == "__main__":
    unittest.main()
