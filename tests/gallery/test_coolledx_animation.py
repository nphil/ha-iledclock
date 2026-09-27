"""Decode and search tests for the vendor's versioned packed animation feed."""
from __future__ import annotations

import io
import json
import unittest
from pathlib import Path
from typing import Any

from PIL import Image

from custom_components.iledclock.gallery import coolledx_anim
from custom_components.iledclock.gallery.models import SourceDecodeError, SourceNotFound

_FIXTURES = Path(__file__).resolve().parents[1] / "fixtures" / "coolledx"


def _load(kind: str) -> dict[str, Any]:
    return json.loads((_FIXTURES / f"data1632_{kind}_sample.json").read_text(encoding="utf-8"))


def _catalog() -> coolledx_anim.Catalog:
    return coolledx_anim.parse_catalog({"static": _load("static"), "dynamic": _load("dynamic")})


class AnimationFeedTests(unittest.TestCase):
    def setUp(self) -> None:
        self.catalog = _catalog()

    def test_versions_and_decoded_frame_metadata_are_in_stable_ids(self) -> None:
        static, dynamic = (entry.item for entry in self.catalog.entries)
        self.assertEqual(static.id, "static-12-0")
        self.assertEqual(dynamic.id, "dynamic-14-0")
        self.assertEqual((static.width, static.height, static.frames), (32, 16, 1))
        self.assertFalse(static.animated)
        self.assertEqual((dynamic.width, dynamic.height, dynamic.frames), (32, 16, 14))
        self.assertTrue(dynamic.animated)
        self.assertEqual(dynamic.title, "鲨鱼")
        self.assertTrue(dynamic.native_fit)

    def test_category_query_and_animated_filters_use_decoded_record_state(self) -> None:
        self.assertEqual([item.category for item in coolledx_anim.search(self.catalog, category="static").items], ["static"])
        self.assertEqual([item.category for item in coolledx_anim.search(self.catalog, animated_only=True).items], ["dynamic"])
        self.assertEqual(coolledx_anim.search(self.catalog, query="鲨鱼").items[0].id, "dynamic-14-0")
        self.assertEqual(coolledx_anim.search(self.catalog, size="16x16").items, ())

    def test_english_titles_and_search_keep_the_original_descriptions(self) -> None:
        english = coolledx_anim.search(self.catalog, query="Shark", language="en").items[0]
        chinese_query = coolledx_anim.search(self.catalog, query="鲨鱼", language="en").items[0]
        chinese = coolledx_anim.search(self.catalog, query="Shark", language="zh-Hans").items[0]

        self.assertEqual((english.id, english.title), ("dynamic-14-0", "Shark"))
        self.assertEqual((chinese_query.id, chinese_query.title), ("dynamic-14-0", "Shark"))
        self.assertEqual(chinese.title, "鲨鱼")

    def test_recorded_fixture_titles_are_translated_and_unknown_titles_fall_back(self) -> None:
        for kind in coolledx_anim.KINDS:
            feed = _load(kind)
            for row in feed["animationData"]:
                description = row["describe"]
                translation = coolledx_anim.TITLE_TRANSLATIONS.get(description)
                if translation is None:
                    translation = coolledx_anim._TITLE_TRANSLATIONS_BY_BASE.get(
                        coolledx_anim._strip_numeric_prefix(description)
                    )
                self.assertTrue(translation, description)

        feed = _load("static")
        feed["animationData"][0]["describe"] = "05Future Creature"
        unknown_catalog = coolledx_anim.parse_catalog({"static": feed})
        unknown = coolledx_anim.search(unknown_catalog, language="en").items[0]
        self.assertEqual(unknown.title, "Future Creature")


    def test_rgb_planes_map_to_correct_row_major_pixels_and_frames(self) -> None:
        frame_count = 2
        plane_size = frame_count * coolledx_anim.PLANE_BYTES_PER_FRAME
        data = bytearray(coolledx_anim.HEADER_BYTES + plane_size * 3)
        data[24] = frame_count
        data[25:27] = bytes((0, 100))
        red = coolledx_anim.HEADER_BYTES
        green = red + plane_size
        blue = green + plane_size
        # Frame 0: top-left red, bottom-right green, (x=5,y=8) blue.
        data[red] = 0x80
        data[green + 63] = 0x01
        data[blue + 11] = 0x80
        # Frame 1's red plane starts after all of frame 0's 64-byte plane data.
        data[red + coolledx_anim.PLANE_BYTES_PER_FRAME] = 0x40

        frames, delay_ms = coolledx_anim.decode_frames(bytes(data))

        self.assertEqual(delay_ms, 100)
        self.assertEqual(len(frames), 2)
        self.assertEqual(frames[0][0:3], bytes((255, 0, 0)))
        self.assertEqual(frames[0][((15 * 32 + 31) * 3):((15 * 32 + 31) * 3 + 3)], bytes((0, 255, 0)))
        self.assertEqual(frames[0][((8 * 32 + 5) * 3):((8 * 32 + 5) * 3 + 3)], bytes((0, 0, 255)))
        self.assertEqual(frames[1][((1 * 32) * 3):((1 * 32) * 3 + 3)], bytes((255, 0, 0)))

    def test_real_dynamic_entry_renders_a_32_by_16_animated_gif(self) -> None:
        media = coolledx_anim.render_media(self.catalog, "dynamic-14-0")
        image = Image.open(io.BytesIO(media.data))
        self.assertEqual(media.content_type, "image/gif")
        self.assertEqual(image.size, (32, 16))
        self.assertEqual(image.n_frames, 14)
        self.assertEqual(image.info["duration"], 200)

    def test_cache_round_trip_keeps_versioned_frames_bytes_and_original_title(self) -> None:
        restored = coolledx_anim.catalog_from_json(coolledx_anim.catalog_to_json(self.catalog))
        self.assertEqual(restored.entries[1].item.to_json(), self.catalog.entries[1].item.to_json())
        self.assertEqual(restored.entries[1].send_data, self.catalog.entries[1].send_data)
        self.assertEqual(restored.entries[1].description, self.catalog.entries[1].description)
        self.assertEqual(coolledx_anim.search(restored, query="Shark", language="en").items[0].title, "Shark")
        self.assertEqual(coolledx_anim.render_media(restored, "dynamic-14-0").data,
                         coolledx_anim.render_media(self.catalog, "dynamic-14-0").data)

    def test_invalid_plane_length_is_a_decode_error_and_unknown_id_is_404(self) -> None:
        with self.assertRaises(SourceDecodeError):
            coolledx_anim.decode_frames(bytes(coolledx_anim.HEADER_BYTES))
        with self.assertRaises(SourceNotFound):
            coolledx_anim.render_media(self.catalog, "dynamic-13-0")

    def test_source_advertises_native_categories(self) -> None:
        info = coolledx_anim.source_info().to_json()
        self.assertEqual(info["kind"], "native")
        self.assertEqual(info["categories"], [{"id": "static", "label": "Static"},
                                                {"id": "dynamic", "label": "Dynamic"}])


if __name__ == "__main__":
    unittest.main()
