"""`gallery.lametric` parser and in-memory search tests against real API responses
(docs/GALLERY.md: cache the whole catalog, filter/sort/paginate locally)."""

from __future__ import annotations

import asyncio
import json

import unittest
from pathlib import Path

from custom_components.iledclock.gallery import lametric

_FIXTURES = Path(__file__).parent / "fixtures"


def _load(name: str) -> dict:
    return json.loads((_FIXTURES / name).read_text(encoding="utf-8"))


class _FakeResponse:
    def __init__(self, *, payload=None, data=b"image", status=200, content_type="image/png", json_error=None):
        self.payload = payload
        self.data = data
        self.status = status
        self.content_type = content_type
        self.json_error = json_error

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return None

    async def json(self, *, content_type=None):
        if self.json_error is not None:
            raise self.json_error
        return self.payload

    async def read(self):
        return self.data


class _FakeSession:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    def get(self, url, **kwargs):
        self.calls.append((url, kwargs))
        response = self.responses.pop(0)
        if isinstance(response, BaseException):
            raise response
        return response


class LametricRequestTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self._retry_delay = lametric._RETRY_DELAY_S
        lametric._RETRY_DELAY_S = 0

    def tearDown(self):
        lametric._RETRY_DELAY_S = self._retry_delay

    async def test_fetch_catalog_requests_the_selected_popular_order_after_transient_503(self):
        session = _FakeSession([
            _FakeResponse(status=503),
            _FakeResponse(payload=_load("lametric_icons_popular.json")),
        ])

        catalog = await lametric.fetch_catalog(session, order="popular")

        self.assertTrue(catalog)
        self.assertEqual(len(session.calls), 2)
        self.assertTrue(all(call[1]["params"]["order"] == "popular" for call in session.calls))

    async def test_invalid_json_is_retried_once(self):
        session = _FakeSession([
            _FakeResponse(json_error=json.JSONDecodeError("invalid", "x", 0)),
            _FakeResponse(payload=_load("lametric_icons_newest.json")),
        ])

        catalog = await lametric.fetch_catalog(session, order="newest")

        self.assertEqual(len(catalog), 20)
        self.assertEqual(len(session.calls), 2)

    async def test_missing_media_is_not_retried_and_maps_to_not_found(self):
        from custom_components.iledclock.gallery.models import SourceNotFound, SourceTimeout

        catalog = lametric.parse_catalog_response(_load("lametric_icons_popular.json"))
        session = _FakeSession([_FakeResponse(status=404)])
        with self.assertRaises(SourceNotFound):
            await lametric.fetch_media(session, catalog, "66")
        self.assertEqual(len(session.calls), 1)

        timed_out = _FakeSession([asyncio.TimeoutError(), asyncio.TimeoutError()])
        with self.assertRaises(SourceTimeout):
            await lametric.fetch_catalog(timed_out)
        self.assertEqual(len(timed_out.calls), 2)



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
