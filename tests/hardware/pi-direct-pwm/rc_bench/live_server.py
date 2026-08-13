from __future__ import annotations

import argparse
import hmac
import json
import secrets
import signal
import threading
import time
from collections.abc import Callable, Sequence
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Protocol
from urllib.parse import urlparse

from .hardware import LgpioPulseOutput
from .live_control import InputFrame, LiveControl, OutputState


class ClientBusyError(RuntimeError):
    pass


class StaleSequenceError(ValueError):
    pass


class PulseOutput(Protocol):
    def apply(self, steering_us: int, throttle_us: int) -> None: ...

    def close(self) -> None: ...


class CommandMailbox:
    def __init__(self, *, takeover_s: float = 1.0) -> None:
        if takeover_s <= 0:
            raise ValueError("takeover_s must be positive")
        self._takeover_s = takeover_s
        self._lock = threading.Lock()
        self._owner: str | None = None
        self._last_sequence = -1
        self._last_received = 0.0
        self._frame: InputFrame | None = None

    @property
    def owner(self) -> str | None:
        with self._lock:
            return self._owner

    def publish(
        self,
        client_id: str,
        sequence: int,
        armed: bool,
        steering: int,
        throttle: int,
        throttle_limit_percent: int = 100,
        brake: bool = False,
        *,
        now: float,
    ) -> InputFrame:
        if not isinstance(client_id, str) or not 1 <= len(client_id) <= 128:
            raise ValueError("client_id must be a non-empty string up to 128 characters")
        if isinstance(sequence, bool) or not isinstance(sequence, int) or sequence < 0:
            raise ValueError("sequence must be a non-negative integer")
        if not isinstance(armed, bool):
            raise ValueError("armed must be boolean")
        if isinstance(steering, bool) or not isinstance(steering, int):
            raise ValueError("steering must be an integer")
        if isinstance(throttle, bool) or not isinstance(throttle, int):
            raise ValueError("throttle must be an integer")
        frame = InputFrame(
            armed=armed,
            steering=steering,
            throttle=throttle,
            received_at=now,
            throttle_limit_percent=throttle_limit_percent,
            brake=brake,
        )

        with self._lock:
            owner_is_stale = (
                self._owner is not None
                and now - self._last_received > self._takeover_s
            )
            if self._owner is None or owner_is_stale:
                self._owner = client_id
                self._last_sequence = -1
            elif self._owner != client_id:
                raise ClientBusyError("another browser owns the live bench")
            if sequence <= self._last_sequence:
                raise StaleSequenceError("sequence must increase monotonically")

            self._last_sequence = sequence
            self._last_received = now
            self._frame = frame
            return frame

    def snapshot(self) -> InputFrame | None:
        with self._lock:
            return self._frame

    def heartbeat_age(self, now: float) -> float | None:
        with self._lock:
            if self._owner is None:
                return None
            return max(0.0, now - self._last_received)


StatusProvider = Callable[[], dict[str, object]]


def create_http_server(
    host: str,
    port: int,
    *,
    mailbox: CommandMailbox,
    token: str,
    ui_html: str,
    status_provider: StatusProvider,
    clock: Callable[[], float] = time.monotonic,
) -> ThreadingHTTPServer:
    if not token:
        raise ValueError("token must not be empty")

    class Handler(BaseHTTPRequestHandler):
        server_version = "RCBenchLive/1"

        def do_GET(self) -> None:  # noqa: N802
            path = urlparse(self.path).path
            if path in ("/", "/index.html"):
                self._send_bytes(200, "text/html; charset=utf-8", ui_html.encode("utf-8"))
                return
            if path == "/api/state":
                if not self._authorized():
                    self._send_json(403, {"error": "forbidden"})
                    return
                state = dict(status_provider())
                state["owner"] = mailbox.owner
                state["heartbeat_age_ms"] = _milliseconds(mailbox.heartbeat_age(clock()))
                self._send_json(200, state)
                return
            self._send_json(404, {"error": "not_found"})

        def do_POST(self) -> None:  # noqa: N802
            if urlparse(self.path).path != "/api/control":
                self._send_json(404, {"error": "not_found"})
                return
            if not self._authorized():
                self._send_json(403, {"error": "forbidden"})
                return
            try:
                payload = self._read_json()
                mailbox.publish(
                    payload["client_id"],
                    payload["sequence"],
                    payload["armed"],
                    payload["steering"],
                    payload["throttle"],
                    throttle_limit_percent=payload.get("throttle_limit_percent", 100),
                    brake=payload.get("brake", False),
                    now=clock(),
                )
            except ClientBusyError as error:
                self._send_json(409, {"error": "client_busy", "message": str(error)})
                return
            except StaleSequenceError as error:
                self._send_json(409, {"error": "stale_sequence", "message": str(error)})
                return
            except (KeyError, TypeError, ValueError, json.JSONDecodeError) as error:
                self._send_json(400, {"error": "invalid_request", "message": str(error)})
                return

            response = dict(status_provider())
            response["accepted"] = True
            self._send_json(202, response)

        def _authorized(self) -> bool:
            supplied = self.headers.get("X-Bench-Token", "")
            return hmac.compare_digest(supplied, token)

        def _read_json(self) -> dict[str, Any]:
            raw_length = self.headers.get("Content-Length")
            if raw_length is None:
                raise ValueError("Content-Length is required")
            length = int(raw_length)
            if not 0 < length <= 2048:
                raise ValueError("request body must be between 1 and 2048 bytes")
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            if not isinstance(payload, dict):
                raise ValueError("request body must be a JSON object")
            return payload

        def _send_json(self, status: int, payload: dict[str, object]) -> None:
            body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
            self._send_bytes(status, "application/json; charset=utf-8", body)

        def _send_bytes(self, status: int, content_type: str, body: bytes) -> None:
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'")
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, _format: str, *_args: object) -> None:
            return

    server = ThreadingHTTPServer((host, port), Handler)
    server.daemon_threads = True
    return server


def _milliseconds(seconds: float | None) -> int | None:
    if seconds is None:
        return None
    return round(seconds * 1000)


class ConsolePulseOutput:
    def __init__(self) -> None:
        self._last: tuple[int, int] | None = None

    def apply(self, steering_us: int, throttle_us: int) -> None:
        command = (steering_us, throttle_us)
        if command != self._last:
            print(f"steering={steering_us}us throttle={throttle_us}us", flush=True)
            self._last = command

    def close(self) -> None:
        print("PWM off", flush=True)


class LiveRuntime:
    def __init__(
        self,
        mailbox: CommandMailbox,
        output: PulseOutput,
        *,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._mailbox = mailbox
        self._output = output
        self._clock = clock
        self._control = LiveControl()
        self._lock = threading.Lock()
        self._last_applied: tuple[int, int] | None = None
        self._state = OutputState(1500, 1500, False, True, "idle")

    def tick(self) -> OutputState:
        state = self._control.step(self._mailbox.snapshot(), self._clock())
        pulses = (state.steering_us, state.throttle_us)
        if pulses != self._last_applied:
            self._output.apply(*pulses)
            self._last_applied = pulses
        with self._lock:
            self._state = state
        return state

    def status(self) -> dict[str, object]:
        with self._lock:
            state = self._state
        return {
            "armed": state.armed,
            "stale": state.stale,
            "steering_us": state.steering_us,
            "throttle_us": state.throttle_us,
            "reverse_phase": state.reverse_phase,
        }

    def close(self) -> None:
        try:
            self._output.apply(1500, 1500)
        finally:
            self._output.close()


def create_output(dry_run: bool) -> PulseOutput:
    if dry_run:
        return ConsolePulseOutput()
    import lgpio

    return LgpioPulseOutput(
        lgpio,
        chip=0,
        steering_gpio=18,
        throttle_gpio=19,
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Level 2 local browser keyboard control for a suspended RC bench car."
    )
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--public-host", default="office.local")
    parser.add_argument("--token")
    parser.add_argument("--ui", type=Path)
    parser.add_argument("--dry-run", action="store_true")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    token = args.token or secrets.token_urlsafe(24)
    ui_path = args.ui or Path(__file__).resolve().parent.parent / "web" / "live.html"
    ui_html = ui_path.read_text(encoding="utf-8")
    mailbox = CommandMailbox(takeover_s=1.0)
    output = create_output(args.dry_run)
    runtime = LiveRuntime(mailbox, output)
    runtime.tick()
    server = create_http_server(
        args.host,
        args.port,
        mailbox=mailbox,
        token=token,
        ui_html=ui_html,
        status_provider=runtime.status,
    )
    actual_port = server.server_address[1]
    print(
        f"RC_BENCH_LIVE_URL=http://{args.public_host}:{actual_port}/?token={token}",
        flush=True,
    )

    stop_event = threading.Event()

    def request_stop(_signum: int, _frame: object) -> None:
        stop_event.set()

    for signum in (signal.SIGINT, signal.SIGTERM):
        signal.signal(signum, request_stop)

    server_thread = threading.Thread(target=server.serve_forever, daemon=True)
    server_thread.start()
    try:
        while not stop_event.wait(0.02):
            runtime.tick()
    except KeyboardInterrupt:
        stop_event.set()
    finally:
        server.shutdown()
        server.server_close()
        server_thread.join(timeout=2)
        runtime.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
