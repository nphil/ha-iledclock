"""`gallery.lametric` parser and in-memory search tests against real API responses
(docs/GALLERY.md: cache the whole catalog, filter/sort/paginate locally)."""

from __future__ import annotations

import json
import unittest
from pathlib import Path

from custom_components.iledclock.gallery import lametric

_FIXTURES = Path(__file__).parent / "fixtures"


def _load(name: str) -> dict:
    return json.loads((_FIXTURES / name).read_text(encoding="utf-8"))


class LametricParseTests(unittest.TestCase):
    def test_parses_id_title_type_into_items(self) -> None:
        payload = _load("lametric_icons_newest.json")

        items = lametric.parse_catalog_response(payload)

        self.assertEqual(len(items), 20)
        first = items[0]
        self.assertEqual(first.source, "lametric")
        self.assertEqual(first.id, "77476")
        self.assertEqual(first.title, "Humidity")
        self.assertEqual((first.width, first.height), (8, 8))
        self.assertFalse(first.animated)  # type: "picture"

    def test_movie_type_is_animated(self) -> None:
        payload = _load("lametric_icons_newest.json")
        items = lametric.parse_catalog_response(payload)
        by_id = {item.id: item for item in items}
        self.assertTrue(by_id["77468"].animated)  # "Chat Marron", type: "movie"

    def test_unicode_title_decoded(self) -> None:
        payload = _load("lametric_icons_newest.json")
        items = lametric.parse_catalog_response(payload)
        by_id = {item.id: item for item in items}
        self.assertEqual(by_id["77463"].title, "M\u00fclltonne rosa")

    def test_media_url_extension_follows_animated_flag(self) -> None:
        payload = _load("lametric_icons_popular.json")
        items = lametric.parse_catalog_response(payload)
        by_id = {item.id: item for item in items}

        self.assertEqual(
            lametric.media_url(by_id["66"]),
            "https://developer.lametric.com/content/apps/icon_thumbs/66.png",
        )
        self.assertEqual(
            lametric.media_url(by_id["653"]),
            "https://developer.lametric.com/content/apps/icon_thumbs/653.gif",
        )

    def test_empty_data_yields_no_items(self) -> None:
        self.assertEqual(lametric.parse_catalog_response({"data": []}), [])
        self.assertEqual(lametric.parse_catalog_response({}), [])


class LametricSearchTests(unittest.TestCase):
    def setUp(self) -> None:
        self.catalog = lametric.parse_catalog_response(_load("lametric_icons_popular.json"))

    def test_query_filters_by_title_case_insensitive(self) -> None:
        page = lametric.search(self.catalog, query="pika")
        self.assertEqual([item.title for item in page.items], ["Pikachu"])

    def test_animated_only_filters_to_movie_type(self) -> None:
        page = lametric.search(self.catalog, animated_only=True)
        self.assertTrue(all(item.animated for item in page.items))
        self.assertLess(len(page.items), len(self.catalog))

    def test_sort_title_is_alphabetical_case_insensitive(self) -> None:
        page = lametric.search(self.catalog, sort="title", page_size=100)
        titles = [item.title for item in page.items]
        self.assertEqual(titles, sorted(titles, key=str.casefold))

    def test_pagination_has_more_flag(self) -> None:
        first_page = lametric.search(self.catalog, page=1, page_size=3)
        self.assertEqual(len(first_page.items), 3)
        self.assertTrue(first_page.has_more)

        last_page = lametric.search(self.catalog, page=4, page_size=3)
        self.assertFalse(last_page.has_more)

    def test_size_filter_other_than_8x8_is_always_empty(self) -> None:
        page = lametric.search(self.catalog, size="32x32")
        self.assertEqual(page.items, ())
        self.assertFalse(page.has_more)

    def test_find_item_by_id(self) -> None:
        found = lametric.find_item(self.catalog, "5588")
        self.assertIsNotNone(found)
        self.assertEqual(found.title, "Pikachu")
        self.assertIsNone(lametric.find_item(self.catalog, "no-such-id"))


class LametricSourceInfoTests(unittest.TestCase):
    def test_sorts_and_size_match_contract(self) -> None:
        info = lametric.source_info()
        self.assertEqual([s.id for s in info.sorts], ["popular", "newest", "title"])
        self.assertEqual(info.sizes, ("8x8",))
        self.assertFalse(info.requires_account)
        self.assertTrue(info.supports_search)


if __name__ == "__main__":
    unittest.main()
