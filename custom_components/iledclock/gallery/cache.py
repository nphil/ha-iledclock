"""Disk LRU byte-capped cache with per-key TTL for gallery listings and media (docs/
GALLERY.md: "Disk cache under `<config>/.storage/iledclock_gallery/` with an LRU byte cap
(64 MB) and per-source TTLs"). Pure, synchronous, blocking file I/O -- the HA layer runs
every call through `hass.async_add_executor_job` (docs/GALLERY.md: "never on the event
loop for decoding (executor)" applies equally to this disk I/O).
"""

from __future__ import annotations

import hashlib
import json
import os
import time
from dataclasses import dataclass
from pathlib import Path

#: docs/GALLERY.md: "an LRU byte cap (64 MB)".
DEFAULT_MAX_BYTES = 64 * 1024 * 1024


@dataclass(frozen=True, slots=True)
class CacheEntry:
    data: bytes
    content_type: str
    stored_at: float


class DiskLRUCache:
    """A flat directory of `<key-hash>.bin` (payload) + `<key-hash>.meta.json` (content
    type + stored-at timestamp) pairs. The byte cap counts payload (`.bin`) bytes only.
    Eviction removes the least-recently-*accessed* entries (by file mtime, refreshed on
    every cache hit) until the total is back under the cap after each `put`.
    """

    def __init__(self, directory: str | Path, *, max_bytes: int = DEFAULT_MAX_BYTES) -> None:
        self._dir = Path(directory)
        self._max_bytes = max_bytes
        self._dir.mkdir(parents=True, exist_ok=True)

    @staticmethod
    def _digest(key: str) -> str:
        return hashlib.sha256(key.encode("utf-8")).hexdigest()

    def _paths(self, key: str) -> tuple[Path, Path]:
        digest = self._digest(key)
        return self._dir / f"{digest}.bin", self._dir / f"{digest}.meta.json"

    def get(self, key: str, *, ttl_s: float | None) -> CacheEntry | None:
        """`ttl_s=None` means "never expires" (still subject to LRU eviction by size).
        Returns `None` on a miss, a stale (past-TTL) entry, or any read/parse error --
        callers always have a valid "just re-fetch" fallback."""
        data_path, meta_path = self._paths(key)
        if not data_path.exists() or not meta_path.exists():
            return None
        try:
            meta = json.loads(meta_path.read_text("utf-8"))
        except (OSError, ValueError):
            return None
        stored_at = meta.get("stored_at", 0.0)
        if ttl_s is not None and (time.time() - stored_at) > ttl_s:
            return None
        try:
            data = data_path.read_bytes()
        except OSError:
            return None
        now = time.time()
        try:
            os.utime(data_path, (now, now))
            os.utime(meta_path, (now, now))
        except OSError:
            pass  # LRU ordering degrades gracefully; still a valid cache hit
        return CacheEntry(
            data=data, content_type=meta.get("content_type", "application/octet-stream"), stored_at=stored_at
        )

    def put(self, key: str, data: bytes, *, content_type: str) -> None:
        data_path, meta_path = self._paths(key)
        data_path.write_bytes(data)
        meta_path.write_text(
            json.dumps({"content_type": content_type, "stored_at": time.time()}), encoding="utf-8"
        )
        self._evict_if_needed()

    def delete(self, key: str) -> None:
        data_path, meta_path = self._paths(key)
        data_path.unlink(missing_ok=True)
        meta_path.unlink(missing_ok=True)

    def total_bytes(self) -> int:
        return sum(p.stat().st_size for p in self._dir.glob("*.bin") if p.exists())

    def _evict_if_needed(self) -> None:
        entries: list[tuple[float, Path, int]] = []
        total = 0
        for data_path in self._dir.glob("*.bin"):
            try:
                stat = data_path.stat()
            except OSError:
                continue
            total += stat.st_size
            entries.append((stat.st_mtime, data_path, stat.st_size))
        if total <= self._max_bytes:
            return
        entries.sort(key=lambda entry: entry[0])  # oldest-accessed first
        for _mtime, data_path, size in entries:
            if total <= self._max_bytes:
                break
            meta_path = self._dir / f"{data_path.stem}.meta.json"
            data_path.unlink(missing_ok=True)
            meta_path.unlink(missing_ok=True)
            total -= size
