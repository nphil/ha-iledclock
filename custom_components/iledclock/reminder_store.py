"""Alarm and reminder definitions (per clock), backed by Home Assistant storage.

The clock only keeps the compiled reminders and cannot hand back the art, so the definitions (name,
schedule, art, on/off and the clock slots each one holds) live here. See `reminders.py` for the model and
`reminder_manager.py` for what writes them.
"""

from __future__ import annotations

import logging
from collections.abc import Iterable
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

from .const import STORAGE_KEY_PREFIX, STORAGE_VERSION
from .reminders import ReminderItem, ReminderValidationError, new_key

_LOGGER = logging.getLogger(__name__)


class IledClockReminderStore:
    """The alarm and reminder definitions of one config entry, in the order they were first saved."""

    def __init__(self, hass: HomeAssistant, entry_id: str) -> None:
        self._store: Store[dict[str, Any]] = Store(
            hass, STORAGE_VERSION, f"{STORAGE_KEY_PREFIX}_{entry_id}_reminders"
        )
        self._items: dict[str, ReminderItem] = {}

    @property
    def items(self) -> list[ReminderItem]:
        return list(self._items.values())

    def get(self, key: str) -> ReminderItem | None:
        return self._items.get(key)

    def new_key(self) -> str:
        """A key (12 hex characters) no saved item uses."""
        return new_key(self._items)

    async def async_load(self) -> None:
        """Read the saved definitions. Never raises for damaged data: a saved item that cannot be read is
        skipped (and logged), the rest load."""
        data = await self._store.async_load()
        raw_items = data.get("items") if isinstance(data, dict) else None
        self._items = {}
        if not isinstance(raw_items, list):
            return
        for raw in raw_items:
            try:
                item = ReminderItem.from_storage(raw)
            except ReminderValidationError as err:
                _LOGGER.warning("iLedClock: skipped a saved alarm that could not be read (%s)", err)
                continue
            self._items.setdefault(item.key, item)

    async def _async_save(self) -> None:
        await self._store.async_save({"items": [item.to_storage() for item in self._items.values()]})

    async def async_upsert(self, item: ReminderItem) -> None:
        """Add `item`, or replace the saved item with the same key (keeping its place in the list)."""
        await self.async_upsert_many((item,))

    async def async_upsert_many(self, items: Iterable[ReminderItem]) -> None:
        """Add or replace several items and save ONCE, so the changes reach the disk together or not at all (a slot
        that changes owner is never seen with two owners, or none, after a restart)."""
        for item in items:
            self._items[item.key] = item
        await self._async_save()

    async def async_remove(self, key: str) -> bool:
        """Delete a definition. Returns whether there was one."""
        existed = self._items.pop(key, None) is not None
        if existed:
            await self._async_save()
        return existed
