"""Shared fixtures for tests/ha (real-Home-Assistant tests).

Wires `fake_clock.FakeClockDevice` into the integration's two real-Bluetooth call sites
(`client.py`'s `bluetooth.async_ble_device_from_address` and `establish_connection`) so every
test in this package gets a working, fully-scripted "connection" without ever touching a real
adapter -- see `fake_clock.py`'s module docstring for why only the device itself is faked.
"""

from __future__ import annotations

import time
from types import SimpleNamespace
from typing import Any
from unittest.mock import patch

import pytest
from bleak.backends.device import BLEDevice
from homeassistant.const import CONF_ADDRESS
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.iledclock.const import DOMAIN

from .fake_clock import FakeClockDevice

# pytest-homeassistant-custom-component's own recommended conftest pattern: make every test in
# this package load `custom_components/iledclock` for real, and never let the integration's
# `bluetooth_adapters` -> `bluetooth` dependency chain reach for actual adapter hardware.


@pytest.fixture(autouse=True)
def _auto_enable_custom_integrations(enable_custom_integrations: None) -> None:
    """Loads this repo's `custom_components/iledclock` as a real, installed integration."""


@pytest.fixture(autouse=True)
def _prevent_real_bluetooth(mock_bluetooth: None) -> None:
    """`manifest.json` depends on `bluetooth_adapters` -> `bluetooth`; setting up any config
    entry here would otherwise make the real `bluetooth` component probe for a real adapter."""


@pytest.fixture
def hass_config_dir(hass_tmp_config_dir: str) -> str:
    """Give every test its own throwaway config directory (pytest-homeassistant-custom-
    component's own documented override pattern). The default shared directory would let
    `gallery/cache.py`'s hand-rolled `DiskLRUCache` -- real blocking file I/O against
    `hass.config.path(".storage", ...)`, not routed through HA's own mocked `Store` -- leak
    cached media between tests and even between separate `pytest` invocations."""
    return hass_tmp_config_dir


@pytest.fixture
def clock() -> FakeClockDevice:
    """A freshly scripted iLedClock, answering from the live-captured replies by default.
    Mutate `.reply_overrides`/`.silent_keys`/`.connect_error`/etc. before the config entry is
    set up (or before a command is sent) to script misbehaviour for one test."""
    return FakeClockDevice()


class Advertising:
    """Whether any scanner currently hears the clock advertise (what `bluetooth.async_last_service_info`
    reports). Heard by default; a test sets `heard = False` to make the clock go silent."""

    heard = True


@pytest.fixture
def advertising() -> Advertising:
    return Advertising()


@pytest.fixture(autouse=True)
def _patch_ble_transport(clock: FakeClockDevice, advertising: Advertising):
    """Route `client.py`'s BLE device lookup and GATT connect to `clock` instead of any real
    adapter. Everything above this -- framing, chunking, request/reply correlation, retries,
    idle-disconnect, and everything the coordinator/entities/websocket API/services do with it
    -- stays real (see `fake_clock.py`'s module docstring)."""

    def _ble_device_from_address(hass: Any, address: str, connectable: bool = True) -> BLEDevice | None:
        if address != clock.address:
            return None
        return BLEDevice(address=clock.address, name=clock.name, details={})

    def _last_service_info(hass: Any, address: str, connectable: bool = True) -> Any:
        if address != clock.address or not advertising.heard:
            return None
        return SimpleNamespace(time=time.monotonic())

    async def _establish_connection(
        client_class: Any, device: Any, name: str, disconnected_callback: Any = None, **kwargs: Any
    ) -> Any:
        return clock.new_client(disconnected_callback=disconnected_callback)

    with (
        patch(
            "custom_components.iledclock.client.bluetooth.async_ble_device_from_address",
            side_effect=_ble_device_from_address,
        ),
        patch(
            "custom_components.iledclock.client.bluetooth.async_last_service_info",
            side_effect=_last_service_info,
        ),
        patch(
            "custom_components.iledclock.client.establish_connection",
            side_effect=_establish_connection,
        ),
    ):
        yield


@pytest.fixture
def make_config_entry(hass, clock: FakeClockDevice):
    """Factory: build and register (but do not set up) a `MockConfigEntry` pointing at
    `clock.address`. Returns the entry so a test can inspect/mutate it before setup."""

    def _make(*, options: dict[str, Any] | None = None, data: dict[str, Any] | None = None) -> MockConfigEntry:
        entry = MockConfigEntry(
            domain=DOMAIN,
            unique_id=clock.address,
            data={CONF_ADDRESS: clock.address, **(data or {})},
            options=options or {},
        )
        entry.add_to_hass(hass)
        return entry

    return _make


@pytest.fixture
async def config_entry(hass, make_config_entry) -> MockConfigEntry:
    """A config entry for `clock`, already set up through real HA machinery (config entry
    forwarding, the coordinator's first refresh, every entity platform)."""
    entry = make_config_entry()
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    return entry
