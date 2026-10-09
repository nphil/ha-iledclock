"""Silent ghost links, and the link facts on the "Connected" sensor.

A proxy glitch can leave a proxy's radio holding the clock's connection after its host forgot it: the clock
believes it is connected, never advertises again, and this integration (which only gets replies to requests)
hears nothing either. After `GHOST_SILENCE_S` without an advertisement since the last link ended, the next
connect attempt asks the proxy that last held the link to disconnect connection handles 0..3 one at a time.
"""

from __future__ import annotations

import asyncio
import logging

import pytest
from bleak.exc import BleakError
from homeassistant.core import HomeAssistant
from homeassistant.helpers import entity_registry as er

from custom_components.iledclock import shutdown
from custom_components.iledclock.client import IledClockConnectionError, IledClockShuttingDownError
from custom_components.iledclock.const import (
    CONF_IDLE_TIMEOUT,
    CONF_LAST_HOLDING_PROXY,
    CONF_REFRESH_INTERVAL,
    DOMAIN,
)

from .conftest import Advertising
from .fake_clock import FakeClockDevice

PROXY = "plant-room-bluetooth-proxy"
FREE_ACTION = "plant_room_bluetooth_proxy_force_disconnect_handle"


@pytest.fixture(autouse=True)
def _fast_ghost_timing(monkeypatch: pytest.MonkeyPatch) -> None:
    from custom_components.iledclock import client as client_module

    monkeypatch.setattr(client_module, "GHOST_SILENCE_S", 0.2)
    monkeypatch.setattr(client_module, "GHOST_LISTEN_S", 0.2)
    monkeypatch.setattr(client_module, "GHOST_RETRY_S", (0.6,))


def _proxy_frees(hass: HomeAssistant, on_free=lambda _handle: None) -> list[int]:
    """Give the last holding proxy its `force_disconnect_handle` action; returns the handles it was asked to free."""
    freed: list[int] = []

    async def _free(call) -> None:
        freed.append(call.data["handle"])
        on_free(call.data["handle"])

    hass.services.async_register("esphome", FREE_ACTION, _free)
    return freed


@pytest.fixture
async def held_entry(hass, make_config_entry, clock: FakeClockDevice):
    """An entry whose clock was last carried by the plant-room proxy; the link is then released, so the silence
    clock starts."""
    clock.scanner_adapter = PROXY
    entry = make_config_entry()
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    assert entry.data[CONF_LAST_HOLDING_PROXY] == PROXY
    await entry.runtime_data.client.async_release()
    return entry


async def test_the_proxy_carrying_the_link_is_remembered(hass, config_entry, clock: FakeClockDevice) -> None:
    assert CONF_LAST_HOLDING_PROXY not in config_entry.data  # a local adapter has no proxy name

    clock.scanner_adapter = PROXY
    client = config_entry.runtime_data.client
    await client.async_release()
    await client.async_connect()

    assert config_entry.data[CONF_LAST_HOLDING_PROXY] == PROXY
    assert client.route_adapter == PROXY


async def test_a_clock_silent_after_its_link_ends_is_freed_from_the_proxy_that_last_held_it(
    hass, held_entry, clock: FakeClockDevice, advertising: Advertising, caplog: pytest.LogCaptureFixture
) -> None:
    client = held_entry.runtime_data.client

    def _free(handle: int) -> None:
        if handle == 2:  # the ghost was connection 2: the clock advertises again and accepts a link
            advertising.heard, clock.connect_error = True, None

    freed = _proxy_frees(hass, _free)
    advertising.heard, clock.connect_error = False, BleakError("held by a ghost link")

    await asyncio.sleep(0.3)
    with caplog.at_level(logging.INFO):
        await client.async_connect()

    assert freed == [0, 1, 2]
    assert client.is_connected
    assert client.ghost_links_freed == 1
    assert client.link_snapshot()["last_ghost_try"] == f"freed connection 2 on {PROXY}"
    assert f"freed a ghost link on {PROXY} (connection 2)" in caplog.text


async def test_a_clock_that_is_heard_but_cannot_connect_is_never_swept(
    hass, held_entry, clock: FakeClockDevice
) -> None:
    client = held_entry.runtime_data.client
    freed = _proxy_frees(hass)
    clock.connect_error = BleakError("proxy busy")  # still advertising, just not connectable right now

    for _ in range(3):
        await asyncio.sleep(0.15)
        with pytest.raises(IledClockConnectionError):
            await client.async_connect()

    assert freed == []
    assert client.link_snapshot()["last_ghost_try"] is None


async def test_a_proxy_without_the_free_action_is_left_alone(
    hass, held_entry, clock: FakeClockDevice, advertising: Advertising
) -> None:
    client = held_entry.runtime_data.client
    advertising.heard, clock.connect_error = False, BleakError("held by a ghost link")

    await asyncio.sleep(0.3)
    with pytest.raises(IledClockConnectionError):
        await client.async_connect()
    assert client.link_snapshot()["last_ghost_try"] == f"silent; {PROXY} cannot free a link"

    advertising.heard, clock.connect_error = True, None
    await client.async_connect()
    assert client.is_connected


async def test_a_clock_still_silent_after_every_connection_is_freed_waits_before_the_next_pass(
    hass, held_entry, clock: FakeClockDevice, advertising: Advertising, caplog: pytest.LogCaptureFixture
) -> None:
    client = held_entry.runtime_data.client
    freed = _proxy_frees(hass)
    advertising.heard, clock.connect_error = False, BleakError("unplugged")

    await asyncio.sleep(0.3)
    with pytest.raises(IledClockConnectionError):
        await client.async_connect()  # a whole pass: 4 handles, each listened to for 0.2 s
    assert freed == [0, 1, 2, 3]
    assert client.link_snapshot()["last_ghost_try"] == f"still silent after freeing connections on {PROXY}"
    assert "it may be unplugged" in caplog.text

    # The 0.6 s pause counts from the END of the pass (the pass itself took 0.8 s): 0.3 s later is too soon.
    await asyncio.sleep(0.3)
    with pytest.raises(IledClockConnectionError):
        await client.async_connect()
    assert freed == [0, 1, 2, 3]

    await asyncio.sleep(0.4)
    with pytest.raises(IledClockConnectionError):
        await client.async_connect()
    assert freed == [0, 1, 2, 3] * 2
    assert client.ghost_links_freed == 0


async def test_nothing_is_freed_once_the_shutdown_latch_is_set(
    hass, held_entry, clock: FakeClockDevice, advertising: Advertising
) -> None:
    client = held_entry.runtime_data.client
    freed = _proxy_frees(hass)
    advertising.heard, clock.connect_error = False, BleakError("held by a ghost link")

    await asyncio.sleep(0.3)
    shutdown.begin(hass)
    with pytest.raises(IledClockShuttingDownError):
        await client.async_connect()

    assert freed == []


async def test_a_pass_stops_when_shutdown_latches_midway(
    hass, held_entry, clock: FakeClockDevice, advertising: Advertising
) -> None:
    client = held_entry.runtime_data.client
    freed = _proxy_frees(hass, lambda handle: shutdown.begin(hass) if handle == 1 else None)
    advertising.heard, clock.connect_error = False, BleakError("held by a ghost link")

    await asyncio.sleep(0.3)
    with pytest.raises(IledClockShuttingDownError):
        await client.async_connect()

    assert freed == [0, 1]


# -- the "Connected" sensor's link facts ---------------------------------------------------------------------


def _connected_attributes(hass: HomeAssistant, clock: FakeClockDevice) -> dict:
    entity_id = er.async_get(hass).async_get_entity_id("binary_sensor", DOMAIN, f"{clock.address}_connected")
    assert entity_id is not None
    state = hass.states.get(entity_id)
    assert state is not None
    return dict(state.attributes)


async def test_the_connected_sensor_reports_the_link_facts(hass, make_config_entry, clock: FakeClockDevice) -> None:
    clock.scanner_adapter = PROXY
    entry = make_config_entry()
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()

    attributes = _connected_attributes(hass, clock)
    assert attributes["proxy"] == PROXY
    assert attributes["hold"] is False  # default: idle disconnect after 60 s, refresh every 15 min
    assert attributes["drops_1h"] == 0
    assert attributes["preferred_proxy"] == ""
    assert attributes["via_preferred_proxy"] is None

    # A link the clock ends is a drop; one we end (release, idle disconnect) is not.
    clock.mark_disconnected()
    await hass.async_block_till_done()
    attributes = _connected_attributes(hass, clock)
    assert attributes["drops_1h"] == 1
    assert attributes["proxy"] is None

    await entry.runtime_data.client.async_connect()
    await hass.async_block_till_done()
    assert _connected_attributes(hass, clock)["proxy"] == PROXY
    await entry.runtime_data.client.async_release()
    await hass.async_block_till_done()
    attributes = _connected_attributes(hass, clock)
    assert attributes["drops_1h"] == 1
    assert attributes["proxy"] is None


@pytest.mark.parametrize(
    ("options", "hold"),
    [
        ({CONF_IDLE_TIMEOUT: 0}, True),
        ({CONF_IDLE_TIMEOUT: 120, CONF_REFRESH_INTERVAL: 1}, True),  # refreshed every 60 s: never idles out
        ({CONF_IDLE_TIMEOUT: 60, CONF_REFRESH_INTERVAL: 1}, False),
        ({CONF_IDLE_TIMEOUT: 60, CONF_REFRESH_INTERVAL: 15}, False),
    ],
)
async def test_hold_says_whether_the_link_is_kept_open(
    hass, make_config_entry, clock: FakeClockDevice, options: dict, hold: bool
) -> None:
    entry = make_config_entry(options=options)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()

    assert _connected_attributes(hass, clock)["hold"] is hold


async def test_diagnostics_link_facts(hass, held_entry) -> None:
    assert held_entry.runtime_data.client.link_snapshot() == {
        "route_adapter": None,
        "drops_1h": 0,
        "ghost_links_freed": 0,
        "last_ghost_try": None,
    }
