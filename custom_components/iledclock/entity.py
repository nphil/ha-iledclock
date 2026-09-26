"""Shared entity base for iLedClock."""

from __future__ import annotations

from homeassistant.helpers import device_registry as dr
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import DOMAIN, MANUFACTURER, MODEL
from .coordinator import IledClockCoordinator


class IledClockEntity(CoordinatorEntity[IledClockCoordinator]):
    """An entity belonging to one clock.

    `unique_id` is always `f"{address}_{key}"`: the clock's own BLE address (stable across
    reboots -- also the config entry's own unique id, set in `config_flow.py`) plus a key that
    is stable per platform module (an `EntityDescription.key` for the data-driven platforms, a
    literal string for one-off entities) -- never the entity's display name.
    """

    _attr_has_entity_name = True

    def __init__(self, coordinator: IledClockCoordinator, key: str) -> None:
        super().__init__(coordinator)
        address = coordinator.address
        self._attr_unique_id = f"{address}_{key}"
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, address)},
            connections={(dr.CONNECTION_BLUETOOTH, address)},
            manufacturer=MANUFACTURER,
            model=MODEL,
            name=coordinator.entry.title,
            sw_version=(
                str(coordinator.data.firmware) if coordinator.data.firmware is not None else None
            ),
        )

    @property
    def available(self) -> bool:
        """`CoordinatorEntity.available` (`coordinator.last_update_success`), which only goes
        `False` once the coordinator's own consecutive-failure tolerance is exhausted -- see
        `coordinator.py`'s module docstring. This override exists only to make that contract
        explicit and give every entity one place to add device-specific nuance later."""
        return super().available
