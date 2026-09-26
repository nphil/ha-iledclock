"""Config-entry option normalisation/validation (Contract B)."""

from __future__ import annotations

import unittest

from custom_components.iledclock.const import (
    CONF_IDLE_TIMEOUT,
    CONF_PASSWORD,
    CONF_REFRESH_INTERVAL,
    CONF_TIME_SYNC,
)
from custom_components.iledclock.options import (
    OptionsValidationError,
    normalize_options,
    validate_password,
)


class NormalizeOptionsTests(unittest.TestCase):
    def test_empty_options_get_documented_defaults(self) -> None:
        result = normalize_options({})

        self.assertEqual(result[CONF_IDLE_TIMEOUT], 60)
        self.assertEqual(result[CONF_REFRESH_INTERVAL], 15)
        self.assertEqual(result[CONF_PASSWORD], "000000")
        self.assertIs(result[CONF_TIME_SYNC], True)

    def test_zero_idle_timeout_means_keep_connected_and_is_preserved(self) -> None:
        result = normalize_options({CONF_IDLE_TIMEOUT: 0})

        self.assertEqual(result[CONF_IDLE_TIMEOUT], 0)

    def test_idle_timeout_out_of_range_rejected(self) -> None:
        with self.assertRaises(OptionsValidationError):
            normalize_options({CONF_IDLE_TIMEOUT: -1})
        with self.assertRaises(OptionsValidationError):
            normalize_options({CONF_IDLE_TIMEOUT: 999999})

    def test_refresh_interval_out_of_range_rejected(self) -> None:
        with self.assertRaises(OptionsValidationError):
            normalize_options({CONF_REFRESH_INTERVAL: 0})

    def test_time_sync_coerced_to_bool(self) -> None:
        result = normalize_options({CONF_TIME_SYNC: 0})

        self.assertIs(result[CONF_TIME_SYNC], False)

    def test_bad_password_field_named_in_error(self) -> None:
        try:
            normalize_options({CONF_PASSWORD: "bad"})
        except OptionsValidationError as err:
            self.assertEqual(err.field, CONF_PASSWORD)
        else:
            self.fail("expected OptionsValidationError")


class ValidatePasswordTests(unittest.TestCase):
    def test_valid_six_digit_password_lowercased(self) -> None:
        self.assertEqual(validate_password("1A2B3C"), "1a2b3c")

    def test_wrong_length_rejected(self) -> None:
        with self.assertRaises(OptionsValidationError):
            validate_password("12345")
        with self.assertRaises(OptionsValidationError):
            validate_password("1234567")

    def test_non_hex_character_rejected(self) -> None:
        """Wire encoding parses each character as a hex nibble
        (`Integer.valueOf("0"+ch, 16)`); a non-hex character would throw on the device side."""
        with self.assertRaises(OptionsValidationError):
            validate_password("12345g")

    def test_non_string_rejected(self) -> None:
        with self.assertRaises(OptionsValidationError):
            validate_password(123456)


if __name__ == "__main__":
    unittest.main()
