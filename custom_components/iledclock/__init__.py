"""iLedClock -- local control for a 32x16 RGB BLE pixel-matrix clock.

Component-level setup (services, the websocket API, the frontend panel/extra JS/static path)
happens once here in `async_setup`, since none of those are per-device; `async_setup_entry`
builds one `IledClockCoordinator` per configured clock.
"""

from __future__ import annotations

import asyncio
import logging
import time
from functools import partial
from pathlib import Path

from homeassistant.components import panel_custom
from homeassistant.components.frontend import add_extra_js_url
from homeassistant.components.http import StaticPathConfig
from homeassistant.const import CONF_ADDRESS, Platform
from homeassistant.core import HassJob, HomeAssistant, callback
from homeassistant.exceptions import ConfigEntryNotReady
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers.typing import ConfigType

from . import services, shutdown
from .const import (
    DOMAIN,
    FRONTEND_JS_FILENAME,
    FRONTEND_JS_MODULE,
    PANEL_ICON,
    PANEL_TITLE,
    PANEL_URL_PATH,
    SETUP_BUDGET_S,
    STATIC_PATH,
)
from .coordinator import IledClockConfigEntry, IledClockCoordinator
from .gallery import async_setup_gallery
from .store import async_get_design_library
from .websocket_api import async_setup_websocket_api

_LOGGER = logging.getLogger(__name__)

PLATFORMS: list[Platform] = [
    Platform.BINARY_SENSOR,
    Platform.BUTTON,
    Platform.IMAGE,
    Platform.LIGHT,
    Platform.NUMBER,
    Platform.SELECT,
    Platform.SENSOR,
    Platform.SWITCH,
    Platform.TEXT,
]

# Config-entry-only integration; this still exists to register the process-global services,
# websocket commands, and frontend panel exactly once, not to accept YAML configuration.
CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    # Registered first, before any await: Home Assistant reads its shutdown-job list once when the
    # stage starts, and an entry set up or reloaded during the stage registers its own job too late.
    # This domain job is never removed with an entry, so the latch always gets set.
    hass.async_add_shutdown_job(HassJob(_async_latch_for_shutdown, "iledclock shutdown latch"), hass)
    services.async_setup_services(hass)
    async_setup_websocket_api(hass)
    await _async_register_frontend(hass)
    # docs/GALLERY.md: registers the gallery's own websocket commands and its authenticated
    # media-proxy HTTP view. Owned by GalleryEngine (custom_components/iledclock/gallery/**);
    # this is this integration's one call-in point, same as services/websocket_api above.
    await async_setup_gallery(hass)
    return True


async def _async_register_frontend(hass: HomeAssistant) -> None:
    domain_data = hass.data.setdefault(DOMAIN, {})
    if domain_data.get("frontend_registered"):
        return
    domain_data["frontend_registered"] = True

    frontend_dir = Path(__file__).parent / "frontend"
    await hass.http.async_register_static_paths(
        [StaticPathConfig(STATIC_PATH, str(frontend_dir), cache_headers=False)]
    )
    module_url = f"{STATIC_PATH}/{FRONTEND_JS_FILENAME}"
    add_extra_js_url(hass, module_url)

    await panel_custom.async_register_panel(
        hass,
        frontend_url_path=PANEL_URL_PATH,
        webcomponent_name=FRONTEND_JS_MODULE,
        sidebar_title=PANEL_TITLE,
        sidebar_icon=PANEL_ICON,
        module_url=module_url,
        require_admin=False,
    )


async def _async_latch_for_shutdown(hass: HomeAssistant) -> None:
    """Domain-wide latch: from now on nothing in this integration opens a Bluetooth link."""
    shutdown.begin(hass)
    for entry in hass.config_entries.async_entries(DOMAIN):
        coordinator = getattr(entry, "runtime_data", None)
        if isinstance(coordinator, IledClockCoordinator):
            coordinator.async_quiet_for_shutdown()


async def _async_refuse_while_shutting_down(
    hass: HomeAssistant, coordinator: IledClockCoordinator | None
) -> None:
    """Entry setup/reload during Home Assistant's shutdown: undo what was started, retry never."""
    if not shutdown.in_progress(hass):
        return
    if coordinator is not None:
        await coordinator.async_unload()
    raise ConfigEntryNotReady("Home Assistant is shutting down")


async def async_setup_entry(hass: HomeAssistant, entry: IledClockConfigEntry) -> bool:
    await _async_refuse_while_shutting_down(hass, None)
    address = entry.data[CONF_ADDRESS]
    started = time.monotonic()
    coordinator = IledClockCoordinator(hass, entry, address)
    coordinator.async_setup()
    entry.async_on_unload(
        hass.async_add_shutdown_job(
            HassJob(
                coordinator.async_release_at_shutdown,
                f"iledclock release BLE link {entry.title}",
            )
        )
    )

    library = async_get_design_library(hass)
    await library.async_load()
    await coordinator.playlist_store.async_load()
    await coordinator.show_store.async_load()
    await coordinator.slot_store.async_load()
    await coordinator.reminders.async_load()
    await _async_refuse_while_shutting_down(hass, coordinator)
    coordinator.data = coordinator.data.merge(
        now_showing=coordinator.show_store.now_showing,
        show_history=tuple(dict(item) for item in coordinator.show_store.history),
    )
    await coordinator.async_seed_showing_from_playlist()
    await _async_refuse_while_shutting_down(hass, coordinator)

    # Startup contract S1/S2: the first refresh (connect, password handshake, status reads) runs as a task
    # the entry owns; setup waits for it only inside what is left of the budget. Whatever the clock does,
    # setup returns, entities start unavailable, and fill in when the refresh lands.
    refresh = coordinator.startup_refresh = entry.async_create_background_task(
        hass, coordinator.async_refresh(), f"iledclock first refresh {entry.title}"
    )
    try:
        async with asyncio.timeout(max(0.0, SETUP_BUDGET_S - (time.monotonic() - started))):
            await asyncio.shield(refresh)
    except TimeoutError:
        _LOGGER.info(
            "iLedClock %s did not answer within %.0f s; setup continues and the first read finishes in the background",
            address, SETUP_BUDGET_S,
        )
    await _async_refuse_while_shutting_down(hass, coordinator)

    entry.runtime_data = coordinator
    entry.async_on_unload(coordinator.async_add_listener(partial(_async_sync_firmware, hass, coordinator)))

    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    _async_sync_firmware(hass, coordinator)
    return True


@callback
def _async_sync_firmware(hass: HomeAssistant, coordinator: IledClockCoordinator) -> None:
    """The device's firmware version arrives with the first read, which may land after the entities were
    created (so without it); put it on the device record as soon as it is known."""
    firmware = coordinator.data.firmware
    if firmware is None:
        return
    registry = dr.async_get(hass)
    for device in dr.async_entries_for_config_entry(registry, coordinator.entry.entry_id):
        if device.sw_version != str(firmware):
            registry.async_update_device(device.id, sw_version=str(firmware))


async def async_unload_entry(hass: HomeAssistant, entry: IledClockConfigEntry) -> bool:
    coordinator = entry.runtime_data
    # Before the platforms go: a first reading arriving mid-unload would otherwise add the late
    # temperature/humidity sensors to a platform that is being torn down.
    await coordinator.async_stop_startup()
    unloaded = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if unloaded:
        await coordinator.async_unload()
    else:
        coordinator.async_resume_startup()
    return unloaded


async def async_remove_config_entry_device(
    hass: HomeAssistant, entry: IledClockConfigEntry, device: dr.DeviceEntry
) -> bool:
    """Allow the UI to delete an `iledclock` device only once it is no longer this entry's own
    live device (i.e. it's a stale orphan, not the clock the entry still represents)."""
    return not any(
        domain == DOMAIN and identifier == entry.unique_id for domain, identifier in device.identifiers
    )
