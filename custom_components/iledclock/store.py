"""Design library (global) and playlist (per-clock) persistence (Contract D), backed by
`homeassistant.helpers.storage.Store`.

Two separate stores, not one: `iledclock/designs/save`/`delete` take no `entry_id` at all and
`designs/list`'s `entry_id` is optional (frontend/src/types.ts's `ShowItem`/`StoredDesign` and
ws-api.ts's request builders confirm this) -- a saved pixel-art image or animation is a reusable
asset for any of the user's clocks, not tied to one. The playlist, by contrast, is genuinely
per-clock (`iledclock/playlist/get|set` both require `entry_id`).

Deliberately thin: every validation/serialisation decision lives in the pure `designs.py` and
`playlist.py` modules (unit-tested directly in tests/integration/), so this module is just
"when to load, when to save, where the in-memory copy lives".
"""

from __future__ import annotations

from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

from .const import DOMAIN, STORAGE_KEY_PREFIX, STORAGE_VERSION
from .designs import Design, validate_design_payload
from .playlist import PlaylistItem, playlist_item_to_json, validate_playlist


class IledClockDesignLibrary:
    """Global, shared across every configured clock. One instance per Home Assistant run,
    looked up via `async_get_design_library`."""

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
        """Validate and persist a design from an `iledclock/designs/save` payload. An `id`
        already present in `raw` -- or already on file -- is preserved (an edit); otherwise a
        new id is minted."""
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
    """The shared `IledClockDesignLibrary` instance for this HA run, creating it on first use.
    Call `await library.async_load()` before reading -- safe to call repeatedly, it loads once."""
    domain_data = hass.data.setdefault(DOMAIN, {})
    library = domain_data.get("design_library")
    if library is None:
        library = IledClockDesignLibrary(hass)
        domain_data["design_library"] = library
    return library


class IledClockPlaylistStore:
    """One instance per config entry: just the active playlist. Call `async_load()` once during
    `async_setup_entry` before reading `playlist`."""

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
