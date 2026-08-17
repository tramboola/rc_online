from __future__ import annotations

import unittest

from rc_bench.live_control import InputFrame, LiveConfig, LiveControl, OutputState


class LiveControlTests(unittest.TestCase):
    def setUp(self) -> None:
        self.control = LiveControl()

    @staticmethod
    def frame(now: float, *, armed: bool = True, steering: int = 0, throttle: int = 0, nitro: bool = False) -> InputFrame:
        return InputFrame(armed, steering, throttle, now, nitro=nitro)

    def test_forward_uses_normal_limit_and_nitro_uses_full_endpoint(self) -> None:
        normal = self.control.step(self.frame(1.0, throttle=1), now=1.0)
        nitro = self.control.step(self.frame(1.01, throttle=1, nitro=True), now=1.01)
        self.assertEqual(normal.throttle_us, 1658)
        self.assertEqual(nitro.throttle_us, 1750)

    def test_reverse_is_direct_and_release_is_immediately_neutral(self) -> None:
        reverse = self.control.step(self.frame(2.0, throttle=-1), now=2.0)
        neutral = self.control.step(self.frame(2.01, throttle=0), now=2.01)
        reverse_again = self.control.step(self.frame(2.02, throttle=-1), now=2.02)
        self.assertEqual(reverse.throttle_us, 1250)
        self.assertEqual(neutral.throttle_us, 1500)
        self.assertEqual(reverse_again.throttle_us, 1250)

    def test_opposing_or_missing_command_is_neutral(self) -> None:
        self.assertEqual(
            self.control.step(None, now=3.0),
            OutputState(1500, 1500, False, True),
        )

    def test_watchdog_and_disarm_fail_neutral(self) -> None:
        stale = self.control.step(self.frame(4.0, throttle=1), now=4.201)
        disarmed = self.control.step(self.frame(4.3, armed=False, throttle=1), now=4.3)
        self.assertEqual((stale.throttle_us, stale.armed, stale.stale), (1500, False, True))
        self.assertEqual((disarmed.throttle_us, disarmed.armed), (1500, False))

    def test_axes_and_nitro_types_are_validated(self) -> None:
        for steering, throttle in ((-2, 0), (2, 0), (0, -2), (0, 2)):
            with self.assertRaises(ValueError):
                self.frame(5.0, steering=steering, throttle=throttle)
        with self.assertRaisesRegex(ValueError, "nitro"):
            InputFrame(True, 0, 0, 5.0, nitro=1)  # type: ignore[arg-type]

    def test_config_has_no_reverse_timing(self) -> None:
        config = LiveConfig()
        self.assertFalse(hasattr(config, "reverse_brake_s"))
        self.assertFalse(hasattr(config, "reverse_neutral_s"))


if __name__ == "__main__":
    unittest.main()
