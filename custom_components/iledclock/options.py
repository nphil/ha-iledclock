"""Config-entry option normalisation and validation (Contract B).

Kept free of `homeassistant` imports so it is directly unit-testable; `config_flow.py` and
`coordinator.py` both call into this rather than duplicating range checks.
"""

from __future__ import annotations

import string
from typing import Any, Mapping

from .const import (
    CONF_IDLE_TIMEOUT,
    CONF_PASSWORD,
    CONF_REFRESH_INTERVAL,
    CONF_TIME_SYNC,
    DEFAULT_IDLE_TIMEOUT_S,
    DEFAULT_PASSWORD,
    DEFAULT_REFRESH_INTERVAL_MIN,
    DEFAULT_TIME_SYNC,
    MAX_IDLE_TIMEOUT_S,
    MAX_REFRESH_INTERVAL_MIN,
    MIN_IDLE_TIMEOUT_S,
    MIN_REFRESH_INTERVAL_MIN,
    PASSWORD_LENGTH,
)


class OptionsValidationError(ValueError):
    """Raised for an invalid option value. `field` names the offending option key."""

    def __init__(self, message: str, field: str | None = None) -> None:
        super().__init__(message)
        self.field = field


def validate_password(value: Any) -> str:
    """See `const.PASSWORD_LENGTH`'s docstring for exactly why 6 hex characters is the wire
    contract, not an arbitrary integration choice. Returns the password lower-cased (the wire
    encoding is case-insensitive: `Integer.valueOf(ch, 16)` parses either case identically)."""
    if not isinstance(value, str) or len(value) != PASSWORD_LENGTH:
        raise OptionsValidationError(
            f"password must be exactly {PASSWORD_LENGTH} characters", CONF_PASSWORD
        )
    if not all(ch in string.hexdigits for ch in value):
        raise OptionsValidationError(
            "password must contain only hex digits (0-9, a-f)", CONF_PASSWORD
        )
    return value.lower()


def _clamp_int(
    value: Any, *, field: str, minimum: int, maximum: int, label: str
) -> int:
    try:
        ivalue = int(value)
    except (TypeError, ValueError) as err:
        raise OptionsValidationError(f"{label} must be an integer", field) from err
    if not (minimum <= ivalue <= maximum):
        raise OptionsValidationError(
            f"{label} must be between {minimum} and {maximum}, got {ivalue}", field
        )
    return ivalue


def normalize_options(options: Mapping[str, Any]) -> dict[str, Any]:
    """Fill in defaults for any missing option and validate/coerce every value present.
    Raises `OptionsValidationError` on the first invalid field."""
    idle_timeout = _clamp_int(
        options.get(CONF_IDLE_TIMEOUT, DEFAULT_IDLE_TIMEOUT_S),
        field=CONF_IDLE_TIMEOUT,
        minimum=MIN_IDLE_TIMEOUT_S,
        maximum=MAX_IDLE_TIMEOUT_S,
        label="idle_timeout",
    )
    refresh_interval = _clamp_int(
        options.get(CONF_REFRESH_INTERVAL, DEFAULT_REFRESH_INTERVAL_MIN),
        field=CONF_REFRESH_INTERVAL,
        minimum=MIN_REFRESH_INTERVAL_MIN,
        maximum=MAX_REFRESH_INTERVAL_MIN,
        label="refresh_interval",
    )
    password = validate_password(options.get(CONF_PASSWORD, DEFAULT_PASSWORD))
    time_sync = bool(options.get(CONF_TIME_SYNC, DEFAULT_TIME_SYNC))

    return {
        CONF_IDLE_TIMEOUT: idle_timeout,
        CONF_REFRESH_INTERVAL: refresh_interval,
        CONF_PASSWORD: password,
        CONF_TIME_SYNC: time_sync,
    }
