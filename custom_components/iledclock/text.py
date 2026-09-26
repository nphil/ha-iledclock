"""Quick text message entity (Contract C: "shows a text program immediately, using current text
style defaults"). For the notify-style temporary-message behaviour with `duration_s` and
automatic restore, use the `show_text` service instead -- this entity is the plain, permanent
"put this text on the screen now" control."""

from __future__ import annotations

from homeassistant.components.text import TextEntity
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from .const import TEXT_MODE_MAX_LENGTH
from .coordinator import IledClockConfigEntry, IledClockCoordinator
from .entity import IledClockEntity

PARALLEL_UPDATES = 0


async def async_setup_entry(
    hass: HomeAssistant, entry: IledClockConfigEntry, async_add_entities: AddConfigEntryEntitiesCallback
) -> None:
    coordinator = entry.runtime_data
    async_add_entities([IledClockMessageText(coordinator)])


class IledClockMessageText(IledClockEntity, TextEntity):
    _attr_translation_key = "message"
    _attr_native_max = TEXT_MODE_MAX_LENGTH

    def __init__(self, coordinator: IledClockCoordinator) -> None:
        super().__init__(coordinator, "message")
        self._value: str | None = None

    @property
    def native_value(self) -> str | None:
        return self._value

    async def async_set_value(self, value: str) -> None:
        await self.coordinator.async_show({"type": "text", "text": value})
        self._value = value
        self.async_write_ha_state()
