"""Connectivity indicator (Contract C: diagnostic)."""

from __future__ import annotations

from homeassistant.components.binary_sensor import BinarySensorDeviceClass, BinarySensorEntity
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
    async_add_entities([IledClockConnectedBinarySensor(coordinator)])


class IledClockConnectedBinarySensor(IledClockEntity, BinarySensorEntity):
    """Reflects whether the last refresh cycle actually reached the device
    (`ClockState.connected`), not whether a GATT link happens to be open at this instant --
    the idle-disconnect policy means we are usually NOT connected between operations by design,
    which would make a literal live-link reading a noisy, misleading "connectivity" signal.

    Deliberately always `available`: this entity IS the "can we reach it" signal, so unlike
    every other entity it must never itself grey out."""

    _attr_translation_key = "connected"
    _attr_device_class = BinarySensorDeviceClass.CONNECTIVITY
    _attr_entity_category = EntityCategory.DIAGNOSTIC

    def __init__(self, coordinator: IledClockCoordinator) -> None:
        super().__init__(coordinator, "connected")

    @property
    def available(self) -> bool:
        return True

    @property
    def is_on(self) -> bool:
        return self.coordinator.data.connected
