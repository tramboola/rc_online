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
        brake: bool = False,
        nitro: bool = False,
    ) -> InputFrame:
        return InputFrame(
            armed=armed,
            steering=steering,
            throttle=throttle,
            received_at=now,
            brake=brake,
            nitro=nitro,
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
        self.assertEqual((forward.steering_us, forward.throttle_us), (1500, 1658))

    def test_normal_forward_and_nitro_use_fixed_safe_pulses(self) -> None:
        normal = self.control.step(self.frame(2.0, throttle=1), now=2.0)
        nitro = self.control.step(
            self.frame(2.1, throttle=1, nitro=True),
            now=2.1,
        )

        self.assertEqual(normal.throttle_us, 1658)
        self.assertEqual(nitro.throttle_us, 1750)

    def test_nitro_without_forward_has_no_effect(self) -> None:
        neutral = self.control.step(self.frame(2.0, nitro=True), now=2.0)
        reverse_brake = self.control.step(
            self.frame(2.1, throttle=-1, nitro=True),
            now=2.1,
        )
        self.control.step(self.frame(2.161, throttle=-1, nitro=True), now=2.161)
        reverse_drive = self.control.step(
            self.frame(2.222, throttle=-1, nitro=True),
            now=2.222,
        )

        self.assertEqual(neutral.throttle_us, 1500)
        self.assertEqual((reverse_brake.throttle_us, reverse_brake.reverse_phase), (1250, "brake"))
        self.assertEqual((reverse_drive.throttle_us, reverse_drive.reverse_phase), (1342, "reverse"))

    def test_nitro_must_be_boolean(self) -> None:
        for value in (0, 1, "true", None):
            with self.subTest(value=value):
                with self.assertRaisesRegex(ValueError, "nitro"):
                    self.frame(2.0, nitro=value)

    def test_watchdog_neutralizes_after_200_milliseconds(self) -> None:
        active = self.control.step(self.frame(3.0, throttle=1), now=3.19)
        expired = self.control.step(self.frame(3.0, throttle=1), now=3.201)

        self.assertEqual(active.throttle_us, 1658)
        self.assertEqual((expired.steering_us, expired.throttle_us), (1500, 1500))
        self.assertTrue(expired.stale)
        self.assertFalse(expired.armed)

    def test_manual_brake_opposes_last_forward_and_preserves_steering(self) -> None:
        self.control.step(self.frame(3.0, throttle=1), now=3.0)
        braking = self.control.step(
            self.frame(3.01, steering=-1, throttle=1, brake=True, nitro=True),
            now=3.01,
        )

        self.assertEqual((braking.steering_us, braking.throttle_us), (1000, 1250))
        self.assertTrue(braking.armed)
        self.assertEqual(braking.reverse_phase, "idle")

    def test_manual_brake_opposes_completed_reverse_drive(self) -> None:
        self.control.step(self.frame(4.0, throttle=-1), now=4.0)
        self.control.step(self.frame(4.061, throttle=-1), now=4.061)
        reverse = self.control.step(self.frame(4.122, throttle=-1), now=4.122)
        braking = self.control.step(
            self.frame(4.13, throttle=-1, brake=True, nitro=True),
            now=4.13,
        )

        self.assertEqual((reverse.throttle_us, reverse.reverse_phase), (1342, "reverse"))
        self.assertEqual((braking.throttle_us, braking.reverse_phase), (1750, "idle"))

    def test_manual_brake_is_neutral_when_direction_is_unknown(self) -> None:
        braking = self.control.step(self.frame(5.0, brake=True), now=5.0)

        self.assertEqual(braking.throttle_us, 1500)

    def test_direction_persists_through_armed_neutral(self) -> None:
        self.control.step(self.frame(5.0, throttle=-1), now=5.0)
        self.control.step(self.frame(5.061, throttle=-1), now=5.061)
        self.control.step(self.frame(5.122, throttle=-1), now=5.122)
        self.control.step(self.frame(5.13, throttle=0), now=5.13)
        braking = self.control.step(self.frame(5.14, brake=True), now=5.14)

        self.assertEqual(braking.throttle_us, 1750)

    def test_disarm_and_watchdog_clear_remembered_direction(self) -> None:
        self.control.step(self.frame(6.0, throttle=1), now=6.0)
        self.control.step(self.frame(6.01, armed=False), now=6.01)
        after_disarm = self.control.step(self.frame(6.02, brake=True), now=6.02)

        self.control.step(self.frame(7.0, throttle=1), now=7.0)
        self.control.step(self.frame(7.0, throttle=1), now=7.201)
        after_watchdog = self.control.step(self.frame(7.21, brake=True), now=7.21)

        self.assertEqual(after_disarm.throttle_us, 1500)
        self.assertEqual(after_watchdog.throttle_us, 1500)

    def test_reverse_brake_phase_does_not_record_reverse_direction(self) -> None:
        automatic_brake = self.control.step(self.frame(8.0, throttle=-1), now=8.0)
        manual_brake = self.control.step(
            self.frame(8.01, throttle=-1, brake=True),
            now=8.01,
        )

        self.assertEqual((automatic_brake.throttle_us, automatic_brake.reverse_phase), (1250, "brake"))
        self.assertEqual(manual_brake.throttle_us, 1500)

    def test_releasing_brake_resumes_held_forward_with_current_nitro_state(self) -> None:
        self.control.step(self.frame(9.0, throttle=1), now=9.0)
        self.control.step(
            self.frame(9.01, throttle=1, brake=True, nitro=True),
            now=9.01,
        )
        resumed = self.control.step(
            self.frame(9.02, throttle=1, nitro=True),
            now=9.02,
        )

        self.assertEqual(resumed.throttle_us, 1750)

    def test_reverse_uses_sixty_millisecond_brake_and_neutral_phases(self) -> None:
        brake = self.control.step(self.frame(4.0, throttle=-1), now=4.0)
        still_braking = self.control.step(self.frame(4.059, throttle=-1), now=4.059)
        neutral = self.control.step(self.frame(4.061, throttle=-1), now=4.061)
        still_neutral = self.control.step(self.frame(4.12, throttle=-1), now=4.12)
        reverse = self.control.step(self.frame(4.122, throttle=-1), now=4.122)

        self.assertEqual((brake.throttle_us, brake.reverse_phase), (1250, "brake"))
        self.assertEqual((still_braking.throttle_us, still_braking.reverse_phase), (1250, "brake"))
        self.assertEqual((neutral.throttle_us, neutral.reverse_phase), (1500, "neutral"))
        self.assertEqual((still_neutral.throttle_us, still_neutral.reverse_phase), (1500, "neutral"))
        self.assertEqual((reverse.throttle_us, reverse.reverse_phase), (1342, "reverse"))

    def test_releasing_reverse_immediately_neutralizes_and_resets_sequence(self) -> None:
        self.control.step(self.frame(5.0, throttle=-1), now=5.0)
        released = self.control.step(self.frame(5.1, throttle=0), now=5.1)
        pressed_again = self.control.step(self.frame(5.2, throttle=-1), now=5.2)

        self.assertEqual((released.throttle_us, released.reverse_phase), (1500, "idle"))
        self.assertEqual((pressed_again.throttle_us, pressed_again.reverse_phase), (1250, "brake"))

    def test_reverse_after_forward_still_starts_with_full_handshake(self) -> None:
        self.control.step(self.frame(5.0, throttle=1), now=5.0)

        brake = self.control.step(self.frame(5.01, throttle=-1), now=5.01)
        neutral = self.control.step(self.frame(5.071, throttle=-1), now=5.071)
        reverse = self.control.step(self.frame(5.132, throttle=-1), now=5.132)

        self.assertEqual((brake.throttle_us, brake.reverse_phase), (1250, "brake"))
        self.assertEqual((neutral.throttle_us, neutral.reverse_phase), (1500, "neutral"))
        self.assertEqual((reverse.throttle_us, reverse.reverse_phase), (1342, "reverse"))

    def test_completed_reverse_reentry_after_ordinary_neutral_skips_handshake(self) -> None:
        self.control.step(self.frame(6.0, throttle=-1), now=6.0)
        self.control.step(self.frame(6.061, throttle=-1), now=6.061)
        self.control.step(self.frame(6.122, throttle=-1), now=6.122)

        neutral = self.control.step(self.frame(6.13, throttle=0), now=6.13)
        reverse = self.control.step(self.frame(6.14, throttle=-1), now=6.14)

        self.assertEqual((neutral.throttle_us, neutral.reverse_phase), (1500, "idle"))
        self.assertEqual((reverse.throttle_us, reverse.reverse_phase), (1342, "reverse"))

    def test_releasing_reverse_origin_brake_uses_only_neutral_before_reverse(self) -> None:
        self.control.step(self.frame(7.0, throttle=-1), now=7.0)
        self.control.step(self.frame(7.061, throttle=-1), now=7.061)
        self.control.step(self.frame(7.122, throttle=-1), now=7.122)

        braking = self.control.step(
            self.frame(7.13, throttle=-1, brake=True),
            now=7.13,
        )
        neutral = self.control.step(self.frame(7.14, throttle=-1), now=7.14)
        still_neutral = self.control.step(self.frame(7.199, throttle=-1), now=7.199)
        reverse = self.control.step(self.frame(7.201, throttle=-1), now=7.201)

        self.assertEqual((braking.throttle_us, braking.reverse_phase), (1750, "idle"))
        self.assertEqual((neutral.throttle_us, neutral.reverse_phase), (1500, "neutral"))
        self.assertEqual((still_neutral.throttle_us, still_neutral.reverse_phase), (1500, "neutral"))
        self.assertEqual((reverse.throttle_us, reverse.reverse_phase), (1342, "reverse"))
        self.assertNotIn(1250, (neutral.throttle_us, still_neutral.throttle_us, reverse.throttle_us))

    def test_invalid_normalized_axis_is_rejected(self) -> None:
        with self.assertRaisesRegex(ValueError, "steering"):
            InputFrame(True, steering=2, throttle=0, received_at=1.0)
        with self.assertRaisesRegex(ValueError, "throttle"):
            InputFrame(True, steering=0, throttle=-2, received_at=1.0)

    def test_brake_must_be_boolean(self) -> None:
        for value in (0, 1, "true", None):
            with self.subTest(value=value):
                with self.assertRaisesRegex(ValueError, "brake"):
                    self.frame(8.0, brake=value)


if __name__ == "__main__":
    unittest.main()
