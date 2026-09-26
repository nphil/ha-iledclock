"""Rotation mode (config, disabled) and the clock-face picker (primary -- Contract C: "uploads a
clock program with the chosen style")."""

from __future__ import annotations

from homeassistant.components.select import SelectEntity
from homeassistant.const import EntityCategory
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from .const import (
    CLOCK_COLOR_NAMES,
    CLOCK_STYLE_MAX,
    CLOCK_STYLE_MIN,
    ROTATE_MODE_LABELS,
    clock_face_name,
    clock_face_style,
)
from .coordinator import IledClockConfigEntry, IledClockCoordinator
from .entity import IledClockEntity

PARALLEL_UPDATES = 0

_ROTATE_NAME_TO_MODE = {label: mode for mode, label in ROTATE_MODE_LABELS.items()}
_CLOCK_FACE_OPTIONS = [clock_face_name(style) for style in range(CLOCK_STYLE_MIN, CLOCK_STYLE_MAX + 1)]
_DEFAULT_CLOCK_FACE_COLOR = CLOCK_COLOR_NAMES.index("White")


async def async_setup_entry(
    hass: HomeAssistant, entry: IledClockConfigEntry, async_add_entities: AddConfigEntryEntitiesCallback
) -> None:
    coordinator = entry.runtime_data
    async_add_entities([IledClockRotationSelect(coordinator), IledClockClockFaceSelect(coordinator)])


class IledClockRotationSelect(IledClockEntity, SelectEntity):
    """`select.<name>_rotation`: the 4-way rotate mode (`commands.rotate(mode)`)."""

    _attr_translation_key = "rotation"
    _attr_entity_category = EntityCategory.CONFIG
    _attr_entity_registry_enabled_default = False
    _attr_options = list(ROTATE_MODE_LABELS.values())

    def __init__(self, coordinator: IledClockCoordinator) -> None:
        super().__init__(coordinator, "rotation")

    @property
    def current_option(self) -> str | None:
        mode = self.coordinator.data.rotate
        return None if mode is None else ROTATE_MODE_LABELS.get(mode)

    async def async_select_option(self, option: str) -> None:
        mode = _ROTATE_NAME_TO_MODE[option]
        await self.coordinator.async_set_rotate(mode)


class IledClockClockFaceSelect(IledClockEntity, SelectEntity):
    """`select.<name>_clock_face`: picking an option immediately uploads a clock program with
    that style, in the current default colour/24h mode -- for full control (colour, seconds,
    12/24h) use the `clock_face` service instead. There is no on-device readback for "which
    style is currently showing", so `current_option` optimistically tracks the last one we
    picked ourselves (through either this select or the `clock_face` service) and starts at
    `None` until something has actually been shown."""

    _attr_translation_key = "clock_face"
    _attr_options = _CLOCK_FACE_OPTIONS

    def __init__(self, coordinator: IledClockCoordinator) -> None:
        super().__init__(coordinator, "clock_face")
        self._current_option: str | None = None

    @property
    def current_option(self) -> str | None:
        item = self.coordinator.active_item
        style = item.params.get("style") if item is not None and item.kind == "clock" else None
        return clock_face_name(int(style)) if style else self._current_option

    async def async_select_option(self, option: str) -> None:
        style = clock_face_style(option)
        if style is None:
            return
        await self.coordinator.async_set_clock_face(style, _DEFAULT_CLOCK_FACE_COLOR, True)
        self._current_option = option
        self.async_write_ha_state()
