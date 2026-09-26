"""Config flow (Contract B / docs/ARCHITECTURE.md): Bluetooth discovery confirm, the manual
user step over already-discovered clocks, and the options flow (idle_timeout/refresh_interval/
password/time_sync plus the write-only Divoom Cloud password -> md5)."""

from __future__ import annotations

import hashlib
from unittest.mock import patch

import pytest
from homeassistant import config_entries
from homeassistant.const import CONF_ADDRESS
from homeassistant.data_entry_flow import FlowResultType

from custom_components.iledclock.const import (
    BLE_LOCAL_NAME,
    CONF_DIVOOM_EMAIL,
    CONF_DIVOOM_PASSWORD_MD5,
    CONF_IDLE_TIMEOUT,
    CONF_PASSWORD,
    CONF_REFRESH_INTERVAL,
    CONF_TIME_SYNC,
    DOMAIN,
)

from .fake_clock import FakeClockDevice, make_service_info


async def test_bluetooth_discovery_confirm(hass, clock: FakeClockDevice) -> None:
    """A clock advertises: the flow starts at `bluetooth_confirm` titled 'iLedClock', and
    confirming creates the entry with the discovered address."""
    result = await hass.config_entries.flow.async_init(
        DOMAIN,
        context={"source": config_entries.SOURCE_BLUETOOTH},
        data=clock.service_info(),
    )
    assert result["type"] is FlowResultType.FORM
    assert result["step_id"] == "bluetooth_confirm"

    result = await hass.config_entries.flow.async_configure(result["flow_id"], user_input={})
    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert result["title"] == "iLedClock"
    assert result["data"] == {CONF_ADDRESS: clock.address}

    entries = hass.config_entries.async_entries(DOMAIN)
    assert len(entries) == 1
    assert entries[0].unique_id == clock.address


async def test_bluetooth_discovery_confirm_title_uses_local_name(hass, clock: FakeClockDevice) -> None:
    """`context["title_placeholders"]` names the advertised device -- confirms the discovery
    form itself (not just the final entry) carries a human-readable 'iLedClock' name."""
    result = await hass.config_entries.flow.async_init(
        DOMAIN,
        context={"source": config_entries.SOURCE_BLUETOOTH},
        data=clock.service_info(),
    )
    assert result["type"] is FlowResultType.FORM
    flow = hass.config_entries.flow.async_get(result["flow_id"])
    assert flow["context"]["title_placeholders"] == {"name": BLE_LOCAL_NAME}


async def test_bluetooth_discovery_already_configured_aborts(hass, clock: FakeClockDevice) -> None:
    """A second advertisement from an address that already has an entry must not create a
    duplicate -- `_abort_if_unique_id_configured`."""
    result = await hass.config_entries.flow.async_init(
        DOMAIN, context={"source": config_entries.SOURCE_BLUETOOTH}, data=clock.service_info()
    )
    await hass.config_entries.flow.async_configure(result["flow_id"], user_input={})

    result = await hass.config_entries.flow.async_init(
        DOMAIN, context={"source": config_entries.SOURCE_BLUETOOTH}, data=clock.service_info()
    )
    assert result["type"] is FlowResultType.ABORT
    assert result["reason"] == "already_configured"


async def test_user_step_lists_discovered_clocks(hass, clock: FakeClockDevice) -> None:
    """The manual user step offers every iLedClock the Bluetooth stack has already seen
    (`_async_find_clocks`), and picking one creates the entry."""
    with patch(
        "custom_components.iledclock.config_flow.bluetooth.async_discovered_service_info",
        return_value=[clock.service_info()],
    ):
        result = await hass.config_entries.flow.async_init(
            DOMAIN, context={"source": config_entries.SOURCE_USER}
        )
        assert result["type"] is FlowResultType.FORM
        assert result["step_id"] == "user"
        schema_keys = {str(key) for key in result["data_schema"].schema}
        assert CONF_ADDRESS in schema_keys

        result = await hass.config_entries.flow.async_configure(
            result["flow_id"], user_input={CONF_ADDRESS: clock.address}
        )
    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert result["title"] == "iLedClock"
    assert result["data"] == {CONF_ADDRESS: clock.address}


async def test_user_step_no_devices_aborts(hass) -> None:
    """No clock has ever been seen: the user step aborts rather than showing an empty picker."""
    with patch(
        "custom_components.iledclock.config_flow.bluetooth.async_discovered_service_info",
        return_value=[],
    ):
        result = await hass.config_entries.flow.async_init(
            DOMAIN, context={"source": config_entries.SOURCE_USER}
        )
    assert result["type"] is FlowResultType.ABORT
    assert result["reason"] == "no_devices_found"


async def test_user_step_ignores_unrelated_bluetooth_devices(hass, clock: FakeClockDevice) -> None:
    """A nearby BLE device that is neither named 'iLedClock' nor advertising the clock's
    service UUID must not show up in the picker."""
    unrelated = make_service_info(
        "AA:BB:CC:00:00:99", name="SomeOtherThing", service_uuids=("0000180f-0000-1000-8000-00805f9b34fb",)
    )
    with patch(
        "custom_components.iledclock.config_flow.bluetooth.async_discovered_service_info",
        return_value=[unrelated],
    ):
        result = await hass.config_entries.flow.async_init(
            DOMAIN, context={"source": config_entries.SOURCE_USER}
        )
    assert result["type"] is FlowResultType.ABORT
    assert result["reason"] == "no_devices_found"


# -- Options flow --------------------------------------------------------------------------


async def test_options_flow_updates_settings(hass, config_entry) -> None:
    """idle_timeout/refresh_interval/password/time_sync all round-trip through the options
    flow and land on the config entry's `options`."""
    result = await hass.config_entries.options.async_init(config_entry.entry_id)
    assert result["type"] is FlowResultType.FORM
    assert result["step_id"] == "init"

    result = await hass.config_entries.options.async_configure(
        result["flow_id"],
        user_input={
            CONF_IDLE_TIMEOUT: 120,
            CONF_REFRESH_INTERVAL: 30,
            CONF_PASSWORD: "1a2b3c",
            CONF_TIME_SYNC: False,
            CONF_DIVOOM_EMAIL: "",
            "divoom_password": "",
        },
    )
    await hass.async_block_till_done()
    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert config_entry.options[CONF_IDLE_TIMEOUT] == 120
    assert config_entry.options[CONF_REFRESH_INTERVAL] == 30
    assert config_entry.options[CONF_PASSWORD] == "1a2b3c"
    assert config_entry.options[CONF_TIME_SYNC] is False


async def test_options_flow_invalid_password_reshows_form(hass, config_entry) -> None:
    """A password that isn't exactly 6 hex characters is rejected with a form error, not a
    crash or a silently-accepted bad value."""
    result = await hass.config_entries.options.async_init(config_entry.entry_id)
    result = await hass.config_entries.options.async_configure(
        result["flow_id"],
        user_input={
            CONF_IDLE_TIMEOUT: 60,
            CONF_REFRESH_INTERVAL: 15,
            CONF_PASSWORD: "zzzzzz",
            CONF_TIME_SYNC: True,
            CONF_DIVOOM_EMAIL: "",
            "divoom_password": "",
        },
    )
    assert result["type"] is FlowResultType.FORM
    assert result["errors"] == {CONF_PASSWORD: "invalid_password"}


async def test_options_flow_divoom_password_hashed_to_md5(hass, config_entry) -> None:
    """A freshly typed Divoom password is stored only as its MD5 -- the raw password itself
    never lands in config entry options."""
    result = await hass.config_entries.options.async_init(config_entry.entry_id)
    result = await hass.config_entries.options.async_configure(
        result["flow_id"],
        user_input={
            CONF_IDLE_TIMEOUT: 60,
            CONF_REFRESH_INTERVAL: 15,
            CONF_PASSWORD: "000000",
            CONF_TIME_SYNC: True,
            CONF_DIVOOM_EMAIL: "me@example.com",
            "divoom_password": "hunter2",
        },
    )
    await hass.async_block_till_done()
    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert config_entry.options[CONF_DIVOOM_EMAIL] == "me@example.com"
    assert config_entry.options[CONF_DIVOOM_PASSWORD_MD5] == hashlib.md5(b"hunter2").hexdigest()
    assert "hunter2" not in config_entry.options.values()


async def test_options_flow_blank_divoom_password_keeps_existing_hash(hass, clock, make_config_entry) -> None:
    """Submitting the options form again with the write-only Divoom password field left blank
    must keep whatever hash is already stored, not clear it."""
    existing_hash = hashlib.md5(b"hunter2").hexdigest()
    entry = make_config_entry(options={CONF_DIVOOM_EMAIL: "me@example.com", CONF_DIVOOM_PASSWORD_MD5: existing_hash})
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()

    result = await hass.config_entries.options.async_init(entry.entry_id)
    result = await hass.config_entries.options.async_configure(
        result["flow_id"],
        user_input={
            CONF_IDLE_TIMEOUT: 60,
            CONF_REFRESH_INTERVAL: 15,
            CONF_PASSWORD: "000000",
            CONF_TIME_SYNC: True,
            CONF_DIVOOM_EMAIL: "me@example.com",
            "divoom_password": "",
        },
    )
    await hass.async_block_till_done()
    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert entry.options[CONF_DIVOOM_PASSWORD_MD5] == existing_hash
