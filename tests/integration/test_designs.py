"""Design-payload validation (Contract D `iledclock/designs/save`)."""

from __future__ import annotations

import base64
import unittest

from custom_components.iledclock.designs import (
    FRAME_BYTES,
    Design,
    DesignOrigin,
    DesignValidationError,
    validate_design_payload,
)

_ONE_FRAME = base64.b64encode(bytes(FRAME_BYTES)).decode("ascii")


class ValidateDesignPayloadTests(unittest.TestCase):
    def test_valid_image_gets_zero_delay_and_fresh_id(self) -> None:
        design = validate_design_payload({"name": "Sunset", "kind": "image", "frames": [_ONE_FRAME]})

        self.assertEqual(design.name, "Sunset")
        self.assertEqual(design.kind, "image")
        self.assertEqual(len(design.frames), 1)
        self.assertEqual(design.delays_ms, (0,))
        self.assertTrue(design.id)

    def test_no_origin_defaults_to_none(self) -> None:
        design = validate_design_payload({"name": "Sunset", "kind": "image", "frames": [_ONE_FRAME]})
        self.assertIsNone(design.origin)

    def test_animation_requires_matching_delays_length(self) -> None:
        with self.assertRaises(DesignValidationError):
            validate_design_payload(
                {"name": "Loop", "kind": "animation", "frames": [_ONE_FRAME, _ONE_FRAME], "delays": [100]}
            )

        design = validate_design_payload(
            {"name": "Loop", "kind": "animation", "frames": [_ONE_FRAME, _ONE_FRAME], "delays": [100, 200]}
        )
        self.assertEqual(design.delays_ms, (100, 200))

    def test_wrong_frame_byte_length_rejected(self) -> None:
        short_frame = base64.b64encode(b"\x00" * (FRAME_BYTES - 3)).decode("ascii")

        with self.assertRaises(DesignValidationError):
            validate_design_payload({"name": "Bad", "kind": "image", "frames": [short_frame]})

    def test_invalid_base64_rejected(self) -> None:
        with self.assertRaises(DesignValidationError):
            validate_design_payload({"name": "Bad", "kind": "image", "frames": ["not-base64!!"]})

    def test_missing_name_rejected(self) -> None:
        with self.assertRaises(DesignValidationError):
            validate_design_payload({"kind": "image", "frames": [_ONE_FRAME]})

    def test_too_many_frames_rejected(self) -> None:
        with self.assertRaises(DesignValidationError):
            validate_design_payload(
                {
                    "name": "Long",
                    "kind": "animation",
                    "frames": [_ONE_FRAME] * 65,
                    "delays": [100] * 65,
                }
            )

    def test_editing_existing_design_keeps_its_id_and_created(self) -> None:
        design = validate_design_payload(
            {"id": "abc123", "name": "Sunset", "kind": "image", "frames": [_ONE_FRAME], "created": 111.0},
            existing_id="abc123",
        )

        self.assertEqual(design.id, "abc123")
        self.assertEqual(design.created, 111.0)

    def test_storage_round_trip_preserves_frames(self) -> None:
        design = validate_design_payload({"name": "Sunset", "kind": "image", "frames": [_ONE_FRAME]})

        restored = Design.from_storage(design.to_storage())

        self.assertEqual(restored, design)

    def test_gallery_origin_is_validated_and_stored(self) -> None:
        design = validate_design_payload(
            {
                "name": "Pac-Man",
                "kind": "animation",
                "frames": [_ONE_FRAME, _ONE_FRAME],
                "delays": [100, 100],
                "origin": {
                    "source": "divoom",
                    "id": "12345",
                    "title": "Pac-Man",
                    "author": "someone",
                    "url": "https://example.com/12345",
                },
            }
        )

        self.assertEqual(
            design.origin,
            DesignOrigin(
                source="divoom", id="12345", title="Pac-Man", author="someone",
                url="https://example.com/12345",
            ),
        )
        self.assertEqual(design.to_json()["origin"], design.origin.to_dict())

        restored = Design.from_storage(design.to_storage())
        self.assertEqual(restored, design)

    def test_origin_missing_required_keys_rejected(self) -> None:
        with self.assertRaises(DesignValidationError):
            validate_design_payload(
                {"name": "Bad", "kind": "image", "frames": [_ONE_FRAME], "origin": {"source": "divoom"}}
            )

    def test_origin_wrong_type_rejected(self) -> None:
        with self.assertRaises(DesignValidationError):
            validate_design_payload(
                {"name": "Bad", "kind": "image", "frames": [_ONE_FRAME], "origin": "not-an-object"}
            )

    def test_old_saved_design_without_origin_restores_as_none(self) -> None:
        design = validate_design_payload({"name": "Sunset", "kind": "image", "frames": [_ONE_FRAME]})
        stored = design.to_storage()
        del stored["origin"]  # simulate a design saved before this field existed

        restored = Design.from_storage(stored)

        self.assertIsNone(restored.origin)


if __name__ == "__main__":
    unittest.main()
