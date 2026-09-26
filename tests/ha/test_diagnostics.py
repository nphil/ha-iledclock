"""Config entry diagnostics (docs/ARCHITECTURE.md): the clock's BLE address and every Divoom
Cloud credential are redacted; everything else (state, coordinator bookkeeping) stays visible."""

from __future__ import annotations

from pytest_homeassistant_custom_component.components.diagnostics import get_diagnostics_for_config_entry

from custom_components.iledclock.const import CONF_DIVOOM_EMAIL, CONF_DIVOOM_PASSWORD_MD5, CONF_PASSWORD

REDACTED = "**REDACTED**"


async def test_diagnostics_redacts_address_and_divoom_credentials(hass, hass_client, make_config_entry) -> None:
    entry = make_config_entry(
        options={
            CONF_PASSWORD: "1a2b3c",
            CONF_DIVOOM_EMAIL: "me@example.com",
            CONF_DIVOOM_PASSWORD_MD5: "0123456789abcdef0123456789abcdef",
        }
    )
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()

    result = await get_diagnostics_for_config_entry(hass, hass_client, entry)

    assert result["entry_data"]["address"] == REDACTED
    assert result["entry_options"][CONF_PASSWORD] == REDACTED
    assert result["entry_options"][CONF_DIVOOM_EMAIL] == REDACTED
    assert result["entry_options"][CONF_DIVOOM_PASSWORD_MD5] == REDACTED
    assert result["state"]["address"] == REDACTED

    # Sanity: redaction is targeted, not a blanket wipe -- the rest of the state is readable.
    assert result["state"]["firmware"] == 33
    assert result["state"]["program_slots"] == 9
    assert result["coordinator"]["last_update_success"] is True
    assert result["coordinator"]["playlist_length"] == 0
