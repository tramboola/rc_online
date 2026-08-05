from __future__ import annotations

import json
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path

from rc_bench.live_server import (
    ClientBusyError,
    CommandMailbox,
    LiveRuntime,
    StaleSequenceError,
    create_http_server,
)


class LivePageTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.page = (
            Path(__file__).resolve().parents[1] / "web" / "live.html"
        ).read_text(encoding="utf-8")

    def test_page_exposes_safe_throttle_limit_slider(self) -> None:
        self.assertIn('id="throttle-limit"', self.page)
        self.assertIn('min="10"', self.page)
        self.assertIn('max="100"', self.page)
        self.assertIn('step="1"', self.page)
        self.assertIn('value="100"', self.page)
        self.assertIn('id="throttle-limit-value"', self.page)
        self.assertIn("100% = current stand cap", self.page)

    def test_page_sends_limit_and_reacts_while_armed(self) -> None:
        self.assertIn(
            "throttle_limit_percent: Number(throttleLimit.value)",
            self.page,
        )
        self.assertIn(
            'throttleLimit.addEventListener("input", () => {\n'
            "        updateThrottleLimitUi();\n"
            "        if (armed) void sendControl();\n"
            "      });",
            self.page,
        )


class CommandMailboxTests(unittest.TestCase):
    def test_accepts_monotonic_frames_from_one_client(self) -> None:
        mailbox = CommandMailbox(takeover_s=1.0)

        mailbox.publish("browser-a", 1, True, -1, 1, now=10.0)
        frame = mailbox.publish("browser-a", 2, True, 1, 0, now=10.1)

        self.assertEqual((frame.armed, frame.steering, frame.throttle), (True, 1, 0))
        self.assertEqual(mailbox.snapshot(), frame)

    def test_preserves_throttle_limit_in_published_frame(self) -> None:
        mailbox = CommandMailbox()

        frame = mailbox.publish(
            "browser-a",
            1,
            True,
            0,
            1,
            throttle_limit_percent=40,
            now=12.0,
        )

        self.assertEqual(frame.throttle_limit_percent, 40)

    def test_invalid_throttle_limit_cannot_take_over_or_reset_sequence(self) -> None:
        mailbox = CommandMailbox(takeover_s=1.0)
        mailbox.publish("browser-a", 5, True, 0, 0, now=10.0)

        with self.assertRaises(ValueError):
            mailbox.publish(
                "browser-b",
                1,
                True,
                0,
                1,
                throttle_limit_percent=101,
                now=11.01,
            )

        self.assertEqual(mailbox.owner, "browser-a")
        frame = mailbox.publish("browser-a", 6, True, 0, 1, now=11.02)
        self.assertEqual(frame.throttle_limit_percent, 100)
        self.assertEqual(mailbox.owner, "browser-a")

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
            [(1500, 1500), (1000, 1750), (1500, 1500)],
        )
        self.assertFalse(state.armed)
        self.assertTrue(state.stale)

        runtime.close()
        self.assertEqual(output.applied[-1], (1500, 1500))
        self.assertTrue(output.closed)


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
                "throttle_limit_percent": 40,
            },
        )

        self.assertEqual(status, 202)
        self.assertTrue(response["accepted"])
        frame = self.mailbox.snapshot()
        self.assertIsNotNone(frame)
        self.assertEqual((frame.steering, frame.throttle), (-1, 1))
        self.assertEqual(frame.throttle_limit_percent, 40)

    def test_missing_throttle_limit_defaults_to_100_percent(self) -> None:
        status, _response = self.request(
            "/api/control",
            method="POST",
            payload={
                "client_id": "browser-a",
                "sequence": 1,
                "armed": True,
                "steering": 0,
                "throttle": 1,
            },
        )

        self.assertEqual(status, 202)
        self.assertEqual(self.mailbox.snapshot().throttle_limit_percent, 100)

    def test_invalid_throttle_limit_does_not_replace_last_valid_frame(self) -> None:
        self.request(
            "/api/control",
            method="POST",
            payload={
                "client_id": "browser-a",
                "sequence": 1,
                "armed": True,
                "steering": 0,
                "throttle": 1,
                "throttle_limit_percent": 40,
            },
        )

        for sequence, value in enumerate((True, 9, 101, 10.5), start=2):
            with self.subTest(value=value):
                status, error = self.request(
                    "/api/control",
                    method="POST",
                    payload={
                        "client_id": "browser-a",
                        "sequence": sequence,
                        "armed": True,
                        "steering": 0,
                        "throttle": 1,
                        "throttle_limit_percent": value,
                    },
                )
                self.assertEqual(status, 400)
                self.assertEqual(error["error"], "invalid_request")
                self.assertEqual(self.mailbox.snapshot().throttle_limit_percent, 40)

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
