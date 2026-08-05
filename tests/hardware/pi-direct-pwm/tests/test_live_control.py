from __future__ import annotations

import unittest

from rc_bench.live_control import InputFrame, LiveConfig, LiveControl


class LiveControlTests(unittest.TestCase):
    def setUp(self) -> None:
        self.config = LiveConfig()
        self.control = LiveControl(self.config)

    def frame(
        self,
        now: float,
        *,
        armed: bool = True,
        steering: int = 0,
        throttle: int = 0,
        throttle_limit_percent: int = 100,
    ) -> InputFrame:
        return InputFrame(
            armed=armed,
            steering=steering,
            throttle=throttle,
            received_at=now,
            throttle_limit_percent=throttle_limit_percent,
        )

    def test_disarmed_or_missing_input_is_neutral(self) -> None:
        missing = self.control.step(None, now=1.0)
        disarmed = self.control.step(self.frame(1.1, armed=False), now=1.1)

        self.assertEqual((missing.steering_us, missing.throttle_us), (1500, 1500))
        self.assertTrue(missing.stale)
        self.assertEqual((disarmed.steering_us, disarmed.throttle_us), (1500, 1500))
        self.assertFalse(disarmed.armed)

    def test_full_steering_and_forward_map_to_literal_safe_pulses(self) -> None:
        left = self.control.step(self.frame(2.0, steering=-1), now=2.0)
        right = self.control.step(self.frame(2.1, steering=1), now=2.1)
        forward = self.control.step(self.frame(2.2, throttle=1), now=2.2)

        self.assertEqual((left.steering_us, left.throttle_us), (1000, 1500))
        self.assertEqual((right.steering_us, right.throttle_us), (2000, 1500))
        self.assertEqual((forward.steering_us, forward.throttle_us), (1500, 1750))

    def test_watchdog_neutralizes_after_200_milliseconds(self) -> None:
        active = self.control.step(self.frame(3.0, throttle=1), now=3.19)
        expired = self.control.step(self.frame(3.0, throttle=1), now=3.201)

        self.assertEqual(active.throttle_us, 1750)
        self.assertEqual((expired.steering_us, expired.throttle_us), (1500, 1500))
        self.assertTrue(expired.stale)
        self.assertFalse(expired.armed)

    def test_reverse_runs_brake_neutral_reverse_while_key_is_held(self) -> None:
        brake = self.control.step(self.frame(4.0, throttle=-1), now=4.0)
        still_braking = self.control.step(self.frame(4.29, throttle=-1), now=4.29)
        neutral = self.control.step(self.frame(4.31, throttle=-1), now=4.31)
        reverse = self.control.step(self.frame(4.82, throttle=-1), now=4.82)

        self.assertEqual((brake.throttle_us, brake.reverse_phase), (1250, "brake"))
        self.assertEqual((still_braking.throttle_us, still_braking.reverse_phase), (1250, "brake"))
        self.assertEqual((neutral.throttle_us, neutral.reverse_phase), (1500, "neutral"))
        self.assertEqual((reverse.throttle_us, reverse.reverse_phase), (1250, "reverse"))

    def test_releasing_reverse_immediately_neutralizes_and_resets_sequence(self) -> None:
        self.control.step(self.frame(5.0, throttle=-1), now=5.0)
        released = self.control.step(self.frame(5.1, throttle=0), now=5.1)
        pressed_again = self.control.step(self.frame(5.2, throttle=-1), now=5.2)

        self.assertEqual((released.throttle_us, released.reverse_phase), (1500, "idle"))
        self.assertEqual((pressed_again.throttle_us, pressed_again.reverse_phase), (1250, "brake"))

    def test_throttle_limit_scales_forward_and_reverse_symmetrically(self) -> None:
        forward = self.control.step(
            self.frame(6.0, throttle=1, throttle_limit_percent=10), now=6.0
        )
        reverse = self.control.step(
            self.frame(6.1, throttle=-1, throttle_limit_percent=10), now=6.1
        )

        self.assertEqual(forward.throttle_us, 1525)
        self.assertEqual((reverse.throttle_us, reverse.reverse_phase), (1475, "brake"))

    def test_throttle_limit_rounds_half_microseconds_away_from_neutral(self) -> None:
        forward = self.control.step(
            self.frame(7.0, throttle=1, throttle_limit_percent=33), now=7.0
        )
        reverse = self.control.step(
            self.frame(7.1, throttle=-1, throttle_limit_percent=33), now=7.1
        )

        self.assertEqual(forward.throttle_us, 1583)
        self.assertEqual(reverse.throttle_us, 1417)

    def test_throttle_limit_preserves_neutral_and_default_endpoints(self) -> None:
        neutral = self.control.step(
            self.frame(8.0, throttle=0, throttle_limit_percent=10), now=8.0
        )
        forward = self.control.step(self.frame(8.1, throttle=1), now=8.1)

        self.assertEqual(neutral.throttle_us, 1500)
        self.assertEqual(forward.throttle_us, 1750)

    def test_invalid_throttle_limit_is_rejected(self) -> None:
        for value in (True, 9, 101, 10.5):
            with self.subTest(value=value):
                with self.assertRaisesRegex(ValueError, "throttle_limit_percent"):
                    InputFrame(
                        True,
                        steering=0,
                        throttle=0,
                        received_at=1.0,
                        throttle_limit_percent=value,
                    )

    def test_invalid_normalized_axis_is_rejected(self) -> None:
        with self.assertRaisesRegex(ValueError, "steering"):
            InputFrame(True, steering=2, throttle=0, received_at=1.0)
        with self.assertRaisesRegex(ValueError, "throttle"):
            InputFrame(True, steering=0, throttle=-2, received_at=1.0)


if __name__ == "__main__":
    unittest.main()
