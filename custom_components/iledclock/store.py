"""Design library (global) and playlist (per-clock) persistence, backed by HA storage."""

from __future__ import annotations

import time
from dataclasses import replace
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

from .const import DEFAULT_SLOT, DOMAIN, STORAGE_KEY_PREFIX, STORAGE_VERSION
from .designs import Design, DesignValidationError, validate_design_payload
from .playlist import PlaylistItem, playlist_item_to_json, validate_playlist
from .retime import validate_smooth, validate_speed
from .slots import upgrade_descriptor, upgrade_text_fields

#: "Leave this playback setting as it is" for `async_set_playback` (None is a real value: Original / auto).
UNCHANGED: Any = object()

#: `format` of the playlist file. 2 = written since a text item's `speed` became the playback speed (0 still ..
#: 100 max). A file without it (written before) may hold text items with the clock's old 0-255 text speed.
PLAYLIST_FORMAT = 2


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
        if existing is not None:
            # A client that does not know about playback (an older panel, a rename that only sends
            # what it read) must not wipe a design's speed or smoothing by leaving the keys out.
            kept = {key: getattr(existing, key) for key in ("speed", "smooth") if key not in raw}
            if kept:
                design = replace(design, **kept)
        self._designs[design.id] = design
        await self.async_save()
        return design

    async def async_set_playback(
        self, design_id: str, *, speed: Any = UNCHANGED, smooth: Any = UNCHANGED
    ) -> Design | None:
        """Change only a design's Speed and/or Smooth motion, leaving its frames alone. Returns the
        updated design, or None when there is no such design. Raises `DesignValidationError` for a bad
        value."""
        existing = self._designs.get(design_id)
        if existing is None:
            return None
        changes: dict[str, Any] = {}
        if speed is not UNCHANGED:
            try:
                changes["speed"] = validate_speed(speed)
            except ValueError as err:
                raise DesignValidationError(str(err), "speed") from err
        if smooth is not UNCHANGED:
            try:
                changes["smooth"] = validate_smooth(smooth)
            except ValueError as err:
                raise DesignValidationError(str(err), "smooth") from err
        design = replace(existing, updated=time.time(), **changes)
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


def _upgraded_item(item: PlaylistItem) -> PlaylistItem:
    """`item` in today's words: only a text item can differ (`slots.upgrade_text_fields`)."""
    if item.kind != "text":
        return item
    params = upgrade_text_fields(item.params)
    return item if params == dict(item.params) else replace(item, params=params)


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
            return
        file_format = data.get("format")
        if not (isinstance(file_format, int) and file_format >= PLAYLIST_FORMAT):
            # Saved before text speed became the playback speed: its text items may hold the clock's old 0-255 text
            # speed, which the builder refuses, so the playlist could never be uploaded again (after a restart, or
            # when a timed message ends). Bring them up to date once and keep the result.
            upgraded = [_upgraded_item(item) for item in self._playlist]
            if upgraded != self._playlist:
                self._playlist = upgraded
                await self.async_save()

    async def async_save(self) -> None:
        await self._store.async_save(
            {"format": PLAYLIST_FORMAT, "playlist": [playlist_item_to_json(item) for item in self._playlist]}
        )

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

    @staticmethod
    def _without_image_source(item: dict[str, Any]) -> dict[str, Any]:
        cleaned = upgrade_descriptor({key: value for key, value in item.items() if key not in {"data_b64", "url"}})
        if cleaned.get("kind") == "image" and not cleaned.get("frames"):
            cleaned["unavailable"] = True
        return cleaned

    @staticmethod
    def _identity(item: dict[str, Any]) -> dict[str, Any]:
        """What makes two history entries the same show: everything but when it was shown. An entry with no `slot`
        (stored before screens existed) is a screen A entry."""
        return {"slot": DEFAULT_SLOT, **{key: value for key, value in item.items() if key != "shown_at"}}

    async def async_load(self) -> None:
        data = await self._store.async_load() or {}
        raw_history = data.get("history", [])
        if not isinstance(raw_history, list):
            raw_history = []
        valid_history = [dict(item) for item in raw_history if isinstance(item, dict)][:self.LIMIT]
        self.history = [self._without_image_source(item) for item in valid_history]
        raw_current = data.get("now_showing")
        valid_current = dict(raw_current) if isinstance(raw_current, dict) else None
        self.now_showing = self._without_image_source(valid_current) if valid_current is not None else (
            dict(self.history[0]) if self.history else None
        )
        if data.get("history", []) != self.history or data.get("now_showing") != self.now_showing:
            await self.async_save()

    async def async_record(self, descriptor: dict[str, Any]) -> None:
        """Make descriptor current and move its distinct item to the front of history."""
        entry = self._without_image_source(dict(descriptor))
        identity = self._identity(entry)
        self.history = [old for old in self.history if self._identity(old) != identity]
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
        self.history = [self._without_image_source(item) for item in self.history]
        self.now_showing = self._without_image_source(self.now_showing) if self.now_showing is not None else None
        await self._store.async_save({"now_showing": self.now_showing, "history": self.history})
