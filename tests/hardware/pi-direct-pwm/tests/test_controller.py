from __future__ import annotations

import unittest

from rc_bench.controller import BenchController, SafetyLimits


class FakeClock:
    def __init__(self) -> None:
        self.now = 10.0

    def __call__(self) -> float:
        return self.now


class FakeOutput:
    def __init__(self) -> None:
        self.commands: list[tuple[int, int]] = []

    def apply(self, steering_us: int, throttle_us: int) -> None:
        self.commands.append((steering_us, throttle_us))


class BenchControllerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.clock = FakeClock()
        self.output = FakeOutput()
        self.limits = SafetyLimits(
            steering_neutral_us=1500,
            throttle_neutral_us=1500,
            steering_min_us=1400,
            steering_max_us=1600,
            throttle_min_us=1450,
            throttle_max_us=1550,
            watchdog_ms=250,
        )
        self.controller = BenchController(self.output, self.clock, self.limits)

    def test_initialization_applies_neutral_and_starts_disarmed(self) -> None:
        self.assertEqual(self.output.commands, [(1500, 1500)])
        self.assertFalse(self.controller.status().armed)

    def test_non_neutral_command_is_rejected_while_disarmed(self) -> None:
        with self.assertRaisesRegex(PermissionError, "arm"):
            self.controller.set_pulses(1450, 1500)
        self.assertEqual(self.output.commands[-1], (1500, 1500))

    def test_command_outside_bench_limits_is_rejected_and_neutralized(self) -> None:
        self.controller.arm()
        with self.assertRaisesRegex(ValueError, "limits"):
            self.controller.set_pulses(1399, 1500)
        self.assertEqual(self.output.commands[-1], (1500, 1500))
        self.assertFalse(self.controller.status().armed)

    def test_valid_command_sets_deadline(self) -> None:
        self.controller.arm()
        self.controller.set_pulses(1440, 1540)
        status = self.controller.status()
        self.assertTrue(status.armed)
        self.assertEqual((status.steering_us, status.throttle_us), (1440, 1540))
        self.assertAlmostEqual(status.deadline, 10.25)

    def test_watchdog_returns_neutral_and_disarms(self) -> None:
        self.controller.arm()
        self.controller.set_pulses(1450, 1550)
        self.clock.now = 10.251
        self.assertTrue(self.controller.expire_if_needed())
        self.assertEqual(self.output.commands[-1], (1500, 1500))
        self.assertFalse(self.controller.status().armed)

    def test_neutral_command_is_always_allowed_and_disarms(self) -> None:
        self.controller.arm()
        self.controller.set_pulses(1450, 1550)
        self.controller.neutral()
        self.assertEqual(self.output.commands[-1], (1500, 1500))
        self.assertFalse(self.controller.status().armed)


if __name__ == "__main__":
    unittest.main()
