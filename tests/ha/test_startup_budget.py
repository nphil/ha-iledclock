"""Home Assistant's startup never waits on the clock for more than the setup budget.

HA reports "initialized" only after every integration's setup returns, and a clock that is out of range,
behind a busy proxy or stuck in a GATT step used to hold that up (measured 7.55 s). Setup now waits at most
`SETUP_BUDGET_S` for the first refresh; connecting, the password handshake and the status reads carry on in
a task the config entry owns, and the entities fill in when they land.
"""

from __future__ import annotations

import asyncio
import time
from datetime import datetime
from unittest.mock import patch

import pytest
from homeassistant.config_entries import ConfigEntryState
from homeassistant.const import STATE_UNAVAILABLE
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er

from custom_components.iledclock import shutdown
from custom_components.iledclock.client import IledClockConnectionError
from custom_components.iledclock.protocol import commands, responses

from .fake_clock import FakeClockDevice, FakeGattClient

BUDGET = 0.3  # stands in for the real 5 s; the code under test only reads the constant


class _SlowRadio:
    """Stands in for `establish_connection`: the link is not made until the test says so."""

    def __init__(self, clock: FakeClockDevice) -> None:
        self._clock = clock
        self.open = asyncio.Event()
        self.attempts = 0

    async def establish(self, client_class, device, name, disconnected_callback=None, **kwargs):
        self.attempts += 1
        await self.open.wait()
        return self._clock.new_client(disconnected_callback=disconnected_callback)


@pytest.fixture
def slow_radio(clock: FakeClockDevice):
    radio = _SlowRadio(clock)
    with (
        patch("custom_components.iledclock.client.establish_connection", side_effect=radio.establish),
        patch("custom_components.iledclock.SETUP_BUDGET_S", BUDGET),
    ):
        yield radio


def _entities(hass, entry) -> dict[str, str]:
    registry = er.async_get(hass)
    return {
        entity.unique_id.split("_", 1)[1] if "_" in entity.unique_id else entity.unique_id: entity.entity_id
        for entity in er.async_entries_for_config_entry(registry, entry.entry_id)
    }


async def _until(condition, timeout: float = 5.0) -> None:
    """Background tasks are not waited for by `async_block_till_done`; poll for what they will produce."""
    async with asyncio.timeout(timeout):
        while not condition():
            await asyncio.sleep(0.01)


def _device(hass, entry):
    (device,) = dr.async_entries_for_config_entry(dr.async_get(hass), entry.entry_id)
    return device


async def test_setup_returns_within_budget_when_the_clock_never_answers(
    hass, make_config_entry, clock: FakeClockDevice, slow_radio: _SlowRadio
) -> None:
    """S6a: a link that never comes up costs setup its budget, not the connect's own time, and does not
    make the entry retry (the background task can recover on its own)."""
    entry = make_config_entry()

    started = time.monotonic()
    assert await hass.config_entries.async_setup(entry.entry_id)
    elapsed = time.monotonic() - started

    assert elapsed < BUDGET + 1.5
    assert entry.state is ConfigEntryState.LOADED
    assert slow_radio.attempts == 1  # the connect is still running in the background

    # Nothing is invented while we wait: every entity but the connectivity indicator is unavailable.
    states = {
        entity_id: hass.states.get(entity_id).state
        for key, entity_id in _entities(hass, entry).items()
        if key != "connected" and hass.states.get(entity_id) is not None  # (some are disabled by default)
    }
    assert len(states) >= 6 and set(states.values()) == {STATE_UNAVAILABLE}
    assert hass.states.get(_entities(hass, entry)["connected"]).state == "off"
    assert clock.written == []

    # Unloading stops the background connect for good, without waiting for it to give up by itself.
    started = time.monotonic()
    assert await hass.config_entries.async_unload(entry.entry_id)
    await hass.async_block_till_done()
    assert time.monotonic() - started < 2.0
    assert clock.connections == 0


async def test_entities_populate_when_data_arrives_after_setup(
    hass, make_config_entry, clock: FakeClockDevice, slow_radio: _SlowRadio
) -> None:
    """S6b: the first read lands after setup returned: entities turn available with the clock's values,
    the temperature sensor (decided from the first read) is created late, and the device gets its firmware."""
    clock.reply_overrides[responses.response_key(bytes.fromhex("1901"))] = bytes.fromhex("190101653c")
    entry = make_config_entry()
    assert await hass.config_entries.async_setup(entry.entry_id)
    coordinator = entry.runtime_data
    assert coordinator.has_data is False
    assert "temperature" not in _entities(hass, entry)
    assert _device(hass, entry).sw_version is None

    slow_radio.open.set()
    await _until(lambda: coordinator.has_data)
    await hass.async_block_till_done()

    assert coordinator.has_data is True
    assert coordinator.data.firmware == 33
    entities = _entities(hass, entry)
    assert hass.states.get(entities["firmware"]).state == "33"
    assert hass.states.get(entities["display"]).state != STATE_UNAVAILABLE
    assert hass.states.get(entities["connected"]).state == "on"
    assert hass.states.get(entities["temperature"]).state == "22.5"
    assert hass.states.get(entities["humidity"]).state == "60"
    assert _device(hass, entry).sw_version == "33"


async def test_late_first_read_sends_nothing_a_normal_refresh_would_not(
    hass, make_config_entry, clock: FakeClockDevice, slow_radio: _SlowRadio
) -> None:
    """S6c: the entities going from unavailable to a state actuates nothing: the late first refresh puts
    on the wire only what a periodic refresh does (handshake and reads), plus the one startup time sync."""
    entry = make_config_entry()
    assert await hass.config_entries.async_setup(entry.entry_id)
    assert clock.written == []

    slow_radio.open.set()
    await _until(lambda: entry.runtime_data.has_data)
    await hass.async_block_till_done()
    first = set(clock.opcodes_written())
    assert first

    coordinator = entry.runtime_data
    await coordinator.client.async_release()
    clock.written.clear()
    await coordinator.async_refresh()
    periodic = set(clock.opcodes_written())

    time_sync = commands.sync_time(datetime(2026, 1, 1))[0]
    assert first - periodic <= {time_sync}
    # No program upload, power, brightness or reminder write ever happened.
    assert not first & {0x02, 0x03}


async def test_setup_that_finishes_inside_the_budget_behaves_as_before(hass, config_entry, clock: FakeClockDevice) -> None:
    """A responsive clock: everything is read before setup returns, nothing is left pending."""
    coordinator = config_entry.runtime_data
    assert coordinator.has_data is True
    assert coordinator.data.connected is True
    entities = _entities(hass, config_entry)
    assert hass.states.get(entities["firmware"]).state == "33"


async def test_latch_during_background_first_refresh_never_connects(
    hass, make_config_entry, clock: FakeClockDevice, slow_radio: _SlowRadio
) -> None:
    """S5: shutdown begins while the first connect is still pending: the link, once it comes up, is handed
    straight back, and nothing is counted as a failure."""
    entry = make_config_entry()
    assert await hass.config_entries.async_setup(entry.entry_id)
    coordinator = entry.runtime_data

    release = asyncio.create_task(coordinator.async_release_at_shutdown())  # waits for the pending connect
    await asyncio.sleep(0)
    slow_radio.open.set()
    await release
    await hass.async_block_till_done()

    assert shutdown.in_progress(hass)
    assert clock.connected is False
    assert clock.written == []
    assert coordinator.data.consecutive_failures == 0
    assert coordinator.last_update_success is True


async def test_stuck_notify_subscription_fails_fast(hass, config_entry, clock: FakeClockDevice) -> None:
    """S4: a subscribe that never completes ends the connect attempt at the step limit, as a connection
    error the refresh counts, not as a hang."""
    client = config_entry.runtime_data.client
    await client.async_release()

    async def _never(self, *args, **kwargs) -> None:
        await asyncio.sleep(3600)

    with (
        patch("custom_components.iledclock.client.CONNECT_STEP_TIMEOUT_S", 0.2),
        patch.object(FakeGattClient, "start_notify", _never),
    ):
        started = time.monotonic()
        with pytest.raises(IledClockConnectionError, match="notifications"):
            await client.async_connect()
        assert time.monotonic() - started < 2.0
    assert clock.connected is False


async def test_stuck_connect_fails_fast(hass, config_entry, clock: FakeClockDevice) -> None:
    """S4: same for the connect itself."""
    client = config_entry.runtime_data.client
    await client.async_release()

    async def _never(*args, **kwargs):
        await asyncio.sleep(3600)

    with (
        patch("custom_components.iledclock.client.CONNECT_STEP_TIMEOUT_S", 0.2),
        patch("custom_components.iledclock.client.establish_connection", side_effect=_never),
    ):
        started = time.monotonic()
        with pytest.raises(IledClockConnectionError, match="could not connect"):
            await client.async_connect()
        assert time.monotonic() - started < 2.0


async def test_reading_that_lands_during_unload_adds_no_sensors(
    hass, make_config_entry, clock: FakeClockDevice, slow_radio: _SlowRadio
) -> None:
    """Reload race: the first temperature/humidity reading must not create entities on a sensor platform that
    is being unloaded (they would clash with the replacements). The pending first read is stopped, and late
    additions refused, before the platforms go."""
    clock.reply_overrides[responses.response_key(bytes.fromhex("1901"))] = bytes.fromhex("190101653c")
    entry = make_config_entry()
    assert await hass.config_entries.async_setup(entry.entry_id)
    coordinator = entry.runtime_data
    real_unload_platforms = hass.config_entries.async_unload_platforms

    async def _unload_then_clock_answers(*args, **kwargs):
        result = await real_unload_platforms(*args, **kwargs)
        slow_radio.open.set()  # the link comes up only once the platforms are gone
        await asyncio.sleep(0.5)
        return result

    with patch.object(hass.config_entries, "async_unload_platforms", _unload_then_clock_answers):
        assert await hass.config_entries.async_unload(entry.entry_id)
    await hass.async_block_till_done()

    assert coordinator.has_data is False
    assert clock.connections == 0
    registry = er.async_get(hass)
    assert registry.async_get_entity_id("sensor", "iledclock", f"{clock.address}_temperature") is None
    assert registry.async_get_entity_id("sensor", "iledclock", f"{clock.address}_humidity") is None


async def test_late_additions_refuse_once_unloading_starts(
    hass, make_config_entry, clock: FakeClockDevice, slow_radio: _SlowRadio
) -> None:
    """Even if a reading is already in flight (a periodic refresh, not the cancelled first one), the late-add
    listener does nothing once the entry is unloading."""
    clock.reply_overrides[responses.response_key(bytes.fromhex("1901"))] = bytes.fromhex("190101653c")
    entry = make_config_entry()
    assert await hass.config_entries.async_setup(entry.entry_id)
    coordinator = entry.runtime_data

    coordinator.unloading = True
    slow_radio.open.set()
    await _until(lambda: coordinator.has_data or coordinator.startup_refresh.done())
    await hass.async_block_till_done()

    assert coordinator.data.temperature == 22.5
    assert "temperature" not in _entities(hass, entry)


async def test_failed_unload_resumes_the_first_read(
    hass, make_config_entry, clock: FakeClockDevice, slow_radio: _SlowRadio
) -> None:
    """If the platforms refuse to unload the entry stays loaded: the stopped first read starts again, and the
    late sensors are still added."""
    clock.reply_overrides[responses.response_key(bytes.fromhex("1901"))] = bytes.fromhex("190101653c")
    entry = make_config_entry()
    assert await hass.config_entries.async_setup(entry.entry_id)
    coordinator = entry.runtime_data

    async def _refuse(*args, **kwargs):
        return False

    with patch.object(hass.config_entries, "async_unload_platforms", _refuse):
        assert not await hass.config_entries.async_unload(entry.entry_id)
    assert coordinator.unloading is False

    slow_radio.open.set()
    await _until(lambda: coordinator.has_data)
    await hass.async_block_till_done()
    assert "temperature" in _entities(hass, entry)

    await coordinator.async_unload()  # the entry is FAILED_UNLOAD (not unloadable again); clean up by hand
    await coordinator.async_shutdown()


async def test_subscribe_passes_a_backend_timeout_shorter_than_the_outer_guard(
    hass, config_entry, clock: FakeClockDevice
) -> None:
    """S8: the proxy backend's own `timeout` bounds the subscribe so it can unregister its notification handler;
    cancelling it from outside would leave a stale handler on the proxy connection."""
    from custom_components.iledclock.const import CONNECT_STEP_TIMEOUT_S, NOTIFY_BACKEND_TIMEOUT_S

    client = config_entry.runtime_data.client
    await client.async_release()
    seen: list[dict] = []
    real = FakeGattClient.start_notify

    async def _spy(self, char_specifier, callback, **kwargs):
        seen.append(kwargs)
        await real(self, char_specifier, callback, **kwargs)

    with patch.object(FakeGattClient, "start_notify", _spy):
        await client.async_connect()

    assert seen == [{"timeout": NOTIFY_BACKEND_TIMEOUT_S}]
    assert NOTIFY_BACKEND_TIMEOUT_S * 2 <= CONNECT_STEP_TIMEOUT_S  # two proxy round-trips fit inside the guard


async def test_backend_subscribe_timeout_is_a_connection_error_not_a_hang(
    hass, config_entry, clock: FakeClockDevice
) -> None:
    """S8: a backend that gives up on its own (raising TimeoutError after its `timeout`) ends the attempt as an
    ordinary connection error; the link is handed back."""
    client = config_entry.runtime_data.client
    await client.async_release()

    async def _backend_gives_up(self, char_specifier, callback, **kwargs):
        assert kwargs["timeout"] > 0
        raise TimeoutError

    with patch.object(FakeGattClient, "start_notify", _backend_gives_up):
        with pytest.raises(IledClockConnectionError, match="notifications"):
            await client.async_connect()
    assert clock.connected is False


async def test_a_cancelled_disconnect_finishes_in_the_background(
    hass, config_entry, clock: FakeClockDevice
) -> None:
    """S8: teardown is not abandoned half-way when its caller is cancelled (the shutdown job's bound)."""
    gate = asyncio.Event()
    finished: list[bool] = []

    async def _slow_disconnect(self, **kwargs) -> None:
        await gate.wait()
        finished.append(True)
        self._device.mark_disconnected()

    with patch.object(FakeGattClient, "disconnect", _slow_disconnect):
        release = asyncio.create_task(config_entry.runtime_data.client.async_release())
        await asyncio.sleep(0.05)
        release.cancel()
        with pytest.raises(asyncio.CancelledError):
            await release
        assert finished == []
        gate.set()
        await asyncio.sleep(0.05)

    assert finished == [True]
    assert clock.connected is False
