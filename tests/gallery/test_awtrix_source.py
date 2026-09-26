"""`gallery.awtrix` parser tests against real captured HTML (docs/GALLERY.md: "keep the
parser tiny and fixture-tested")."""

from __future__ import annotations

import unittest
from pathlib import Path

from custom_components.iledclock.gallery import awtrix

_FIXTURES = Path(__file__).parent / "fixtures"


def _read(name: str) -> str:
    return (_FIXTURES / name).read_text(encoding="utf-8")


class AwtrixListingParseTests(unittest.TestCase):
    def setUp(self) -> None:
        self.html = _read("awtrix_icons_list.html")

    def test_parses_every_card_with_title_slug_size(self) -> None:
        items, total_count = awtrix.parse_listing_html(self.html)

        self.assertEqual(total_count, 2216)
        self.assertEqual(len(items), 4)
        by_id = {item.id: item for item in items}
        self.assertIn("landscape-2", by_id)
        self.assertIn("yoshi", by_id)
        self.assertIn("sun", by_id)
        self.assertIn("humidity-2", by_id)

    def test_animated_flag_matches_motion_marker(self) -> None:
        items, _ = awtrix.parse_listing_html(self.html)
        by_id = {item.id: item for item in items}

        self.assertTrue(by_id["landscape-2"].animated)
        self.assertTrue(by_id["sun"].animated)
        self.assertFalse(by_id["humidity-2"].animated)

    def test_width_height_parsed_from_meta_size_text(self) -> None:
        items, _ = awtrix.parse_listing_html(self.html)
        by_id = {item.id: item for item in items}

        self.assertEqual((by_id["landscape-2"].width, by_id["landscape-2"].height), (32, 8))
        self.assertEqual((by_id["sun"].width, by_id["sun"].height), (8, 8))

    def test_title_and_url_and_source(self) -> None:
        items, _ = awtrix.parse_listing_html(self.html)
        by_id = {item.id: item for item in items}

        humidity = by_id["humidity-2"]
        self.assertEqual(humidity.title, "humidity_")
        self.assertEqual(humidity.source, "awtrix")
        self.assertEqual(humidity.url, "https://awtrix.de/icons/humidity-2")

    def test_empty_page_yields_no_items(self) -> None:
        items, total_count = awtrix.parse_listing_html("<div>no cards here</div>")
        self.assertEqual(items, [])
        self.assertIsNone(total_count)


class AwtrixDetailParseTests(unittest.TestCase):
    def test_named_author_title_and_date_parsed(self) -> None:
        result = awtrix.parse_detail_html(_read("awtrix_icon_detail.html"))

        self.assertEqual(result["title"], "Landscape")
        self.assertEqual(result["author"], "Blueforcer")
        # 19 Sep 2026 00:00:00 UTC
        self.assertIsNotNone(result["created"])
        from datetime import datetime, timezone

        expected = int(datetime(2026, 9, 19, tzinfo=timezone.utc).timestamp())
        self.assertEqual(result["created"], expected)

    def test_community_import_has_no_author(self) -> None:
        page = (
            '<p class="detail-byline">From the AWTRIX 3 community '
            '<span aria-hidden="true">\u00b7</span> 12 Sep 2026</p>'
        )
        result = awtrix.parse_detail_html(page)
        self.assertIsNone(result["author"])
        self.assertIsNotNone(result["created"])

    def test_missing_byline_returns_all_none(self) -> None:
        result = awtrix.parse_detail_html("<p>nothing to see here</p>")
        self.assertIsNone(result["author"])
        self.assertIsNone(result["created"])


class AwtrixMediaUrlTests(unittest.TestCase):
    def test_media_url_pattern(self) -> None:
        self.assertEqual(
            awtrix.media_url("landscape-2"), "https://awtrix.de/icons/landscape-2.gif"
        )


class AwtrixSourceInfoTests(unittest.TestCase):
    def test_sort_ids_and_labels_match_contract(self) -> None:
        info = awtrix.source_info()
        sort_ids = [s.id for s in info.sorts]
        self.assertEqual(sort_ids, ["newest", "popular", "picked", "name"])
        self.assertEqual(info.default_sort, "newest")
        self.assertEqual(info.sizes, ("8x8", "32x8"))
        self.assertFalse(info.requires_account)
        self.assertTrue(info.supports_search)


if __name__ == "__main__":
    unittest.main()
