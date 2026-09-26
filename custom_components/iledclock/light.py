"""The clock's own display, modelled as an RGB light with the 31 ambient colour-mode effects as
its `effect_list` (Contract C).
"""

from __future__ import annotations

from typing import Any

from homeassistant.components.light import ColorMode, LightEntity, LightEntityFeature
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from .const import (
    COLOR_MODE_MAX,
    COLOR_MODE_MIN,
    brightness_to_app,
    brightness_to_ha,
    light_effect_mode,
    light_effect_name,
)
from .coordinator import IledClockConfigEntry, IledClockCoordinator
from .entity import IledClockEntity

# Writes go through the coordinator's single serialised client; see quality-scale note in
# coordinator.py's module docstring (one asyncio.Lock owns the GATT link).
PARALLEL_UPDATES = 0

_EFFECT_LIST = [light_effect_name(mode) for mode in range(COLOR_MODE_MIN, COLOR_MODE_MAX + 1)]


async def async_setup_entry(
    hass: HomeAssistant, entry: IledClockConfigEntry, async_add_entities: AddConfigEntryEntitiesCallback
) -> None:
    coordinator = entry.runtime_data
    async_add_entities([IledClockDisplayLight(coordinator)])


class IledClockDisplayLight(IledClockEntity, LightEntity):
    """`light.<name>_display`: power (0x05), brightness (0x04), rgb_color (0x13 01), and the
    ambient colour-mode effects (0x13 03) as `effect`."""

    _attr_translation_key = "display"
    _attr_color_mode = ColorMode.RGB
    _attr_supported_color_modes = {ColorMode.RGB}
    _attr_supported_features = LightEntityFeature.EFFECT
    _attr_effect_list = _EFFECT_LIST

    def __init__(self, coordinator: IledClockCoordinator) -> None:
        super().__init__(coordinator, "display")
        self._attr_rgb_color: tuple[int, int, int] | None = None

    @property
    def is_on(self) -> bool | None:
        return self.coordinator.data.power

    @property
    def brightness(self) -> int | None:
        app_value = self.coordinator.data.brightness
        return None if app_value is None else brightness_to_ha(app_value)

    @property
    def rgb_color(self) -> tuple[int, int, int] | None:
        # No readback exists for the last static colour written -- opcode 0x13/01 is write-only.
        # Optimistic: whatever we last sent, until HA restarts.
        return self._attr_rgb_color

    @property
    def effect(self) -> str | None:
        mode = self.coordinator.data.color_mode
        return None if mode is None else light_effect_name(mode)

    async def async_turn_on(self, **kwargs: Any) -> None:
        if "rgb_color" in kwargs:
            rgb = tuple(kwargs["rgb_color"])
            await self.coordinator.async_set_color(rgb)
            self._attr_rgb_color = rgb
        if "effect" in kwargs:
            mode = light_effect_mode(kwargs["effect"])
            if mode is not None:
                await self.coordinator.async_set_color_mode(mode)
        if "brightness" in kwargs:
            await self.coordinator.async_set_brightness(brightness_to_app(kwargs["brightness"]))
        if not self.coordinator.data.power:
            await self.coordinator.async_set_power(True)
        self.async_write_ha_state()

    async def async_turn_off(self, **kwargs: Any) -> None:
        await self.coordinator.async_set_power(False)
        self.async_write_ha_state()
