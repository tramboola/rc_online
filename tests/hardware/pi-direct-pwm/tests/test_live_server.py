from __future__ import annotations

import json
from pathlib import Path
import threading
import unittest
import urllib.error
import urllib.request

from rc_bench.live_server import CommandMailbox, LiveRuntime, build_parser, create_http_server


ROOT = Path(__file__).resolve().parents[1]


class FakePulseOutput:
    def __init__(self) -> None:
        self.applied: list[tuple[int, int]] = []
        self.closed = False

    def apply(self, steering_us: int, throttle_us: int) -> None:
        self.applied.append((steering_us, throttle_us))

    def close(self) -> None:
        self.closed = True


class LivePageTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.page = (ROOT / "web" / "live.html").read_text(encoding="utf-8")

    def test_page_uses_wasd_arrows_nitro_and_escape_without_space_or_brake(self) -> None:
        for token in ("KeyW", "ArrowUp", "KeyA", "ArrowLeft", "KeyS", "ArrowDown", "KeyD", "ArrowRight", "KeyN", "Escape"):
            self.assertIn(token, self.page)
        self.assertNotIn('"Space"', self.page)
        self.assertNotIn("BRAKE", self.page)
        self.assertNotIn("reverse_phase", self.page)
        self.assertIn("steering-trim", self.page)
        self.assertIn("steering_trim_percent", self.page)


class MailboxRuntimeTests(unittest.TestCase):
    def test_mailbox_preserves_direct_reverse_and_nitro(self) -> None:
        mailbox = CommandMailbox()
        reverse = mailbox.publish("browser-a", 1, True, 0, -1, nitro=False, now=1.0)
        self.assertEqual(reverse.throttle, -1)
        self.assertFalse(hasattr(reverse, "brake"))

    def test_runtime_applies_limited_reverse_then_watchdog_neutral(self) -> None:
        now = [2.0]
        mailbox = CommandMailbox()
        output = FakePulseOutput()
        runtime = LiveRuntime(mailbox, output, clock=lambda: now[0])
        mailbox.publish("browser-a", 1, True, 0, -1, now=now[0])
        state = runtime.tick()
        self.assertEqual(state.throttle_us, 1375)
        now[0] += 0.201
        state = runtime.tick()
        self.assertEqual((state.throttle_us, state.armed), (1500, False))
        self.assertNotIn("reverse_phase", runtime.status())
        runtime.close()

    def test_parser_has_no_reverse_timing_options(self) -> None:
        args = build_parser().parse_args([])
        self.assertFalse(hasattr(args, "reverse_brake_ms"))
        self.assertFalse(hasattr(args, "reverse_neutral_ms"))


class LiveHttpTests(unittest.TestCase):
    def setUp(self) -> None:
        self.mailbox = CommandMailbox()
        self.server = create_http_server(
            "127.0.0.1",
            0,
            mailbox=self.mailbox,
            token="test-token",
            ui_html="<!doctype html><title>Live bench</title>",
            status_provider=lambda: {"armed": False, "throttle_us": 1500},
        )
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        host, port = self.server.server_address
        self.url = f"http://{host}:{port}"

    def tearDown(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)

    def post(self, payload: dict[str, object]) -> tuple[int, dict[str, object]]:
        request = urllib.request.Request(
            self.url + "/api/control",
            data=json.dumps(payload).encode(),
            headers={"Content-Type": "application/json", "X-Bench-Token": "test-token"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=2) as response:
                return response.status, json.loads(response.read())
        except urllib.error.HTTPError as error:
            return error.code, json.loads(error.read())

    def test_direct_control_frame_is_accepted(self) -> None:
        status, response = self.post({"client_id": "browser-a", "sequence": 1, "armed": True, "steering": 0, "throttle": -1, "nitro": False, "steering_trim_percent": -12})
        self.assertEqual(status, 202)
        self.assertTrue(response["accepted"])
        self.assertEqual(self.mailbox.snapshot().throttle, -1)
        self.assertEqual(self.mailbox.snapshot().steering_trim_percent, -12)

    def test_brake_field_is_rejected(self) -> None:
        status, response = self.post({"client_id": "browser-a", "sequence": 1, "armed": True, "steering": 0, "throttle": 0, "nitro": False, "brake": False})
        self.assertEqual(status, 400)
        self.assertEqual(response["error"], "invalid_request")

    def test_invalid_or_unknown_trim_fields_are_rejected(self) -> None:
        for trim in (-21, 21, 1.5, True, None):
            with self.subTest(trim=trim):
                status, response = self.post({
                    "client_id": "browser-a",
                    "sequence": 1,
                    "armed": True,
                    "steering": 0,
                    "throttle": 0,
                    "nitro": False,
                    "steering_trim_percent": trim,
                })
                self.assertEqual(status, 400)
                self.assertEqual(response["error"], "invalid_request")

        status, response = self.post({
            "client_id": "browser-a",
            "sequence": 1,
            "armed": True,
            "steering": 0,
            "throttle": 0,
            "nitro": False,
            "steering_trim_percent": 0,
            "unknown": True,
        })
        self.assertEqual(status, 400)
        self.assertEqual(response["error"], "invalid_request")


if __name__ == "__main__":
    unittest.main()
