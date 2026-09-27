"""Read-only live smoke check for the Pixel Studio gallery.

Uses the local Home Assistant WebSocket helper and its token file; never prints credentials
or calls any command that writes to the physical clock.
"""

from __future__ import annotations

import sys
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin
from urllib.request import urlopen

HA_HELPER_DIR = Path("/data/home/tmp")
EXPECTED_SOURCE_IDS = {"awtrix", "divoom", "iledclock", "iledclock_anim", "lametric"}
MAX_MEDIA_BYTES = 64 * 1024 * 1024
HTTP_TIMEOUT_S = 45

sys.path.insert(0, str(HA_HELPER_DIR))
import ha_ws  # noqa: E402  (loads its existing token file without printing it)


class SmokeFailure(RuntimeError):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def call_ws(command: str, **payload):
    response = ha_ws.run(command, **payload)
    if not response.get("success"):
        error = response.get("error") or {}
        raise SmokeFailure(str(error.get("code") or "unknown_error"))
    return response.get("result")


def homeassistant_http_base() -> str:
    ws_url = ha_ws.HA
    if ws_url.startswith("wss://"):
        return "https://" + ws_url[len("wss://") :].split("/api/websocket", 1)[0]
    if ws_url.startswith("ws://"):
        return "http://" + ws_url[len("ws://") :].split("/api/websocket", 1)[0]
    raise SmokeFailure("invalid_websocket_url")


def read_media(path: str) -> tuple[int, int]:
    signed = call_ws("auth/sign_path", path=path, expires=60)
    signed_path = signed.get("path") if isinstance(signed, dict) else None
    if not isinstance(signed_path, str):
        raise SmokeFailure("sign_path_failed")
    url = urljoin(homeassistant_http_base(), signed_path)
    try:
        with urlopen(url, timeout=HTTP_TIMEOUT_S) as response:
            body = response.read(MAX_MEDIA_BYTES + 1)
            if len(body) > MAX_MEDIA_BYTES:
                raise SmokeFailure("media_too_large")
            return response.status, len(body)
    except HTTPError as error:
        return error.code, 0
    except URLError as error:
        raise SmokeFailure("media_request_failed") from error


def source_search_payload(entry_id: str, source: dict) -> dict:
    source_id = source["id"]
    payload = {
        "entry_id": entry_id,
        "source": source_id,
        "page": 1,
        "sort": source.get("default_sort"),
    }
    categories = source.get("categories") or []
    if source_id == "iledclock_anim":
        payload["category"] = "dynamic"
        payload["animated_only"] = True
    elif source_id == "iledclock" and categories:
        payload["category"] = next(
            (item["id"] for item in categories if item.get("id") == "trending"),
            categories[0]["id"],
        )
    return payload


def main() -> int:
    entries = call_ws("config_entries/get", domain="iledclock")
    entry = next(
        (item for item in entries if item.get("domain") == "iledclock"),
        None,
    )
    if entry is None:
        print("gallery smoke: no configured iLedClock integration entry")
        return 1

    entry_id = entry["entry_id"]
    sources = call_ws("iledclock/gallery/sources", entry_id=entry_id)
    failures = 0
    skipped = 0
    exercised = 0

    for source in sources:
        source_id = str(source.get("id", "unknown"))
        if not source.get("configured", True):
            skipped += 1
            print(f"{source_id}: skipped (not configured)")
            continue
        try:
            result = call_ws("iledclock/gallery/search", **source_search_payload(entry_id, source))
            items = result.get("items", []) if isinstance(result, dict) else []
            if not items:
                print(f"{source_id}: search ok; no items on page 1")
                exercised += 1
                continue
            item = items[0]
            preview = call_ws(
                "iledclock/gallery/preview",
                entry_id=entry_id,
                source=source_id,
                item_id=item["id"],
            )
            frame_count = len(preview.get("frames", [])) if isinstance(preview, dict) else 0
            if frame_count < 1:
                raise SmokeFailure("empty_preview")
            media_path = item.get("media_path")
            if not isinstance(media_path, str):
                raise SmokeFailure("missing_media_path")
            status, byte_count = read_media(media_path)
            if status != 200 or byte_count < 1:
                raise SmokeFailure(f"media_http_{status}")
            exercised += 1
            print(f"{source_id}: search ok, preview {frame_count} frame(s), media HTTP {status} ({byte_count} bytes)")
        except SmokeFailure as error:
            failures += 1
            print(f"{source_id}: failed ({error.code})")
    reported_ids = {str(source.get("id")) for source in sources}
    for missing_id in sorted(EXPECTED_SOURCE_IDS - reported_ids):
        failures += 1
        print(f"{missing_id}: failed (source_not_reported_by_home_assistant)")

    print(f"gallery smoke: {exercised} exercised, {skipped} skipped, {failures} failed")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
