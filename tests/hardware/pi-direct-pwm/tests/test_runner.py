from __future__ import annotations

import unittest

from rc_bench.controller import SafetyLimits
from rc_bench.runner import TestCommand, execute_test


class FakeClock:
    def __init__(self) -> None:
        self.now = 5.0

    def __call__(self) -> float:
        return self.now

    def sleep(self, seconds: float) -> None:
        self.now += seconds


class FakeOutput:
    def __init__(self) -> None:
        self.commands: list[tuple[int, int]] = []

    def apply(self, steering_us: int, throttle_us: int) -> None:
        self.commands.append((steering_us, throttle_us))


LIMITS = SafetyLimits(
    steering_neutral_us=1500,
    throttle_neutral_us=1500,
    steering_min_us=1400,
    steering_max_us=1600,
    throttle_min_us=1450,
    throttle_max_us=1550,
    watchdog_ms=250,
)


class TestCommandTests(unittest.TestCase):
    def test_rejects_a_test_longer_than_two_seconds(self) -> None:
        with self.assertRaisesRegex(ValueError, "duration"):
            TestCommand(1500, 1550, duration_s=2.01, settle_s=0)

    def test_rejects_a_settle_time_longer_than_five_seconds(self) -> None:
        with self.assertRaisesRegex(ValueError, "settle"):
            TestCommand(1500, 1500, duration_s=0.5, settle_s=5.01)


class ExecuteTestTests(unittest.TestCase):
    def test_refreshes_command_before_watchdog_and_finishes_in_neutral(self) -> None:
        clock = FakeClock()
        output = FakeOutput()
        execute_test(
            output,
            clock,
            clock.sleep,
            LIMITS,
            TestCommand(1440, 1500, duration_s=0.35, settle_s=0.1),
        )
        self.assertEqual(output.commands[0], (1500, 1500))
        self.assertIn((1440, 1500), output.commands)
        self.assertEqual(output.commands[-1], (1500, 1500))
        self.assertGreaterEqual(output.commands.count((1440, 1500)), 2)

    def test_exception_during_test_still_finishes_in_neutral(self) -> None:
        clock = FakeClock()
        output = FakeOutput()

        def failing_sleep(seconds: float) -> None:
            clock.now += seconds
            raise RuntimeError("interrupted")

        with self.assertRaisesRegex(RuntimeError, "interrupted"):
            execute_test(
                output,
                clock,
                failing_sleep,
                LIMITS,
                TestCommand(1500, 1550, duration_s=0.4, settle_s=0),
            )
        self.assertEqual(output.commands[-1], (1500, 1500))


if __name__ == "__main__":
    unittest.main()
