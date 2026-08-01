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


def transitions(commands: list[tuple[int, int]]) -> list[tuple[int, int]]:
    return [
        command
        for index, command in enumerate(commands)
        if index == 0 or command != commands[index - 1]
    ]


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

    def test_steering_profiles_use_full_standard_range_for_two_seconds(self) -> None:
        clock = FakeClock()
        output = FakeOutput()
        result = main(
            ["steer-left", "--dry-run"],
            output_factory=lambda _dry_run: output,
            clock=clock,
            sleeper=clock.sleep,
        )
        self.assertEqual(result, 0)
        self.assertIn((1000, 1500), output.commands)
        self.assertEqual(output.commands[-1], (1500, 1500))
        self.assertAlmostEqual(clock.now, 3.6)
        self.assertTrue(output.closed)

        clock = FakeClock()
        output = FakeOutput()
        result = main(
            ["steer-right", "--dry-run"],
            output_factory=lambda _dry_run: output,
            clock=clock,
            sleeper=clock.sleep,
        )
        self.assertEqual(result, 0)
        self.assertIn((2000, 1500), output.commands)
        self.assertEqual(output.commands[-1], (1500, 1500))
        self.assertAlmostEqual(clock.now, 3.6)
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
        self.assertIn((1500, 1750), output.commands)
        self.assertEqual(output.commands[-1], (1500, 1500))
        self.assertAlmostEqual(clock.now, 6.1)
        self.assertTrue(output.closed)

    def test_motor_reverse_releases_brake_then_requests_reverse_for_two_seconds(self) -> None:
        clock = FakeClock()
        output = FakeOutput()
        result = main(
            ["motor-reverse", "--dry-run"],
            output_factory=lambda _dry_run: output,
            clock=clock,
            sleeper=clock.sleep,
        )
        self.assertEqual(result, 0)
        self.assertEqual(
            transitions(output.commands),
            [
                (1500, 1500),
                (1500, 1250),
                (1500, 1500),
                (1500, 1250),
                (1500, 1500),
            ],
        )
        self.assertEqual(output.commands[-1], (1500, 1500))
        self.assertAlmostEqual(clock.now, 6.9)
        self.assertTrue(output.closed)


if __name__ == "__main__":
    unittest.main()
