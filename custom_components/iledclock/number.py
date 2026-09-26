"""Volume and ambient colour-cycle speed (Contract C: both config, disabled by default)."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass

from homeassistant.components.number import NumberEntity, NumberEntityDescription, NumberMode
from homeassistant.const import EntityCategory
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from .const import COLOR_SPEED_MAX, COLOR_SPEED_MIN, VOLUME_MAX, VOLUME_MIN
from .coordinator import IledClockConfigEntry, IledClockCoordinator
from .entity import IledClockEntity
from .state import ClockState

PARALLEL_UPDATES = 0


@dataclass(frozen=True, kw_only=True)
class IledClockNumberDescription(NumberEntityDescription):
    value_fn: Callable[[ClockState], int | None]
    set_fn: Callable[[IledClockCoordinator, int], Awaitable[None]]


NUMBERS: tuple[IledClockNumberDescription, ...] = (
    IledClockNumberDescription(
        key="volume",
        translation_key="volume",
        entity_category=EntityCategory.CONFIG,
        entity_registry_enabled_default=False,
        native_min_value=VOLUME_MIN,
        native_max_value=VOLUME_MAX,
        native_step=1,
        mode=NumberMode.BOX,
        value_fn=lambda state: state.volume,
        set_fn=lambda coordinator, value: coordinator.async_set_volume(value),
    ),
    IledClockNumberDescription(
        key="color_speed",
        translation_key="color_speed",
        entity_category=EntityCategory.CONFIG,
        entity_registry_enabled_default=False,
        native_min_value=COLOR_SPEED_MIN,
        native_max_value=COLOR_SPEED_MAX,
        native_step=1,
        mode=NumberMode.BOX,
        value_fn=lambda state: state.color_speed,
        set_fn=lambda coordinator, value: coordinator.async_set_color_speed(value),
    ),
)


async def async_setup_entry(
    hass: HomeAssistant, entry: IledClockConfigEntry, async_add_entities: AddConfigEntryEntitiesCallback
) -> None:
    coordinator = entry.runtime_data
    async_add_entities(IledClockNumber(coordinator, description) for description in NUMBERS)


class IledClockNumber(IledClockEntity, NumberEntity):
    entity_description: IledClockNumberDescription

    def __init__(self, coordinator: IledClockCoordinator, description: IledClockNumberDescription) -> None:
        super().__init__(coordinator, description.key)
        self.entity_description = description

    @property
    def native_value(self) -> float | None:
        return self.entity_description.value_fn(self.coordinator.data)

    async def async_set_native_value(self, value: float) -> None:
        await self.entity_description.set_fn(self.coordinator, int(value))
