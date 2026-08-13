from __future__ import annotations

import io
import json
import threading
import unittest
import urllib.error
import urllib.request
from contextlib import redirect_stderr
from pathlib import Path

from rc_bench.live_server import (
    ClientBusyError,
    CommandMailbox,
    LiveConfig,
    LiveRuntime,
    StaleSequenceError,
    build_parser,
    create_http_server,
    live_config_from_args,
)


class LivePageTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.page = (
            Path(__file__).resolve().parents[1] / "web" / "live.html"
        ).read_text(encoding="utf-8")

    def test_page_replaces_slider_with_nitro_indicator(self) -> None:
        self.assertNotIn('id="throttle-limit"', self.page)
        self.assertNotIn("throttle_limit_percent", self.page)
        self.assertIn('id="nitro-indicator"', self.page)
        self.assertIn('data-key="NITRO"', self.page)
        self.assertIn("NITRO", self.page)

    def test_page_sends_forward_only_nitro_state(self) -> None:
        self.assertIn('["KeyN", "NITRO"]', self.page)
        self.assertIn(
            'const nitro = forward && !reverse && !brake && pressed.has("NITRO")',
            self.page,
        )
        self.assertIn("nitro: armed && current.nitro", self.page)
        self.assertIn(
            "nitroIndicator.dataset.active = String(armed && current.nitro)",
            self.page,
        )

    def test_space_is_momentary_brake_and_escape_still_disarms(self) -> None:
        self.assertIn('["Space", "BRAKE"]', self.page)
        self.assertIn('if (event.code === "Escape")', self.page)
        self.assertNotIn(
            'if (event.code === "Space" || event.code === "Escape")',
            self.page,
        )
        self.assertIn("brake: armed && current.brake", self.page)

    def test_brake_has_local_priority_without_losing_throttle_key_state(self) -> None:
        self.assertIn('const brake = pressed.has("BRAKE")', self.page)
        self.assertIn("return {", self.page)
        self.assertIn("brake,", self.page)
        self.assertIn('current.brake\n    ? "BRAKE"', self.page)

    def test_visible_help_describes_fixed_power_nitro_and_brake(self) -> None:
        self.assertIn("63% forward", self.page)
        self.assertIn("N</strong> Nitro 100% with forward only", self.page)
        self.assertIn("reverse at 63%", self.page)
        self.assertIn("Space</strong> brake while held", self.page)
        self.assertIn("Esc</strong> emergency stop", self.page)


class CommandMailboxTests(unittest.TestCase):
    def test_accepts_monotonic_frames_from_one_client(self) -> None:
        mailbox = CommandMailbox(takeover_s=1.0)

        mailbox.publish("browser-a", 1, True, -1, 1, now=10.0)
        frame = mailbox.publish("browser-a", 2, True, 1, 0, now=10.1)

        self.assertEqual((frame.armed, frame.steering, frame.throttle), (True, 1, 0))
        self.assertEqual(mailbox.snapshot(), frame)

    def test_preserves_nitro_in_published_frame(self) -> None:
        mailbox = CommandMailbox()

        frame = mailbox.publish(
            "browser-a",
            1,
            True,
            0,
            1,
            nitro=True,
            now=12.0,
        )

        self.assertTrue(frame.nitro)

    def test_preserves_manual_brake_in_published_frame(self) -> None:
        mailbox = CommandMailbox()

        frame = mailbox.publish(
            "browser-a",
            1,
            True,
            0,
            1,
            brake=True,
            now=12.0,
        )

        self.assertTrue(frame.brake)

    def test_invalid_brake_does_not_replace_last_valid_frame(self) -> None:
        mailbox = CommandMailbox()
        mailbox.publish("browser-a", 1, True, 0, 0, brake=True, now=12.0)

        with self.assertRaisesRegex(ValueError, "brake"):
            mailbox.publish("browser-a", 2, True, 0, 1, brake=1, now=12.1)

        self.assertTrue(mailbox.snapshot().brake)

    def test_invalid_nitro_does_not_replace_last_valid_frame(self) -> None:
        mailbox = CommandMailbox()
        mailbox.publish("browser-a", 1, True, 0, 0, nitro=True, now=12.0)

        with self.assertRaisesRegex(ValueError, "nitro"):
            mailbox.publish("browser-a", 2, True, 0, 1, nitro=1, now=12.1)

        self.assertTrue(mailbox.snapshot().nitro)

    def test_rejects_stale_sequence_from_owner(self) -> None:
        mailbox = CommandMailbox(takeover_s=1.0)
        mailbox.publish("browser-a", 5, True, 0, 0, now=20.0)

        with self.assertRaises(StaleSequenceError):
            mailbox.publish("browser-a", 5, True, 1, 0, now=20.1)

        self.assertEqual(mailbox.snapshot().steering, 0)

    def test_second_client_waits_until_owner_is_stale(self) -> None:
        mailbox = CommandMailbox(takeover_s=1.0)
        mailbox.publish("browser-a", 1, True, 0, 0, now=30.0)

        with self.assertRaises(ClientBusyError):
            mailbox.publish("browser-b", 1, True, 0, 1, now=30.9)

        takeover = mailbox.publish("browser-b", 1, False, 0, 0, now=31.01)
        self.assertFalse(takeover.armed)
        self.assertEqual(mailbox.owner, "browser-b")


class FakePulseOutput:
    def __init__(self) -> None:
        self.applied: list[tuple[int, int]] = []
        self.closed = False

    def apply(self, steering_us: int, throttle_us: int) -> None:
        self.applied.append((steering_us, throttle_us))

    def close(self) -> None:
        self.closed = True


class LiveCliTests(unittest.TestCase):
    def test_reverse_timing_defaults_to_sixty_milliseconds(self) -> None:
        args = build_parser().parse_args([])
        config = live_config_from_args(args)

        self.assertEqual(args.reverse_brake_ms, 60)
        self.assertEqual(args.reverse_neutral_ms, 60)
        self.assertEqual(config.reverse_brake_s, 0.06)
        self.assertEqual(config.reverse_neutral_s, 0.06)

    def test_reverse_timing_accepts_bounded_overrides(self) -> None:
        args = build_parser().parse_args(
            ["--reverse-brake-ms", "120", "--reverse-neutral-ms", "80"]
        )
        config = live_config_from_args(args)

        self.assertEqual(config.reverse_brake_s, 0.12)
        self.assertEqual(config.reverse_neutral_s, 0.08)

    def test_reverse_timing_rejects_values_outside_twenty_to_one_thousand(self) -> None:
        for option, value in (
            ("--reverse-brake-ms", "19"),
            ("--reverse-brake-ms", "1001"),
            ("--reverse-neutral-ms", "0"),
        ):
            with self.subTest(option=option, value=value):
                with redirect_stderr(io.StringIO()):
                    with self.assertRaises(SystemExit):
                        build_parser().parse_args([option, value])


class LiveRuntimeTests(unittest.TestCase):
    def test_applies_command_then_watchdog_returns_to_neutral(self) -> None:
        now = [100.0]
        mailbox = CommandMailbox()
        output = FakePulseOutput()
        runtime = LiveRuntime(mailbox, output, clock=lambda: now[0])

        runtime.tick()
        mailbox.publish("browser-a", 1, True, -1, 1, now=now[0])
        runtime.tick()
        now[0] += 0.201
        state = runtime.tick()

        self.assertEqual(
            output.applied,
            [(1500, 1500), (1000, 1658), (1500, 1500)],
        )
        self.assertFalse(state.armed)
        self.assertTrue(state.stale)

        runtime.close()
        self.assertEqual(output.applied[-1], (1500, 1500))
        self.assertTrue(output.closed)

    def test_runtime_uses_injected_reverse_timing(self) -> None:
        now = [200.0]
        mailbox = CommandMailbox()
        output = FakePulseOutput()
        runtime = LiveRuntime(
            mailbox,
            output,
            clock=lambda: now[0],
            config=LiveConfig(reverse_brake_s=0.1, reverse_neutral_s=0.1),
        )

        mailbox.publish("browser-a", 1, True, 0, -1, now=now[0])
        runtime.tick()
        now[0] += 0.061
        mailbox.publish("browser-a", 2, True, 0, -1, now=now[0])
        state = runtime.tick()

        self.assertEqual((state.throttle_us, state.reverse_phase), (1250, "brake"))
        runtime.close()


class LiveHttpTests(unittest.TestCase):
    def setUp(self) -> None:
        self.mailbox = CommandMailbox(takeover_s=1.0)
        self.server = create_http_server(
            "127.0.0.1",
            0,
            mailbox=self.mailbox,
            token="test-token",
            ui_html="<!doctype html><title>Level 2</title><main>Live bench</main>",
            status_provider=lambda: {
                "armed": False,
                "stale": True,
                "steering_us": 1500,
                "throttle_us": 1500,
                "reverse_phase": "idle",
            },
        )
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        host, port = self.server.server_address
        self.base_url = f"http://{host}:{port}"

    def tearDown(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)

    def request(
        self,
        path: str,
        *,
        method: str = "GET",
        payload: dict[str, object] | None = None,
        token: str | None = "test-token",
    ) -> tuple[int, dict[str, object] | str]:
        body = None if payload is None else json.dumps(payload).encode("utf-8")
        headers = {"Content-Type": "application/json"}
        if token is not None:
            headers["X-Bench-Token"] = token
        request = urllib.request.Request(
            self.base_url + path,
            data=body,
            headers=headers,
            method=method,
        )
        try:
            with urllib.request.urlopen(request, timeout=2) as response:
                content = response.read().decode("utf-8")
                if response.headers.get_content_type() == "application/json":
                    return response.status, json.loads(content)
                return response.status, content
        except urllib.error.HTTPError as error:
            content = error.read().decode("utf-8")
            return error.code, json.loads(content)

    def test_page_loads_but_api_requires_token(self) -> None:
        status, page = self.request("/", token=None)
        denied, error = self.request("/api/state", token=None)

        self.assertEqual(status, 200)
        self.assertIn("Level 2", page)
        self.assertEqual(denied, 403)
        self.assertEqual(error["error"], "forbidden")

    def test_valid_control_frame_is_accepted_and_visible_in_mailbox(self) -> None:
        status, response = self.request(
            "/api/control",
            method="POST",
            payload={
                "client_id": "browser-a",
                "sequence": 1,
                "armed": True,
                "steering": -1,
                "throttle": 1,
                "nitro": True,
            },
        )

        self.assertEqual(status, 202)
        self.assertTrue(response["accepted"])
        frame = self.mailbox.snapshot()
        self.assertIsNotNone(frame)
        self.assertEqual((frame.steering, frame.throttle), (-1, 1))
        self.assertTrue(frame.nitro)

    def test_missing_nitro_defaults_to_false_and_legacy_limit_is_ignored(self) -> None:
        status, _response = self.request(
            "/api/control",
            method="POST",
            payload={
                "client_id": "browser-a",
                "sequence": 1,
                "armed": True,
                "steering": 0,
                "throttle": 1,
                "throttle_limit_percent": 100,
            },
        )

        self.assertEqual(status, 202)
        self.assertFalse(self.mailbox.snapshot().nitro)

    def test_control_frame_carries_manual_brake(self) -> None:
        status, response = self.request(
            "/api/control",
            method="POST",
            payload={
                "client_id": "browser-a",
                "sequence": 1,
                "armed": True,
                "steering": -1,
                "throttle": 1,
                "brake": True,
            },
        )

        self.assertEqual(status, 202)
        self.assertTrue(response["accepted"])
        self.assertTrue(self.mailbox.snapshot().brake)

    def test_missing_brake_defaults_to_false(self) -> None:
        status, _response = self.request(
            "/api/control",
            method="POST",
            payload={
                "client_id": "browser-a",
                "sequence": 1,
                "armed": True,
                "steering": 0,
                "throttle": 0,
            },
        )

        self.assertEqual(status, 202)
        self.assertFalse(self.mailbox.snapshot().brake)

    def test_non_boolean_brake_is_rejected_without_replacing_frame(self) -> None:
        self.request(
            "/api/control",
            method="POST",
            payload={
                "client_id": "browser-a",
                "sequence": 1,
                "armed": True,
                "steering": 0,
                "throttle": 0,
                "brake": True,
            },
        )
        status, error = self.request(
            "/api/control",
            method="POST",
            payload={
                "client_id": "browser-a",
                "sequence": 2,
                "armed": True,
                "steering": 0,
                "throttle": 0,
                "brake": 1,
            },
        )

        self.assertEqual(status, 400)
        self.assertEqual(error["error"], "invalid_request")
        self.assertTrue(self.mailbox.snapshot().brake)

    def test_non_boolean_nitro_is_rejected_without_replacing_frame(self) -> None:
        self.request(
            "/api/control",
            method="POST",
            payload={
                "client_id": "browser-a",
                "sequence": 1,
                "armed": True,
                "steering": 0,
                "throttle": 1,
                "nitro": True,
            },
        )

        status, error = self.request(
            "/api/control",
            method="POST",
            payload={
                "client_id": "browser-a",
                "sequence": 2,
                "armed": True,
                "steering": 0,
                "throttle": 1,
                "nitro": 1,
            },
        )

        self.assertEqual(status, 400)
        self.assertEqual(error["error"], "invalid_request")
        self.assertTrue(self.mailbox.snapshot().nitro)

    def test_invalid_axis_is_rejected_without_replacing_last_frame(self) -> None:
        self.request(
            "/api/control",
            method="POST",
            payload={
                "client_id": "browser-a",
                "sequence": 1,
                "armed": False,
                "steering": 0,
                "throttle": 0,
            },
        )
        status, error = self.request(
            "/api/control",
            method="POST",
            payload={
                "client_id": "browser-a",
                "sequence": 2,
                "armed": True,
                "steering": 9,
                "throttle": 0,
            },
        )

        self.assertEqual(status, 400)
        self.assertEqual(error["error"], "invalid_request")
        self.assertFalse(self.mailbox.snapshot().armed)


if __name__ == "__main__":
    unittest.main()
