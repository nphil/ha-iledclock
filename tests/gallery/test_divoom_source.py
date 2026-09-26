"""`gallery.divoom` tests: pure parsing/mapping logic only (no network). No live Divoom
account was available for this port -- the fixture below is a SYNTHETIC payload built
from the documented `GalleryInfo` field shape (apixoo/servoom source), not a captured
real response; see the module docstring and the assignment report for what that does and
does not verify. The GIF re-encoding step (`fetch_media`'s tail) is exercised directly
against a `divoom_pixelbean.DecodedContainer` to prove the encode itself is valid,
independent of network/decoding correctness (already covered by `test_divoom_pixelbean.py`).
"""

from __future__ import annotations

import unittest

from custom_components.iledclock.gallery import divoom
from custom_components.iledclock.gallery.models import SourceRequestError

_SYNTHETIC_PAYLOAD = {
    "ReturnCode": 0,
    "FileList": [
        {
            "GalleryId": 12345,
            "FileId": "group1/M00/AB/CD/abc.dat",
            "FileName": "Cool Art",
            "FileType": 3,  # multi-animation
            "LikeCnt": "42",
            "ShareCnt": "3",
            "Date": 1758912345,
            "NickName": "SomeUser",
        },
        {
            "GalleryId": 999,
            "FileId": "group1/M00/00/01/xyz.dat",
            "FileName": "Still Life",
            "FileType": 2,  # multi-picture
            "LikeCnt": "5",
            "Date": 1758900000,
        },
        {"NoGalleryId": True},  # malformed row: must be skipped, not crash the whole page
    ],
}


class ParseCategoryItemsTests(unittest.TestCase):
    def test_parses_animated_and_still_rows(self) -> None:
        items = divoom.parse_category_items(_SYNTHETIC_PAYLOAD, size_label="64x64")

        self.assertEqual(len(items), 2)  # the malformed row is dropped
        by_id = {item.id: item for item in items}
        self.assertTrue(by_id["12345"].animated)
        self.assertFalse(by_id["999"].animated)

    def test_size_label_becomes_width_and_height(self) -> None:
        items = divoom.parse_category_items(_SYNTHETIC_PAYLOAD, size_label="32x32")
        for item in items:
            self.assertEqual((item.width, item.height), (32, 32))

    def test_numeric_string_fields_are_coerced_to_int(self) -> None:
        items = divoom.parse_category_items(_SYNTHETIC_PAYLOAD, size_label="64x64")
        by_id = {item.id: item for item in items}
        self.assertEqual(by_id["12345"].likes, 42)
        self.assertEqual(by_id["12345"].downloads, 3)
        self.assertEqual(by_id["12345"].created, 1758912345)

    def test_author_falls_back_to_none_when_absent(self) -> None:
        items = divoom.parse_category_items(_SYNTHETIC_PAYLOAD, size_label="64x64")
        by_id = {item.id: item for item in items}
        self.assertEqual(by_id["12345"].author, "SomeUser")
        self.assertIsNone(by_id["999"].author)

    def test_empty_payload_yields_no_items(self) -> None:
        self.assertEqual(divoom.parse_category_items({}, size_label="16x16"), [])


class SortMappingTests(unittest.TestCase):
    def test_recommended_maps_to_recommend_category(self) -> None:
        category, sort = divoom._sort_to_request("recommended")
        self.assertEqual(category, divoom.GalleryCategory.RECOMMEND)

    def test_new_maps_to_new_upload(self) -> None:
        category, sort = divoom._sort_to_request("new")
        self.assertEqual(category, divoom.GalleryCategory.NEW)
        self.assertEqual(sort, divoom.GallerySorting.NEW_UPLOAD)

    def test_popular_maps_to_top_and_most_liked(self) -> None:
        category, sort = divoom._sort_to_request("popular")
        self.assertEqual(category, divoom.GalleryCategory.TOP)
        self.assertEqual(sort, divoom.GallerySorting.MOST_LIKED)

    def test_unknown_sort_raises(self) -> None:
        with self.assertRaises(SourceRequestError):
            divoom._sort_to_request("not-a-real-sort")


class SizeAndFileTypeTests(unittest.TestCase):
    def test_resolve_size_defaults_to_64x64(self) -> None:
        self.assertEqual(divoom._resolve_size(None), divoom.GalleryDimension.W64H64)

    def test_resolve_size_maps_every_supported_label(self) -> None:
        self.assertEqual(divoom._resolve_size("16x16"), divoom.GalleryDimension.W16H16)
        self.assertEqual(divoom._resolve_size("32x32"), divoom.GalleryDimension.W32H32)
        self.assertEqual(divoom._resolve_size("64x64"), divoom.GalleryDimension.W64H64)

    def test_resolve_size_rejects_unsupported_label(self) -> None:
        with self.assertRaises(SourceRequestError):
            divoom._resolve_size("256x256")

    def test_animated_only_file_type_depends_on_size(self) -> None:
        self.assertEqual(
            divoom._resolve_file_type("16x16", animated_only=True), divoom.GalleryType.ANIMATION
        )
        self.assertEqual(
            divoom._resolve_file_type("64x64", animated_only=True), divoom.GalleryType.MULTI_ANIMATION
        )

    def test_not_animated_only_uses_all_file_type(self) -> None:
        self.assertEqual(divoom._resolve_file_type("64x64", animated_only=False), divoom.GalleryType.ALL)


class GifReencodeTests(unittest.TestCase):
    def test_decoded_container_reencodes_to_a_valid_animated_gif(self) -> None:
        from PIL import Image
        import io

        from custom_components.iledclock.gallery import divoom_pixelbean as dpb

        container = dpb.DecodedContainer(
            width=4, height=4,
            frames_rgb=[bytes([255, 0, 0]) * 16, bytes([0, 255, 0]) * 16],
            delay_ms=90,
        )
        frames = [
            Image.frombytes("RGB", (container.width, container.height), rgb).convert("RGBA")
            for rgb in container.frames_rgb
        ]
        palette_frames = [f.convert("P", palette=Image.ADAPTIVE) for f in frames]
        buf = io.BytesIO()
        palette_frames[0].save(
            buf, format="GIF", save_all=True, append_images=palette_frames[1:],
            duration=container.delay_ms, loop=0, disposal=2,
        )

        redecoded = Image.open(io.BytesIO(buf.getvalue()))
        self.assertEqual(redecoded.n_frames, 2)
        redecoded.seek(0)
        self.assertEqual(redecoded.convert("RGB").getpixel((0, 0)), (255, 0, 0))
        redecoded.seek(1)
        self.assertEqual(redecoded.convert("RGB").getpixel((0, 0)), (0, 255, 0))


class SourceInfoTests(unittest.TestCase):
    def test_requires_account_and_sorts(self) -> None:
        info = divoom.source_info(configured=False)
        self.assertTrue(info.requires_account)
        self.assertFalse(info.configured)
        self.assertEqual([s.id for s in info.sorts], ["recommended", "new", "popular"])
        self.assertEqual(info.sizes, ("16x16", "32x32", "64x64"))


if __name__ == "__main__":
    unittest.main()
