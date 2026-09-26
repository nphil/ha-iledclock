"""Config flow for iLedClock.

Discovery comes from the manifest's Bluetooth matcher (`local_name: iLedClock`, service
`0000fff0`); the user step lists iLedClocks the Bluetooth stack has currently seen, for
installs where discovery hasn't fired yet (e.g. the proxy saw the clock only while HA was
restarting). `unique_id` is the clock's BLE address, so a discovered clock and a manually
picked one can never end up as two entries.
"""

from __future__ import annotations

import hashlib
from typing import Any

import voluptuous as vol
from homeassistant.components import bluetooth
from homeassistant.config_entries import (
    ConfigEntry,
    ConfigFlow,
    ConfigFlowResult,
    OptionsFlowWithReload,
)
from homeassistant.const import CONF_ADDRESS
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import selector

from .const import (
    BLE_LOCAL_NAME,
    BLE_SERVICE_UUID,
    CONF_DIVOOM_EMAIL,
    CONF_DIVOOM_PASSWORD_MD5,
    CONF_IDLE_TIMEOUT,
    CONF_PASSWORD,
    CONF_REFRESH_INTERVAL,
    CONF_TIME_SYNC,
    DEFAULT_IDLE_TIMEOUT_S,
    DEFAULT_PASSWORD,
    DEFAULT_REFRESH_INTERVAL_MIN,
    DEFAULT_TIME_SYNC,
    DOMAIN,
    MAX_IDLE_TIMEOUT_S,
    MAX_REFRESH_INTERVAL_MIN,
    MIN_IDLE_TIMEOUT_S,
    MIN_REFRESH_INTERVAL_MIN,
    PASSWORD_LENGTH,
)
from .options import OptionsValidationError, validate_password


async def _async_find_clocks(hass: HomeAssistant) -> dict[str, str]:
    """Every iLedClock any adapter/proxy has seen recently: address -> display label."""
    found: dict[str, str] = {}
    for service_info in bluetooth.async_discovered_service_info(hass, connectable=False):
        if service_info.name == BLE_LOCAL_NAME or BLE_SERVICE_UUID in service_info.service_uuids:
            found[service_info.address] = f"{service_info.name or BLE_LOCAL_NAME} ({service_info.address})"
    return found


class IledClockConfigFlow(ConfigFlow, domain=DOMAIN):
    """Handle a config flow for iLedClock."""

    VERSION = 1

    def __init__(self) -> None:
        self._discovered: dict[str, str] = {}

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: ConfigEntry) -> IledClockOptionsFlow:
        return IledClockOptionsFlow(config_entry)

    async def async_step_bluetooth(
        self, discovery_info: bluetooth.BluetoothServiceInfoBleak
    ) -> ConfigFlowResult:
        """A clock started advertising: confirm before adding it."""
        await self.async_set_unique_id(discovery_info.address)
        self._abort_if_unique_id_configured()
        self.context["title_placeholders"] = {"name": discovery_info.name or BLE_LOCAL_NAME}
        return self.async_show_form(step_id="bluetooth_confirm")

    async def async_step_bluetooth_confirm(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        if user_input is not None:
            title = f"{self.context['title_placeholders']['name']} ({self.unique_id})"
            return self.async_create_entry(title=title, data={CONF_ADDRESS: self.unique_id})
        return self.async_show_form(step_id="bluetooth_confirm")

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        if user_input is not None:
            address = user_input[CONF_ADDRESS]
            await self.async_set_unique_id(address)
            self._abort_if_unique_id_configured()
            return self.async_create_entry(
                title=self._discovered.get(address, f"{BLE_LOCAL_NAME} ({address})"),
                data={CONF_ADDRESS: address},
            )

        self._discovered = await _async_find_clocks(self.hass)
        if not self._discovered:
            return self.async_abort(reason="no_devices_found")
        return self.async_show_form(
            step_id="user",
            data_schema=vol.Schema({vol.Required(CONF_ADDRESS): vol.In(self._discovered)}),
        )


class IledClockOptionsFlow(OptionsFlowWithReload):
    """idle_timeout / refresh_interval / password / time_sync / an optional Divoom Cloud
    account for the online gallery (docs/GALLERY.md). Changing any of them reloads the entry,
    which rebuilds the client with the new link policy -- the simplest correct way to make e.g.
    a changed idle timeout take effect immediately."""

    def __init__(self, config_entry: ConfigEntry) -> None:
        self._config_entry = config_entry

    async def async_step_init(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        errors: dict[str, str] = {}
        if user_input is not None:
            try:
                validate_password(user_input[CONF_PASSWORD])
            except OptionsValidationError:
                errors[CONF_PASSWORD] = "invalid_password"
            else:
                # The Divoom password field is write-only and never redisplayed (see the
                # data_schema below): a blank submission means "keep whatever is already
                # stored", not "clear it" -- only a freshly typed password replaces the hash.
                divoom_password = user_input.pop("divoom_password", "")
                if divoom_password:
                    user_input[CONF_DIVOOM_PASSWORD_MD5] = hashlib.md5(
                        divoom_password.encode("utf-8")
                    ).hexdigest()
                else:
                    user_input[CONF_DIVOOM_PASSWORD_MD5] = self._config_entry.options.get(
                        CONF_DIVOOM_PASSWORD_MD5, ""
                    )
                return self.async_create_entry(title="", data=user_input)

        current = self._config_entry.options
        return self.async_show_form(
            step_id="init",
            data_schema=vol.Schema(
                {
                    vol.Optional(
                        CONF_IDLE_TIMEOUT,
                        default=current.get(CONF_IDLE_TIMEOUT, DEFAULT_IDLE_TIMEOUT_S),
                    ): vol.All(
                        vol.Coerce(int), vol.Range(min=MIN_IDLE_TIMEOUT_S, max=MAX_IDLE_TIMEOUT_S)
                    ),
                    vol.Optional(
                        CONF_REFRESH_INTERVAL,
                        default=current.get(CONF_REFRESH_INTERVAL, DEFAULT_REFRESH_INTERVAL_MIN),
                    ): vol.All(
                        vol.Coerce(int),
                        vol.Range(min=MIN_REFRESH_INTERVAL_MIN, max=MAX_REFRESH_INTERVAL_MIN),
                    ),
                    vol.Optional(
                        CONF_PASSWORD,
                        default=current.get(CONF_PASSWORD, DEFAULT_PASSWORD),
                    ): vol.All(str, vol.Length(min=PASSWORD_LENGTH, max=PASSWORD_LENGTH)),
                    vol.Optional(
                        CONF_TIME_SYNC,
                        default=current.get(CONF_TIME_SYNC, DEFAULT_TIME_SYNC),
                    ): bool,
                    vol.Optional(
                        CONF_DIVOOM_EMAIL,
                        default=current.get(CONF_DIVOOM_EMAIL, ""),
                    ): str,
                    vol.Optional("divoom_password", default=""): selector.TextSelector(
                        selector.TextSelectorConfig(type=selector.TextSelectorType.PASSWORD)
                    ),
                }
            ),
            errors=errors,
            description_placeholders={"password_length": str(PASSWORD_LENGTH)},
        )
