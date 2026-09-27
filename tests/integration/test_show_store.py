"""Persistent now-showing ring behavior."""

from __future__ import annotations

import unittest
from unittest.mock import patch

from custom_components.iledclock.store import IledClockShowStore


class MemoryStore:
    data_by_key: dict[str, dict] = {}

    def __init__(self, _hass, _version, key):
        self.key = key

    async def async_load(self):
        value = self.data_by_key.get(self.key)
        return dict(value) if value is not None else None

    async def async_save(self, value):
        self.data_by_key[self.key] = value


class ShowStoreTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        MemoryStore.data_by_key = {}

    async def test_ring_keeps_eight_distinct_items_and_moves_repeat_to_front(self) -> None:
        with patch("custom_components.iledclock.store.Store", MemoryStore):
            store = IledClockShowStore(None, "clock")
            await store.async_load()
            for index in range(9):
                await store.async_record({"kind": "text", "text": str(index), "title": str(index), "shown_at": f"t{index}"})
            await store.async_record({"kind": "text", "text": "7", "title": "7", "shown_at": "again"})

            self.assertEqual(len(store.history), 8)
            self.assertEqual(store.history[0]["shown_at"], "again")
            self.assertEqual([item["text"] for item in store.history], ["7", "8", "6", "5", "4", "3", "2", "1"])

    async def test_history_and_current_survive_store_reload(self) -> None:
        with patch("custom_components.iledclock.store.Store", MemoryStore):
            store = IledClockShowStore(None, "clock")
            await store.async_load()
            current = {"kind": "clock", "style": 12, "title": "Clock · style 12", "shown_at": "2026-09-27T00:00:00+00:00"}
            await store.async_record(current)
            await store.async_record({"kind": "text", "text": "HELLO", "title": "Text · HELLO", "shown_at": "2026-09-27T00:01:00+00:00"})

            restored = IledClockShowStore(None, "clock")
            await restored.async_load()

        self.assertEqual(restored.now_showing["text"], "HELLO")
        self.assertEqual(restored.history[1], current)

    async def test_deleted_design_is_marked_in_current_and_history(self) -> None:
        with patch("custom_components.iledclock.store.Store", MemoryStore):
            store = IledClockShowStore(None, "clock")
            await store.async_load()
            descriptor = {"kind": "design", "design_id": "gone", "title": "Old art", "shown_at": "t"}
            await store.async_record(descriptor)
            await store.async_mark_unavailable("gone")

        self.assertTrue(store.now_showing["unavailable"])
        self.assertTrue(store.history[0]["unavailable"])

    async def test_image_sources_are_scrubbed_but_preview_frames_survive(self) -> None:
        with patch("custom_components.iledclock.store.Store", MemoryStore):
            store = IledClockShowStore(None, "clock")
            descriptor = {
                "kind": "image",
                "title": "Image",
                "data_b64": "private-source",
                "url": "https://example.invalid/image.png",
                "frames": ["rendered-frame"],
                "delays": [100],
                "shown_at": "t",
            }
            legacy = {"kind": "image", "title": "Old image", "data_b64": "private-source", "url": "https://example.invalid/old.png"}
            MemoryStore.data_by_key[store._store.key] = {"now_showing": descriptor, "history": [descriptor, legacy]}
            await store.async_load()
            self.assertEqual(store.now_showing["frames"], ["rendered-frame"])
            self.assertNotIn("data_b64", store.now_showing)
            self.assertNotIn("url", store.now_showing)
            self.assertNotIn("data_b64", MemoryStore.data_by_key[store._store.key]["now_showing"])
            self.assertNotIn("url", MemoryStore.data_by_key[store._store.key]["history"][0])
            self.assertTrue(store.history[1]["unavailable"])
            self.assertNotIn("data_b64", MemoryStore.data_by_key[store._store.key]["history"][1])
            self.assertNotIn("url", MemoryStore.data_by_key[store._store.key]["history"][1])

            await store.async_record({**descriptor, "shown_at": "next"})
            saved = MemoryStore.data_by_key[store._store.key]

        self.assertEqual(store.history[0]["frames"], ["rendered-frame"])
        self.assertNotIn("data_b64", saved["now_showing"])
        self.assertNotIn("url", saved["now_showing"])

if __name__ == "__main__":
    unittest.main()
