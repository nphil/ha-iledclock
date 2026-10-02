"""Home Assistant shutdown releases the GATT link (Stage-1 shutdown job), once, for good.

HA runs `hass.async_add_shutdown_job` jobs before it fires `EVENT_HOMEASSISTANT_STOP`, while the
Bluetooth stack and the ESPHome proxy connections are still alive. The job must drop the link,
latch the client closed so nothing reconnects in this process, stay inside its own time budget
and never raise.
"""

from __future__ import annotations

import asyncio
import logging
import time
from unittest.mock import patch

import pytest
from homeassistant.core import HomeAssistant
from homeassistant.helpers import device_registry as dr

from custom_components.iledclock.client import IledClockConnectionError
from custom_components.iledclock.const import DOMAIN

from .fake_clock import FakeClockDevice, FakeGattClient


@pytest.fixture
def device_id(hass, config_entry) -> str:
    devices = dr.async_entries_for_config_entry(dr.async_get(hass), config_entry.entry_id)
    assert len(devices) == 1
    return devices[0].id


def _release_jobs(hass: HomeAssistant) -> list:
    return [
        job_with_args
        for job_with_args in hass._shutdown_jobs  # noqa: SLF001 - no public accessor
        if "iledclock release BLE link" in str(job_with_args.job.name)
    ]


async def _run_release_job(hass: HomeAssistant) -> None:
    (job_with_args,) = _release_jobs(hass)
    await hass.async_run_hass_job(job_with_args.job, *job_with_args.args)


async def test_one_shutdown_job_per_entry_and_removed_on_unload(
    hass, config_entry, clock: FakeClockDevice
) -> None:
    assert len(_release_jobs(hass)) == 1

    assert await hass.config_entries.async_unload(config_entry.entry_id)
    await hass.async_block_till_done()

    assert _release_jobs(hass) == []


async def test_shutdown_job_releases_link_and_latches(
    hass, config_entry, clock: FakeClockDevice, caplog: pytest.LogCaptureFixture
) -> None:
    coordinator = config_entry.runtime_data
    assert clock.connected is True

    with caplog.at_level(logging.INFO, logger="custom_components.iledclock.coordinator"):
        await _run_release_job(hass)

    assert clock.connected is False
    assert "Released BLE link to" in caplog.text

    # Latched: neither a refresh, a command nor a direct connect may open the link again.
    with pytest.raises(IledClockConnectionError):
        await coordinator.client.async_connect()
    with pytest.raises(IledClockConnectionError):
        await coordinator.client.async_request(b"\x01")
    await coordinator.async_refresh()
    assert clock.connected is False

    # Running the job a second time is harmless.
    await _run_release_job(hass)
    assert clock.connected is False


async def test_shutdown_job_cancels_idle_timer(hass, config_entry, clock: FakeClockDevice) -> None:
    client = config_entry.runtime_data.client
    assert client._cancel_idle_disconnect is not None  # noqa: SLF001 - idle timer armed after refresh

    await _run_release_job(hass)

    assert client._cancel_idle_disconnect is None  # noqa: SLF001


async def test_shutdown_job_with_kept_connection_forever(
    hass, make_config_entry, clock: FakeClockDevice
) -> None:
    """`idle_timeout = 0` keeps the link up indefinitely -- exactly the case that needs the job."""
    entry = make_config_entry(options={"idle_timeout": 0})
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    assert clock.connected is True

    await _run_release_job(hass)

    assert clock.connected is False
    assert entry.state.value == "loaded"  # released only; the entry is not unloaded


async def test_release_link_service_still_reconnects_before_shutdown(
    hass, config_entry, clock: FakeClockDevice, device_id: str
) -> None:
    """The manual `release_link` action is a plain disconnect, not the one-way latch."""
    await hass.services.async_call(DOMAIN, "release_link", {"device_id": device_id}, blocking=True)
    assert clock.connected is False

    await config_entry.runtime_data.client.async_connect()
    assert clock.connected is True


async def test_connect_in_flight_when_shutdown_begins_is_handed_back(
    hass, config_entry, clock: FakeClockDevice
) -> None:
    client = config_entry.runtime_data.client
    await client.async_release()
    assert clock.connected is False

    real_new_client = clock.new_client

    def _latch_then_connect(disconnected_callback=None):
        client._closing = True  # noqa: SLF001 - shutdown starts while establish_connection runs
        return real_new_client(disconnected_callback=disconnected_callback)

    with patch.object(clock, "new_client", side_effect=_latch_then_connect):
        with pytest.raises(IledClockConnectionError):
            await client.async_connect()

    assert clock.connected is False
    assert client.is_connected is False


async def test_hanging_disconnect_is_bounded_and_does_not_raise(
    hass, config_entry, clock: FakeClockDevice, caplog: pytest.LogCaptureFixture
) -> None:
    async def _never_returns(self, **kwargs) -> None:
        await asyncio.sleep(3600)

    with (
        patch("custom_components.iledclock.coordinator.SHUTDOWN_RELEASE_TIMEOUT_S", 0.2),
        patch.object(FakeGattClient, "disconnect", _never_returns),
        caplog.at_level(logging.WARNING, logger="custom_components.iledclock.coordinator"),
    ):
        started = time.monotonic()
        await _run_release_job(hass)  # must return, not raise
        elapsed = time.monotonic() - started

    assert elapsed < 2.0
    assert "Timed out releasing BLE link" in caplog.text
    # Even though the disconnect hung, the client is latched.
    with pytest.raises(IledClockConnectionError):
        await config_entry.runtime_data.client.async_connect()


async def test_failing_disconnect_does_not_raise(
    hass, config_entry, clock: FakeClockDevice, caplog: pytest.LogCaptureFixture
) -> None:
    async def _boom(self, **kwargs) -> None:
        raise RuntimeError("proxy went away")

    with (
        patch.object(FakeGattClient, "disconnect", _boom),
        caplog.at_level(logging.WARNING, logger="custom_components.iledclock.coordinator"),
    ):
        await _run_release_job(hass)

    assert "Could not release BLE link" in caplog.text
