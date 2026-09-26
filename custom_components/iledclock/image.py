"""PNG preview of whatever program is currently on the clock, from our own record (Contract C).

Exact for `design`/`text` items (we hold the real pixels or can render them with the same
5x7 font the device uses); an honest, clearly-labelled approximation (a plain text label, e.g.
"CLOCK", "SCORE") for `clock`/`date`/`timer`/`scoreboard`/`temperature`/`humidity` items, since
those are rendered by the device's own firmware from a style index we cannot reproduce
pixel-for-pixel client-side -- see `coordinator.py`'s `_async_update_preview_for_item`.
"""

from __future__ import annotations

from homeassistant.components.image import ImageEntity
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback
from homeassistant.util import dt as dt_util

from .coordinator import IledClockConfigEntry, IledClockCoordinator
from .entity import IledClockEntity

PARALLEL_UPDATES = 0


async def async_setup_entry(
    hass: HomeAssistant, entry: IledClockConfigEntry, async_add_entities: AddConfigEntryEntitiesCallback
) -> None:
    coordinator = entry.runtime_data
    async_add_entities([IledClockDisplayImage(hass, coordinator)])


class IledClockDisplayImage(IledClockEntity, ImageEntity):
    _attr_translation_key = "display"
    _attr_content_type = "image/png"

    def __init__(self, hass: HomeAssistant, coordinator: IledClockCoordinator) -> None:
        IledClockEntity.__init__(self, coordinator, "display_preview")
        ImageEntity.__init__(self, hass)
        self._last_png: bytes | None = None

    @property
    def extra_state_attributes(self) -> dict[str, bool]:
        return {"approximate": self.coordinator.preview_approximate}

    async def async_added_to_hass(self) -> None:
        await super().async_added_to_hass()
        self._last_png = self.coordinator.preview_png
        if self._last_png is not None:
            self._attr_image_last_updated = dt_util.utcnow()

    def _handle_coordinator_update(self) -> None:
        if self.coordinator.preview_png != self._last_png:
            self._last_png = self.coordinator.preview_png
            self._attr_image_last_updated = dt_util.utcnow()
        super()._handle_coordinator_update()

    async def async_image(self) -> bytes | None:
        return self.coordinator.preview_png
