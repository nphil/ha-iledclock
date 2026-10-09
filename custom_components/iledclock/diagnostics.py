"""Diagnostics support for iLedClock.

Redacts the clock's BLE MAC (its address doubles as the config entry's unique id and could be
used to identify/target the physical device) and the stored device password.
"""

from __future__ import annotations

from dataclasses import asdict
from typing import Any

from homeassistant.components.diagnostics import async_redact_data
from homeassistant.const import CONF_ADDRESS
from homeassistant.core import HomeAssistant

from .const import CONF_DIVOOM_EMAIL, CONF_DIVOOM_PASSWORD_MD5, CONF_PASSWORD
from .coordinator import IledClockConfigEntry

TO_REDACT = {CONF_ADDRESS, CONF_PASSWORD, CONF_DIVOOM_EMAIL, CONF_DIVOOM_PASSWORD_MD5, "address"}


async def async_get_config_entry_diagnostics(
    hass: HomeAssistant, entry: IledClockConfigEntry
) -> dict[str, Any]:
    coordinator = entry.runtime_data
    data = coordinator.data

    return async_redact_data(
        {
            "entry_data": dict(entry.data),
            "entry_options": dict(entry.options),
            "coordinator": {
                "last_update_success": coordinator.last_update_success,
                "consecutive_failures": data.consecutive_failures,
                "is_connected": coordinator.client.is_connected,
                "link": coordinator.client.link_snapshot(),
                "active_item": (
                    {"kind": coordinator.active_item.kind, "duration_s": coordinator.active_item.duration_s}
                    if coordinator.active_item is not None
                    else None
                ),
                "playlist_length": len(coordinator.playlist_store.playlist),
                "design_count": len(coordinator.design_library.designs),
            },
            "state": asdict(data),
        },
        TO_REDACT,
    )
