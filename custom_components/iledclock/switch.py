"""Night mode enable/disable and the two recovered 0x1e device-setting toggles (Contract C: all
config-category, disabled by default -- the card/panel is where settings live)."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from homeassistant.components.switch import SwitchEntity, SwitchEntityDescription
from homeassistant.const import EntityCategory
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from .const import DEVICE_SETTING_REMOTE_ENABLE, DEVICE_SETTING_SHOW_DEVICE_ID
from .coordinator import IledClockConfigEntry, IledClockCoordinator
from .entity import IledClockEntity
from .state import ClockState

PARALLEL_UPDATES = 0


@dataclass(frozen=True, kw_only=True)
class IledClockDeviceSettingDescription(SwitchEntityDescription):
    """A boolean 0x1e device setting (`commands.device_setting(kind, on)`)."""

    kind: int
    is_on_fn: Callable[[ClockState], bool | None]


DEVICE_SETTINGS: tuple[IledClockDeviceSettingDescription, ...] = (
    IledClockDeviceSettingDescription(
        key="show_device_id",
        translation_key="show_device_id",
        entity_category=EntityCategory.CONFIG,
        entity_registry_enabled_default=False,
        kind=DEVICE_SETTING_SHOW_DEVICE_ID,
        is_on_fn=lambda state: state.show_device_id,
    ),
    IledClockDeviceSettingDescription(
        key="remote_enable",
        translation_key="remote_enable",
        entity_category=EntityCategory.CONFIG,
        entity_registry_enabled_default=False,
        kind=DEVICE_SETTING_REMOTE_ENABLE,
        is_on_fn=lambda state: state.remote_enable,
    ),
)


async def async_setup_entry(
    hass: HomeAssistant, entry: IledClockConfigEntry, async_add_entities: AddConfigEntryEntitiesCallback
) -> None:
    coordinator = entry.runtime_data
    entities: list[SwitchEntity] = [IledClockNightModeSwitch(coordinator)]
    entities.extend(IledClockDeviceSettingSwitch(coordinator, description) for description in DEVICE_SETTINGS)
    async_add_entities(entities)


class IledClockNightModeSwitch(IledClockEntity, SwitchEntity):
    """`switch.<name>_night_mode`: flips only the enabled flag, keeping every other night-mode
    field as last read (see `coordinator.async_set_night_mode_enabled`)."""

    _attr_translation_key = "night_mode"
    _attr_entity_category = EntityCategory.CONFIG
    _attr_entity_registry_enabled_default = False

    def __init__(self, coordinator: IledClockCoordinator) -> None:
        super().__init__(coordinator, "night_mode")

    @property
    def is_on(self) -> bool | None:
        night_mode = self.coordinator.data.night_mode
        return None if night_mode is None else night_mode.enabled

    @property
    def available(self) -> bool:
        return super().available and self.coordinator.data.night_mode is not None

    async def async_turn_on(self, **kwargs: Any) -> None:
        await self.coordinator.async_set_night_mode_enabled(True)

    async def async_turn_off(self, **kwargs: Any) -> None:
        await self.coordinator.async_set_night_mode_enabled(False)


class IledClockDeviceSettingSwitch(IledClockEntity, SwitchEntity):
    """One boolean 0x1e device setting; see `DEVICE_SETTINGS` above."""

    entity_description: IledClockDeviceSettingDescription

    def __init__(self, coordinator: IledClockCoordinator, description: IledClockDeviceSettingDescription) -> None:
        super().__init__(coordinator, description.key)
        self.entity_description = description

    @property
    def is_on(self) -> bool | None:
        return self.entity_description.is_on_fn(self.coordinator.data)

    async def async_turn_on(self, **kwargs: Any) -> None:
        await self.coordinator.async_set_device_setting(self.entity_description.kind, True)

    async def async_turn_off(self, **kwargs: Any) -> None:
        await self.coordinator.async_set_device_setting(self.entity_description.kind, False)
