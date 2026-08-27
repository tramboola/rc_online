from __future__ import annotations

import unittest

from rc_bench.live_control import InputFrame, LiveConfig, LiveControl, OutputState


class LiveControlTests(unittest.TestCase):
    def setUp(self) -> None:
        self.control = LiveControl()

    @staticmethod
    def frame(now: float, *, armed: bool = True, steering: int = 0, throttle: int = 0, nitro: bool = False, steering_trim_percent: int = 0) -> InputFrame:
        return InputFrame(
            armed,
            steering,
            throttle,
            now,
            nitro=nitro,
            steering_trim_percent=steering_trim_percent,
        )

    def test_forward_uses_normal_limit_and_nitro_uses_full_endpoint(self) -> None:
        normal = self.control.step(self.frame(1.0, throttle=1), now=1.0)
        nitro = self.control.step(self.frame(1.01, throttle=1, nitro=True), now=1.01)
        self.assertEqual(normal.throttle_us, 1658)
        self.assertEqual(nitro.throttle_us, 1750)

    def test_reverse_is_limited_to_fifty_percent_and_release_is_immediately_neutral(self) -> None:
        reverse = self.control.step(self.frame(2.0, throttle=-1), now=2.0)
        neutral = self.control.step(self.frame(2.01, throttle=0), now=2.01)
        reverse_again = self.control.step(self.frame(2.02, throttle=-1), now=2.02)
        self.assertEqual(reverse.throttle_us, 1375)
        self.assertEqual(neutral.throttle_us, 1500)
        self.assertEqual(reverse_again.throttle_us, 1375)

    def test_reverse_limit_uses_the_calibrated_reverse_span(self) -> None:
        control = LiveControl(LiveConfig(
            throttle_reverse_us=1200,
            throttle_neutral_us=1500,
            throttle_forward_us=1800,
        ))
        reverse = control.step(self.frame(2.1, throttle=-1), now=2.1)
        self.assertEqual(reverse.throttle_us, 1350)

    def test_opposing_or_missing_command_is_neutral(self) -> None:
        self.assertEqual(
            self.control.step(None, now=3.0),
            OutputState(1500, 1500, False, True),
        )

    def test_trim_offsets_only_the_armed_center_position(self) -> None:
        for trim, want_us in ((-20, 1400), (0, 1500), (20, 1600)):
            centered = self.control.step(
                self.frame(3.1, steering_trim_percent=trim),
                now=3.1,
            )
            full_right = self.control.step(
                self.frame(3.1, steering=1, steering_trim_percent=trim),
                now=3.1,
            )
            self.assertEqual(centered.steering_us, want_us)
            self.assertEqual(full_right.steering_us, 2000)

    def test_trim_uses_each_calibrated_side_span(self) -> None:
        control = LiveControl(LiveConfig(
            steering_left_us=1100,
            steering_neutral_us=1475,
            steering_right_us=2050,
        ))
        left = control.step(self.frame(3.2, steering_trim_percent=-20), now=3.2)
        right = control.step(self.frame(3.2, steering_trim_percent=20), now=3.2)
        self.assertEqual(left.steering_us, 1400)
        self.assertEqual(right.steering_us, 1590)

    def test_watchdog_and_disarm_fail_neutral(self) -> None:
        stale = self.control.step(self.frame(4.0, throttle=1), now=4.201)
        disarmed = self.control.step(self.frame(4.3, armed=False, throttle=1), now=4.3)
        self.assertEqual((stale.throttle_us, stale.armed, stale.stale), (1500, False, True))
        self.assertEqual((disarmed.throttle_us, disarmed.armed), (1500, False))
        self.assertEqual(stale.steering_us, 1500)
        self.assertEqual(disarmed.steering_us, 1500)

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
