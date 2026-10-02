"""Temperature/humidity (only created when the unit actually reports them), firmware version
and the number of programs on screen A (both diagnostic) -- Contract C."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from homeassistant.components.sensor import SensorDeviceClass, SensorEntity, SensorEntityDescription, SensorStateClass
from homeassistant.const import PERCENTAGE, EntityCategory, UnitOfTemperature
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from .const import SLOT_A
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


def _slot_attribute(record: dict[str, Any] | None) -> dict[str, Any] | None:
    """A screen's record as a sensor attribute: what it was, how many programs, and when it was sent."""
    if record is None:
        return None
    return {"title": record["title"], "programs": record["programs"], "written_at": record["written_at"]}


class IledClockProgramCountSensor(IledClockEntity, SensorEntity):
    """How many programs Home Assistant's last upload to screen A (the clock's program list) carried: one for
    a show, the playlist's length for a playlist. Unknown until Home Assistant has sent something there, because
    the clock cannot report its program list. Not `program_slots`, the clock's capacity, which is the
    `capacity` attribute; `slot_a` / `slot_b` say what each screen was last sent."""

    entity_description = PROGRAM_COUNT

    def __init__(self, coordinator: IledClockCoordinator) -> None:
        super().__init__(coordinator, PROGRAM_COUNT.key)

    @property
    def native_value(self) -> int | None:
        record = self.coordinator.slot_store.record(SLOT_A)
        return record["programs"] if record is not None else None

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        slots = self.coordinator.slots_json()
        return {
            "slot_a": _slot_attribute(slots["a"]),
            "slot_b": _slot_attribute(slots["b"]),
            "capacity": self.coordinator.data.program_slots,
        }
