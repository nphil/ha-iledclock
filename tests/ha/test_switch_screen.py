"""`switch_screen`: the one-way power-key press (`20 01`). The clock never answers it, so it must
return at once, write exactly once, leave nothing pending, never retry, and fail loudly when the
clock can not be reached."""

from __future__ import annotations

import asyncio
from unittest.mock import patch

import pytest
from bleak.exc import BleakError
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import device_registry as dr

from custom_components.iledclock import const
from custom_components.iledclock.client import IledClockConnectionError, IledClockError
from custom_components.iledclock.const import DOMAIN

from .fake_clock import FakeClockDevice, FakeGattClient

TOGGLE = bytes((0x20, 0x01))


@pytest.fixture(autouse=True)
def silent_clock(clock: FakeClockDevice) -> None:
    """Like the real firmware: no reply at all to `20 xx`."""
    clock.silent_keys.add((0x20, None))


@pytest.fixture
def device_id(hass, config_entry) -> str:
    devices = dr.async_entries_for_config_entry(dr.async_get(hass), config_entry.entry_id)
    return devices[0].id


async def test_switch_screen_returns_at_once_writes_once_and_leaves_nothing_pending(
    config_entry, clock: FakeClockDevice
) -> None:
    coordinator = config_entry.runtime_data
    # The request timeout is 5 s; a one-way command must not wait for the reply that never comes.
    await asyncio.wait_for(coordinator.async_switch_screen(), timeout=1.0)

    assert clock.requests(0x20) == [TOGGLE]
    assert coordinator.client._pending == {}
    assert coordinator.client._pending_chunks == {}


async def test_switch_screen_write_failure_raises_and_is_not_retried(
    config_entry, clock: FakeClockDevice
) -> None:
    coordinator = config_entry.runtime_data
    await coordinator.async_switch_screen()  # connect
    clock.written.clear()
    attempts = 0

    async def failing_write(self, char_specifier, data, response=None):
        nonlocal attempts
        attempts += 1
        raise BleakError("link dropped")

    with patch.object(FakeGattClient, "write_gatt_char", failing_write):
        with pytest.raises(IledClockError):
            await coordinator.async_switch_screen()

    assert attempts == 1  # a toggle is not idempotent: never send it twice
    assert clock.requests(0x20) == []


async def test_switch_screen_with_unreachable_clock_raises(
    config_entry, clock: FakeClockDevice
) -> None:
    coordinator = config_entry.runtime_data
    await coordinator.client.async_release()
    clock.connect_error = BleakError("out of range")
    clock.written.clear()

    with pytest.raises(IledClockConnectionError):
        await coordinator.async_switch_screen()

    assert clock.requests(0x20) == []


async def test_switch_screen_waits_for_a_running_upload(config_entry, clock: FakeClockDevice) -> None:
    coordinator = config_entry.runtime_data
    clock.written.clear()
    async with coordinator.show_lock:
        task = asyncio.create_task(coordinator.async_switch_screen())
        await asyncio.sleep(0.05)
        assert clock.requests(0x20) == []
        assert not task.done()
    await asyncio.wait_for(task, timeout=1.0)
    assert clock.requests(0x20) == [TOGGLE]


async def test_service_switch_screen_presses_the_key_once(
    hass, config_entry, clock: FakeClockDevice, device_id: str
) -> None:
    clock.written.clear()
    await asyncio.wait_for(
        hass.services.async_call(DOMAIN, const.SERVICE_SWITCH_SCREEN, {"device_id": device_id}, blocking=True),
        timeout=2.0,
    )
    assert clock.requests(0x20) == [TOGGLE]


async def test_service_switch_screen_reports_an_unreachable_clock(
    hass, config_entry, clock: FakeClockDevice, device_id: str
) -> None:
    await config_entry.runtime_data.client.async_release()
    clock.connect_error = BleakError("out of range")
    with pytest.raises(HomeAssistantError):
        await hass.services.async_call(
            DOMAIN, const.SERVICE_SWITCH_SCREEN, {"device_id": device_id}, blocking=True
        )


async def test_ws_command_switch_screen_presses_the_key_once(
    hass, hass_ws_client, config_entry, clock: FakeClockDevice
) -> None:
    client = await hass_ws_client(hass)
    clock.written.clear()
    await client.send_json_auto_id(
        {"type": "iledclock/command", "entry_id": config_entry.entry_id, "command": "switch_screen", "params": {}}
    )
    response = await asyncio.wait_for(client.receive_json(), timeout=2.0)
    assert response["success"] is True
    assert clock.requests(0x20) == [TOGGLE]


async def test_ws_command_switch_screen_unreachable_is_command_failed(
    hass, hass_ws_client, config_entry, clock: FakeClockDevice
) -> None:
    await config_entry.runtime_data.client.async_release()
    clock.connect_error = BleakError("out of range")
    client = await hass_ws_client(hass)
    await client.send_json_auto_id(
        {"type": "iledclock/command", "entry_id": config_entry.entry_id, "command": "switch_screen", "params": {}}
    )
    response = await client.receive_json()
    assert response["success"] is False
    assert response["error"]["code"] == "command_failed"
