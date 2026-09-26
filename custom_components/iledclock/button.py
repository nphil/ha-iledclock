"""Manual time-sync trigger (Contract C: config). Automatic sync already happens on first
connect after HA start and daily at 03:30 local when the `time_sync` option is on; this is for
"do it right now"."""

from __future__ import annotations

from homeassistant.components.button import ButtonEntity
from homeassistant.const import EntityCategory
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from .coordinator import IledClockConfigEntry, IledClockCoordinator
from .entity import IledClockEntity

PARALLEL_UPDATES = 0


async def async_setup_entry(
    hass: HomeAssistant, entry: IledClockConfigEntry, async_add_entities: AddConfigEntryEntitiesCallback
) -> None:
    coordinator = entry.runtime_data
    async_add_entities([IledClockSyncTimeButton(coordinator)])


class IledClockSyncTimeButton(IledClockEntity, ButtonEntity):
    _attr_translation_key = "sync_time"
    _attr_entity_category = EntityCategory.CONFIG

    def __init__(self, coordinator: IledClockCoordinator) -> None:
        super().__init__(coordinator, "sync_time")

    async def async_press(self) -> None:
        await self.coordinator.async_sync_time()
