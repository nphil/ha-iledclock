"""`gallery.cache.DiskLRUCache` tests: hit/miss, TTL expiry, and byte-cap LRU eviction."""

from __future__ import annotations

import tempfile
import time
import unittest
from pathlib import Path

from custom_components.iledclock.gallery.cache import DiskLRUCache


class DiskLRUCacheTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.cache = DiskLRUCache(Path(self._tmp.name), max_bytes=1024)

    def test_put_then_get_round_trips_data_and_content_type(self) -> None:
        self.cache.put("a", b"hello world", content_type="image/gif")

        entry = self.cache.get("a", ttl_s=None)

        self.assertIsNotNone(entry)
        self.assertEqual(entry.data, b"hello world")
        self.assertEqual(entry.content_type, "image/gif")

    def test_missing_key_is_a_clean_miss(self) -> None:
        self.assertIsNone(self.cache.get("does-not-exist", ttl_s=None))

    def test_ttl_expiry(self) -> None:
        self.cache.put("a", b"data", content_type="text/plain")
        # A negative effective age check: stored_at is "now", so ttl_s=0 with any elapsed
        # time (even a few microseconds) must already read as expired.
        time.sleep(0.01)
        self.assertIsNone(self.cache.get("a", ttl_s=0))
        self.assertIsNotNone(self.cache.get("a", ttl_s=3600))

    def test_byte_cap_evicts_least_recently_accessed_entry(self) -> None:
        # max_bytes=1024; three ~400-byte payloads together exceed the cap.
        payload = b"x" * 400
        self.cache.put("first", payload, content_type="application/octet-stream")
        time.sleep(0.01)
        self.cache.put("second", payload, content_type="application/octet-stream")
        time.sleep(0.01)
        # Touch "first" (LRU-refresh it) before adding a third entry that forces eviction.
        self.cache.get("first", ttl_s=None)
        time.sleep(0.01)
        self.cache.put("third", payload, content_type="application/octet-stream")

        # Total would be 1200 > 1024 cap; the LEAST recently accessed ("second", never
        # touched after its initial put) must be the one evicted, not "first".
        self.assertIsNotNone(self.cache.get("first", ttl_s=None))
        self.assertIsNotNone(self.cache.get("third", ttl_s=None))
        self.assertIsNone(self.cache.get("second", ttl_s=None))
        self.assertLessEqual(self.cache.total_bytes(), 1024)

    def test_delete_removes_both_files(self) -> None:
        self.cache.put("a", b"data", content_type="text/plain")
        self.cache.delete("a")
        self.assertIsNone(self.cache.get("a", ttl_s=None))


if __name__ == "__main__":
    unittest.main()
