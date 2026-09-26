"""Config entry setup/unload against the fake transport: every entity platform is forwarded,
state comes from the live-captured `device_info`/`temperature_humidity` replies, config-category
entities start disabled, and unload cleans up the GATT link (Contract B/C)."""

from __future__ import annotations

from homeassistant.const import STATE_ON, STATE_UNAVAILABLE
from homeassistant.helpers import entity_registry as er

from custom_components.iledclock.const import DOMAIN

from .fake_clock import FakeClockDevice

#: `unique_id` suffix (see `entity.py`) -> (domain, enabled_by_default).
_EXPECTED_ENTITIES: dict[str, tuple[str, bool]] = {
    "display": ("light", True),
    "connected": ("binary_sensor", True),
    "firmware": ("sensor", True),
    "program_count": ("sensor", True),
    "night_mode": ("switch", False),
    "show_device_id": ("switch", False),
    "remote_enable": ("switch", False),
    "volume": ("number", False),
    "color_speed": ("number", False),
    "rotation": ("select", False),
    "clock_face": ("select", True),
    "sync_time": ("button", True),
    "display_preview": ("image", True),
    "message": ("text", True),
}


async def test_setup_registers_expected_entities(hass, config_entry, clock: FakeClockDevice) -> None:
    """Every platform in `PLATFORMS` forwards exactly the entities Contract C promises, no
    more (no temperature/humidity for this unit's all-zero `19 01` reply) and no less, each
    with the right default enabled/disabled state."""
    registry = er.async_get(hass)
    entries = er.async_entries_for_config_entry(registry, config_entry.entry_id)
    by_suffix = {entry.unique_id.removeprefix(f"{clock.address}_"): entry for entry in entries}

    assert set(by_suffix) == set(_EXPECTED_ENTITIES)
    for suffix, (domain, enabled_by_default) in _EXPECTED_ENTITIES.items():
        entry = by_suffix[suffix]
        assert entry.entity_id.startswith(f"{domain}.")
        is_disabled = entry.disabled_by is not None
        assert is_disabled == (not enabled_by_default), (
            f"{suffix}: expected enabled_by_default={enabled_by_default}, "
            f"got disabled_by={entry.disabled_by}"
        )


async def test_setup_reads_device_info_into_coordinator(hass, config_entry, clock: FakeClockDevice) -> None:
    """The live-captured `1f` (device_info) reply decodes to firmware 33 / 9 program slots,
    and the all-zero `19 01` reply means no temperature/humidity reading is recorded."""
    coordinator = config_entry.runtime_data
    assert coordinator.last_update_success is True
    assert coordinator.data.connected is True
    assert coordinator.data.firmware == 33
    assert coordinator.data.program_slots == 9
    assert coordinator.data.temperature is None
    assert coordinator.data.humidity is None


async def test_setup_light_reflects_device_state(hass, config_entry, clock: FakeClockDevice) -> None:
    """`light.<title>_display`: on, with the live brightness (163, clamped to the app's own
    5-100 range then mapped onto HA's 1-255 scale -- 100 app units -> 255)."""
    registry = er.async_get(hass)
    entries = er.async_entries_for_config_entry(registry, config_entry.entry_id)
    light_entity_id = next(e.entity_id for e in entries if e.unique_id == f"{clock.address}_display")

    state = hass.states.get(light_entity_id)
    assert state is not None
    assert state.state == STATE_ON
    assert state.attributes["brightness"] == 255


async def test_setup_no_temperature_humidity_entities(hass, config_entry, clock: FakeClockDevice) -> None:
    """The all-zero `19 01` reply (docs/HARDWARE.md section 8: "no sensor") must not create
    `sensor.<title>_temperature`/`_humidity`."""
    registry = er.async_get(hass)
    entries = er.async_entries_for_config_entry(registry, config_entry.entry_id)
    suffixes = {e.unique_id.removeprefix(f"{clock.address}_") for e in entries}
    assert "temperature" not in suffixes
    assert "humidity" not in suffixes


async def test_unload_cleans_up_link(hass, config_entry, clock: FakeClockDevice) -> None:
    """Unloading releases the GATT link and removes every entity's state."""
    registry = er.async_get(hass)
    entries = er.async_entries_for_config_entry(registry, config_entry.entry_id)
    light_entity_id = next(e.entity_id for e in entries if e.unique_id == f"{clock.address}_display")
    assert hass.states.get(light_entity_id) is not None

    assert await hass.config_entries.async_unload(config_entry.entry_id)
    await hass.async_block_till_done()

    assert clock.connected is False
    state = hass.states.get(light_entity_id)
    assert state is None or state.state == STATE_UNAVAILABLE


async def test_setup_succeeds_with_graceful_degradation_when_unreachable(
    hass, clock: FakeClockDevice, make_config_entry
) -> None:
    """Coordinator's documented availability policy: connecting at all only fails a whole
    refresh cycle after `CONSECUTIVE_FAILURES_FOR_UNAVAILABLE` (3) consecutive misses -- so a
    single failed first refresh must NOT raise `ConfigEntryNotReady`. Setup succeeds with a
    "not connected" state instead, giving the entry a chance to recover on the next refresh."""
    from bleak.exc import BleakError

    clock.connect_error = BleakError("no route to device")
    entry = make_config_entry()

    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    assert entry.state.value == "loaded"

    coordinator = entry.runtime_data
    assert coordinator.last_update_success is True
    assert coordinator.data.connected is False
    assert coordinator.data.consecutive_failures == 1
