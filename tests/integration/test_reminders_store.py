"""Alarm & reminder definitions persist per clock and survive damaged storage."""

from __future__ import annotations

import datetime as dt
import json
import unittest
from unittest.mock import patch

from custom_components.iledclock import reminders
from custom_components.iledclock.reminder_store import IledClockReminderStore
from custom_components.iledclock.reminders import ReminderAttachment, ReminderItem


class MemoryStore:
    """HA's `Store`, kept in a dict; values go through JSON like the real file does."""

    data_by_key: dict[str, object] = {}

    def __init__(self, _hass, _version, key):
        self.key = key

    async def async_load(self):
        value = self.data_by_key.get(self.key)
        return json.loads(json.dumps(value)) if value is not None else None

    async def async_save(self, value):
        self.data_by_key[self.key] = json.loads(json.dumps(value))


def make_item(key: str = "aaaaaaaaaaaa", **overrides) -> ReminderItem:
    fields = dict(
        key=key, name="Wake up", kind="alarm", hour=7, minute=15, date=None, repeat="weekdays", days=(),
        duration_s=30, attachment=ReminderAttachment(), enabled=True, device_ids=(1, 2, 3, 4, 5),
        last_ids=(1, 2, 3, 4, 5), last_error=None, updated=100.0,
    )
    fields.update(overrides)
    return ReminderItem(**fields)


class ReminderStoreTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        MemoryStore.data_by_key = {}
        patcher = patch("custom_components.iledclock.reminder_store.Store", MemoryStore)
        patcher.start()
        self.addCleanup(patcher.stop)

    async def loaded(self, entry_id: str = "clock") -> IledClockReminderStore:
        store = IledClockReminderStore(None, entry_id)
        await store.async_load()
        return store

    async def test_a_fresh_store_is_empty(self) -> None:
        store = await self.loaded()
        self.assertEqual(store.items, [])
        self.assertIsNone(store.get("anything"))

    async def test_definitions_and_their_clock_bookkeeping_survive_a_reload(self) -> None:
        store = await self.loaded()
        full = make_item(
            "bbbbbbbbbbbb", repeat="once", date=dt.date(2026, 12, 24), device_ids=(7,), last_ids=(7,),
            last_error="Couldn't reach the clock.", attachment=ReminderAttachment(kind="design", design_id="d9"),
        )
        await store.async_upsert(make_item())
        await store.async_upsert(full)

        again = await self.loaded()
        self.assertEqual(again.items, [make_item(), full])
        self.assertEqual(again.get("bbbbbbbbbbbb"), full)

    async def test_saving_an_existing_key_replaces_it_in_place(self) -> None:
        store = await self.loaded()
        await store.async_upsert(make_item("aaaaaaaaaaaa"))
        await store.async_upsert(make_item("bbbbbbbbbbbb"))
        await store.async_upsert(make_item("aaaaaaaaaaaa", name="Renamed", device_ids=()))

        again = await self.loaded()
        self.assertEqual([item.key for item in again.items], ["aaaaaaaaaaaa", "bbbbbbbbbbbb"])
        self.assertEqual((again.items[0].name, again.items[0].device_ids), ("Renamed", ()))

    async def test_several_items_are_saved_in_one_write_so_a_slot_changes_owner_all_at_once(self) -> None:
        store = await self.loaded()
        await store.async_upsert(make_item("aaaaaaaaaaaa"))
        await store.async_upsert(make_item("bbbbbbbbbbbb"))
        saves: list[object] = []
        real_save = MemoryStore.async_save

        async def counting_save(this, value):
            saves.append(value)
            await real_save(this, value)

        with patch.object(MemoryStore, "async_save", counting_save):
            await store.async_upsert_many([
                make_item("aaaaaaaaaaaa", device_ids=()),
                make_item("bbbbbbbbbbbb", device_ids=(9,)),
                make_item("cccccccccccc"),
            ])

        self.assertEqual(len(saves), 1)
        again = await self.loaded()
        self.assertEqual(
            [(item.key, item.device_ids) for item in again.items],
            [("aaaaaaaaaaaa", ()), ("bbbbbbbbbbbb", (9,)), ("cccccccccccc", (1, 2, 3, 4, 5))],
        )

    async def test_removing_deletes_it_for_good(self) -> None:
        store = await self.loaded()
        await store.async_upsert(make_item("aaaaaaaaaaaa"))
        await store.async_upsert(make_item("bbbbbbbbbbbb"))
        self.assertTrue(await store.async_remove("aaaaaaaaaaaa"))
        self.assertFalse(await store.async_remove("aaaaaaaaaaaa"))
        self.assertEqual([item.key for item in (await self.loaded()).items], ["bbbbbbbbbbbb"])

    async def test_each_clock_has_its_own_list(self) -> None:
        first = await self.loaded("clock-1")
        await first.async_upsert(make_item("aaaaaaaaaaaa"))
        self.assertEqual((await self.loaded("clock-2")).items, [])

    async def test_new_keys_are_12_hex_characters_and_never_one_in_use(self) -> None:
        store = await self.loaded()
        await store.async_upsert(make_item("0123456789ab"))
        self.assertRegex(store.new_key(), r"^[0-9a-f]{12}$")

        class Fixed:
            def __init__(self, hex: str) -> None:
                self.hex = hex

        collide_then_free = iter([Fixed("0123456789ab" + "0" * 20), Fixed("fedcba987654" + "0" * 20)])
        with patch.object(reminders.uuid, "uuid4", lambda: next(collide_then_free)):
            self.assertEqual(store.new_key(), "fedcba987654")

    async def test_damaged_storage_never_stops_the_rest_from_loading(self) -> None:
        good = make_item("aaaaaaaaaaaa")
        key = "iledclock_store_clock_reminders"
        for junk in (None, "text", ["a"], {"items": "nope"}, {"items": None}, {}):
            with self.subTest(junk=junk):
                MemoryStore.data_by_key[key] = junk
                self.assertEqual((await self.loaded()).items, [])
        MemoryStore.data_by_key[key] = {
            "items": [
                good.to_storage(), "junk", 7, None, {"key": "x"}, {**good.to_storage(), "key": "cccccccccccc", "hour": 99},
                {**good.to_storage(), "key": "bbbbbbbbbbbb", "name": "Second"},
                {**good.to_storage(), "name": "Same key again"},
            ]
        }
        with self.assertLogs("custom_components.iledclock.reminder_store", "WARNING") as logged:
            store = await self.loaded()
        self.assertEqual([(item.key, item.name) for item in store.items], [("aaaaaaaaaaaa", "Wake up"), ("bbbbbbbbbbbb", "Second")])
        self.assertEqual(len(logged.output), 5)  # each unreadable item is skipped with a warning


if __name__ == "__main__":
    unittest.main()
