#!/usr/bin/env python3
"""Dev-harness bridge: answers the harness's `iledclock/playback/preview` with the REAL server code.

The browser harness has no Home Assistant behind it, so its mock cannot work out in-between frames. This
script runs the same `program_builder.inline_playback` + `ws_shapes.shape_playback_payload` the real
WebSocket command runs (the pure modules only: no Home Assistant, no Bluetooth) behind a tiny HTTP
endpoint, and `frontend/dev/retime.ts` POSTs to it when it is up:

    python3 frontend/dev/retime-bridge.py            # then:  cd frontend && npm run harness

POST http://127.0.0.1:4174/playback/preview  {frames, delays, clock_region?, speed?, smooth?}
  -> {frames, delays, playback}   (the WebSocket result shape)
"""

from __future__ import annotations

import json
import os
import sys
import types
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

PACKAGE_DIR = Path(__file__).resolve().parents[2] / "custom_components" / "iledclock"
PORT = int(os.environ.get("HARNESS_BRIDGE_PORT", "4174"))


def _stub_package(name: str, path: Path) -> None:
    """Make `custom_components.iledclock.<pure module>` importable without running the integration's
    `__init__.py` (which imports Home Assistant) - the same trick tests/integration/__init__.py uses."""
    module = types.ModuleType(name)
    module.__path__ = [str(path)]  # type: ignore[attr-defined]
    sys.modules[name] = module


_stub_package("custom_components", PACKAGE_DIR.parent)
_stub_package("custom_components.iledclock", PACKAGE_DIR)

from custom_components.iledclock.program_builder import inline_playback  # noqa: E402
from custom_components.iledclock.ws_shapes import shape_playback_payload  # noqa: E402


class Handler(BaseHTTPRequestHandler):
    def _reply(self, status: int, body: dict | None = None) -> None:
        payload = json.dumps(body).encode() if body is not None else b""
        self.send_response(status)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "content-type")
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_OPTIONS(self) -> None:  # noqa: N802 - http.server API
        self._reply(204)

    def do_POST(self) -> None:  # noqa: N802 - http.server API
        if self.path != "/playback/preview":
            self._reply(404, {"error": "unknown path"})
            return
        try:
            message = json.loads(self.rfile.read(int(self.headers.get("Content-Length", "0"))))
            played, width = inline_playback(message)
        except (ValueError, TypeError) as err:
            self._reply(400, {"error": str(err)})
            return
        self._reply(200, shape_playback_payload(played, width))

    def log_message(self, format: str, *args: object) -> None:  # noqa: A002 - http.server API
        sys.stderr.write("retime-bridge: " + (format % args) + "\n")


if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"retime bridge listening on http://127.0.0.1:{PORT}/playback/preview", flush=True)
    server.serve_forever()
