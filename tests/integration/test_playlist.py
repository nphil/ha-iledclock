"""Playlist validation (Contract D `iledclock/playlist/set` / `set_playlist` service)."""

from __future__ import annotations

import unittest

from custom_components.iledclock.playlist import (
    PlaylistValidationError,
    validate_playlist,
    validate_playlist_item,
)


class ValidatePlaylistItemTests(unittest.TestCase):
    def test_valid_text_item_gets_default_duration(self) -> None:
        item = validate_playlist_item({"kind": "text", "params": {"text": "hi"}})

        self.assertEqual(item.kind, "text")
        self.assertEqual(item.params, {"text": "hi"})
        self.assertEqual(item.duration_s, 10)

    def test_scoreboard_item_has_no_required_params(self) -> None:
        item = validate_playlist_item({"kind": "scoreboard"})

        self.assertEqual(item.params, {})

    def test_unknown_kind_rejected(self) -> None:
        with self.assertRaises(PlaylistValidationError):
            validate_playlist_item({"kind": "not-a-kind"})

    def test_missing_required_param_rejected(self) -> None:
        with self.assertRaises(PlaylistValidationError) as ctx:
            validate_playlist_item({"kind": "clock", "params": {"style": 3}})

        self.assertIn("color", str(ctx.exception))

    def test_design_kind_requires_design_id(self) -> None:
        with self.assertRaises(PlaylistValidationError):
            validate_playlist_item({"kind": "design", "params": {}})

        item = validate_playlist_item({"kind": "design", "params": {"design_id": "abc"}})
        self.assertEqual(item.params["design_id"], "abc")

    def test_duration_out_of_range_rejected(self) -> None:
        with self.assertRaises(PlaylistValidationError):
            validate_playlist_item({"kind": "scoreboard", "duration_s": 0})
        with self.assertRaises(PlaylistValidationError):
            validate_playlist_item({"kind": "scoreboard", "duration_s": 999999})

    def test_non_object_item_rejected(self) -> None:
        with self.assertRaises(PlaylistValidationError):
            validate_playlist_item("not a dict")

    def test_error_carries_index(self) -> None:
        try:
            validate_playlist_item({"kind": "bogus"}, index=3)
        except PlaylistValidationError as err:
            self.assertEqual(err.index, 3)
        else:
            self.fail("expected PlaylistValidationError")


class ValidatePlaylistTests(unittest.TestCase):
    def test_empty_playlist_rejected(self) -> None:
        with self.assertRaises(PlaylistValidationError):
            validate_playlist([])

    def test_non_list_rejected(self) -> None:
        with self.assertRaises(PlaylistValidationError):
            validate_playlist({"kind": "clock"})

    def test_too_many_items_rejected(self) -> None:
        items = [{"kind": "scoreboard"}] * 10  # device max is 9

        with self.assertRaises(PlaylistValidationError):
            validate_playlist(items)

    def test_max_items_accepted(self) -> None:
        items = [{"kind": "scoreboard"}] * 9

        result = validate_playlist(items)

        self.assertEqual(len(result), 9)

    def test_invalid_item_reports_its_own_index(self) -> None:
        items = [{"kind": "scoreboard"}, {"kind": "clock", "params": {}}]

        try:
            validate_playlist(items)
        except PlaylistValidationError as err:
            self.assertEqual(err.index, 1)
        else:
            self.fail("expected PlaylistValidationError")


if __name__ == "__main__":
    unittest.main()
