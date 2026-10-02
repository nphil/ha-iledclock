"""What Home Assistant last sent to each of the clock's two screens, kept per clock.

The clock's power button switches between screen A (the program list) and screen B (the clock-page
store). Bluetooth can neither select a screen nor read one back, so this record is the only way to know
what a screen holds: it is written ONLY after the clock accepted an upload, never before.

Each screen's record is `{title, descriptor, wire_kind, programs, crc, length, written_at}`:

* `descriptor` is the same shape as a `now_showing` entry, so the studio can draw it again through
  `iledclock/render` (`None` only if nothing renderable is known);
* `wire_kind` is the start-frame kind byte of that screen's uploads (0 = screen A, 4 = screen B);
* `programs` is how many programs the upload carried;
* `crc` / `length` identify the first uploaded program exactly as its start frame did
  (`protocol.programs.program_fingerprint`), kept in storage but not sent to the studio.
"""

from __future__ import annotations

from copy import deepcopy
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util

from .const import SLOTS, STORAGE_KEY_PREFIX, STORAGE_VERSION
from .slots import check_slot, wire_kind

#: The fields of a record the studio gets (`iledclock/state` -> `slots`).
_PUBLIC_FIELDS = ("title", "descriptor", "wire_kind", "programs", "written_at")


def _clean_record(slot: str, raw: Any) -> dict[str, Any] | None:
    """A stored record if it is well formed, else None (storage can be old, edited or damaged)."""
    if not isinstance(raw, dict):
        return None
    title, written_at, programs = raw.get("title"), raw.get("written_at"), raw.get("programs")
    if not isinstance(title, str) or not isinstance(written_at, str):
        return None
    if isinstance(programs, bool) or not isinstance(programs, int) or programs < 0:
        return None
    descriptor = raw.get("descriptor")
    crc, length = raw.get("crc"), raw.get("length")
    return {
        "title": title,
        "descriptor": dict(descriptor) if isinstance(descriptor, dict) and isinstance(descriptor.get("kind"), str) else None,
        "wire_kind": wire_kind(slot),
        "programs": programs,
        "crc": crc if isinstance(crc, str) else None,
        "length": length if isinstance(length, int) and not isinstance(length, bool) else None,
        "written_at": written_at,
    }


class IledClockSlotStore:
    """One record per screen, persisted per config entry."""

    def __init__(self, hass: HomeAssistant, entry_id: str) -> None:
        self._store: Store[dict[str, Any]] = Store(hass, STORAGE_VERSION, f"{STORAGE_KEY_PREFIX}_{entry_id}_slots")
        self._records: dict[str, dict[str, Any] | None] = {slot: None for slot in SLOTS}
        #: The screen of the most recent write, or None before the first one.
        self.last_written: str | None = None

    async def async_load(self) -> None:
        data = await self._store.async_load()
        data = data if isinstance(data, dict) else {}
        self._records = {slot: _clean_record(slot, data.get(slot)) for slot in SLOTS}
        last = data.get("last_written")
        self.last_written = last if last in SLOTS and self._records[last] is not None else None

    async def async_save(self) -> None:
        await self._store.async_save({**deepcopy(self._records), "last_written": self.last_written})

    def record(self, slot: str) -> dict[str, Any] | None:
        """A copy of `slot`'s record (including crc and length), or None if nothing was ever sent to it."""
        record = self._records[check_slot(slot)]
        return deepcopy(record) if record is not None else None

    async def async_record(
        self,
        slot: str,
        *,
        title: str,
        descriptor: dict[str, Any] | None,
        programs: int,
        crc: str | None,
        length: int | None,
    ) -> dict[str, Any]:
        """Remember that the clock accepted an upload of `programs` programs to `slot`. Returns the new record."""
        record = {
            "title": title,
            "descriptor": deepcopy(descriptor) if descriptor is not None else None,
            "wire_kind": wire_kind(slot),
            "programs": programs,
            "crc": crc,
            "length": length,
            "written_at": dt_util.utcnow().isoformat(),
        }
        self._records[slot] = record
        self.last_written = slot
        await self.async_save()
        return deepcopy(record)

    def json(self) -> dict[str, Any]:
        """`slots` of the `iledclock/state` payload: `{a, b, last_written}`, each screen a record without its
        crc and length, or None."""
        payload: dict[str, Any] = {
            slot: (
                {field: deepcopy(record[field]) for field in _PUBLIC_FIELDS} if record is not None else None
            )
            for slot, record in self._records.items()
        }
        payload["last_written"] = self.last_written
        return payload
