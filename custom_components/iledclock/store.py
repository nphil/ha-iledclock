"""Design library (global) and playlist (per-clock) persistence, backed by HA storage."""

from __future__ import annotations

from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

from .const import DOMAIN, STORAGE_KEY_PREFIX, STORAGE_VERSION
from .designs import Design, validate_design_payload
from .playlist import PlaylistItem, playlist_item_to_json, validate_playlist


class IledClockDesignLibrary:
    """Global library shared across all configured clocks."""

    def __init__(self, hass: HomeAssistant) -> None:
        self._store: Store[dict[str, Any]] = Store(hass, STORAGE_VERSION, f"{DOMAIN}_designs")
        self._designs: dict[str, Design] = {}
        self._loaded = False

    @property
    def designs(self) -> list[Design]:
        return list(self._designs.values())

    def get_design(self, design_id: str) -> Design | None:
        return self._designs.get(design_id)

    async def async_load(self) -> None:
        if self._loaded:
            return
        self._loaded = True
        data = await self._store.async_load()
        if not data:
            return
        designs: dict[str, Design] = {}
        for raw in data.get("designs", []):
            try:
                design = Design.from_storage(raw)
            except (KeyError, ValueError, TypeError):
                continue
            designs[design.id] = design
        self._designs = designs

    async def async_save(self) -> None:
        await self._store.async_save({"designs": [design.to_storage() for design in self._designs.values()]})

    async def async_save_design(self, raw: dict[str, Any]) -> Design:
        """Validate and persist a design, preserving an existing id when editing."""
        existing = self._designs.get(raw.get("id", "")) if raw.get("id") else None
        design = validate_design_payload(raw, existing_id=existing.id if existing else None)
        self._designs[design.id] = design
        await self.async_save()
        return design

    async def async_delete_design(self, design_id: str) -> bool:
        """Returns whether a design with that id actually existed."""
        existed = self._designs.pop(design_id, None) is not None
        if existed:
            await self.async_save()
        return existed


def async_get_design_library(hass: HomeAssistant) -> IledClockDesignLibrary:
    """Return the shared library; call async_load before reading it."""
    domain_data = hass.data.setdefault(DOMAIN, {})
    library = domain_data.get("design_library")
    if library is None:
        library = IledClockDesignLibrary(hass)
        domain_data["design_library"] = library
    return library


class IledClockPlaylistStore:
    """One active playlist per config entry."""

    def __init__(self, hass: HomeAssistant, entry_id: str) -> None:
        self._store: Store[dict[str, Any]] = Store(hass, STORAGE_VERSION, f"{STORAGE_KEY_PREFIX}_{entry_id}")
        self._playlist: list[PlaylistItem] = []

    @property
    def playlist(self) -> list[PlaylistItem]:
        return list(self._playlist)

    async def async_load(self) -> None:
        data = await self._store.async_load()
        if not data:
            self._playlist = []
            return
        try:
            self._playlist = validate_playlist(data.get("playlist") or [])
        except ValueError:
            self._playlist = []

    async def async_save(self) -> None:
        await self._store.async_save({"playlist": [playlist_item_to_json(item) for item in self._playlist]})

    async def async_set_playlist(self, items: list[PlaylistItem]) -> None:
        self._playlist = list(items)
        await self.async_save()


class IledClockShowStore:
    """Per-clock current item and the eight most recent distinct shown descriptors."""

    LIMIT = 8

    def __init__(self, hass: HomeAssistant, entry_id: str) -> None:
        self._store: Store[dict[str, Any]] = Store(
            hass, STORAGE_VERSION, f"{STORAGE_KEY_PREFIX}_{entry_id}_showing"
        )
        self.now_showing: dict[str, Any] | None = None
        self.history: list[dict[str, Any]] = []

    async def async_load(self) -> None:
        data = await self._store.async_load() or {}
        raw_history = data.get("history", [])
        if not isinstance(raw_history, list):
            raw_history = []
        self.history = [dict(item) for item in raw_history if isinstance(item, dict)][:self.LIMIT]
        raw_current = data.get("now_showing")
        self.now_showing = dict(raw_current) if isinstance(raw_current, dict) else (
            dict(self.history[0]) if self.history else None
        )

    async def async_record(self, descriptor: dict[str, Any]) -> None:
        """Make descriptor current and move its distinct item to the front of history."""
        entry = dict(descriptor)
        identity = {key: value for key, value in entry.items() if key != "shown_at"}
        self.history = [
            old for old in self.history
            if {key: value for key, value in old.items() if key != "shown_at"} != identity
        ]
        self.history.insert(0, entry)
        del self.history[self.LIMIT:]
        self.now_showing = entry
        await self.async_save()

    async def async_mark_unavailable(self, design_id: str) -> None:
        """Persist that a deleted design can no longer be restored."""
        if not any(item.get("kind") == "design" and item.get("design_id") == design_id for item in self.history):
            return
        self.history = [
            {**item, "unavailable": True}
            if item.get("kind") == "design" and item.get("design_id") == design_id else item
            for item in self.history
        ]
        if (self.now_showing or {}).get("kind") == "design" and (self.now_showing or {}).get("design_id") == design_id:
            self.now_showing = {**self.now_showing, "unavailable": True}
        await self.async_save()

    async def async_save(self) -> None:
        await self._store.async_save({"now_showing": self.now_showing, "history": self.history})
