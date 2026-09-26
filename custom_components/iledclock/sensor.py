"""Temperature/humidity (only created when the unit actually reports them), firmware version
and current program count (both diagnostic) -- Contract C."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

from homeassistant.components.sensor import SensorDeviceClass, SensorEntity, SensorEntityDescription, SensorStateClass
from homeassistant.const import PERCENTAGE, EntityCategory, UnitOfTemperature
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from .coordinator import IledClockConfigEntry, IledClockCoordinator
from .entity import IledClockEntity
from .state import ClockState

PARALLEL_UPDATES = 0


@dataclass(frozen=True, kw_only=True)
class IledClockSensorDescription(SensorEntityDescription):
    value_fn: Callable[[ClockState], float | int | None]


TEMPERATURE = IledClockSensorDescription(
    key="temperature",
    translation_key="temperature",
    device_class=SensorDeviceClass.TEMPERATURE,
    state_class=SensorStateClass.MEASUREMENT,
    native_unit_of_measurement=UnitOfTemperature.CELSIUS,
    value_fn=lambda state: state.temperature,
)
HUMIDITY = IledClockSensorDescription(
    key="humidity",
    translation_key="humidity",
    device_class=SensorDeviceClass.HUMIDITY,
    state_class=SensorStateClass.MEASUREMENT,
    native_unit_of_measurement=PERCENTAGE,
    value_fn=lambda state: state.humidity,
)
FIRMWARE = IledClockSensorDescription(
    key="firmware",
    translation_key="firmware",
    entity_category=EntityCategory.DIAGNOSTIC,
    value_fn=lambda state: state.firmware,
)
PROGRAM_COUNT = IledClockSensorDescription(
    key="program_count",
    translation_key="program_count",
    entity_category=EntityCategory.DIAGNOSTIC,
    state_class=SensorStateClass.MEASUREMENT,
    value_fn=lambda state: None,  # overridden per-instance; see IledClockProgramCountSensor
)


async def async_setup_entry(
    hass: HomeAssistant, entry: IledClockConfigEntry, async_add_entities: AddConfigEntryEntitiesCallback
) -> None:
    coordinator = entry.runtime_data
    entities: list[IledClockSensor] = [
        IledClockSensor(coordinator, FIRMWARE),
        IledClockProgramCountSensor(coordinator),
    ]
    # Contract C: "only if device reports" -- decided once, at setup, from the first successful
    # refresh (`async_config_entry_first_refresh` has already run by the time platforms are
    # forwarded); a unit that never reports one simply never gets that entity.
    if coordinator.data.temperature is not None:
        entities.append(IledClockSensor(coordinator, TEMPERATURE))
    if coordinator.data.humidity is not None:
        entities.append(IledClockSensor(coordinator, HUMIDITY))
    async_add_entities(entities)


class IledClockSensor(IledClockEntity, SensorEntity):
    entity_description: IledClockSensorDescription

    def __init__(self, coordinator: IledClockCoordinator, description: IledClockSensorDescription) -> None:
        super().__init__(coordinator, description.key)
        self.entity_description = description

    @property
    def native_value(self) -> float | int | None:
        return self.entity_description.value_fn(self.coordinator.data)


class IledClockProgramCountSensor(IledClockEntity, SensorEntity):
    """How many items are in the currently-uploaded playlist -- not `program_slots`
    (`DeviceInfo.max_program_number`, the device's own capacity), but how full it is right now,
    from our own record (Contract B: this integration owns the playlist)."""

    entity_description = PROGRAM_COUNT

    def __init__(self, coordinator: IledClockCoordinator) -> None:
        super().__init__(coordinator, PROGRAM_COUNT.key)

    @property
    def native_value(self) -> int:
        return len(self.coordinator.playlist_store.playlist)
