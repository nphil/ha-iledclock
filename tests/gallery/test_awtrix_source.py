"""`gallery.awtrix` parser tests against real captured HTML (docs/GALLERY.md: "keep the
parser tiny and fixture-tested")."""

from __future__ import annotations

import asyncio
import unittest
from pathlib import Path
from unittest.mock import patch

from custom_components.iledclock.gallery import awtrix
from custom_components.iledclock.gallery.models import SourceNotFound, SourceRequestError, SourceTimeout

_FIXTURES = Path(__file__).parent / "fixtures"


def _read(name: str) -> str:
    return (_FIXTURES / name).read_text(encoding="utf-8")


class _FakeResponse:
    def __init__(self, *, body="", data=b"image", status=200, content_type="image/webp"):
        self.body = body
        self.data = data
        self.status = status
        self.content_type = content_type

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return None

    async def text(self):
        return self.body

    async def read(self):
        return self.data


class _FakeSession:
    def __init__(self, responses, clock=None):
        self.responses = list(responses)
        self.calls = []
        self.clock = clock or (lambda: 0.0)

    def get(self, url, **kwargs):
        self.calls.append((url, kwargs, self.clock()))
        response = self.responses.pop(0)
        if isinstance(response, BaseException):
            raise response
        return response




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
            awtrix.media_url("landscape-2"), "https://awtrix.de/icons/landscape-2/preview.webp"
        )


class AwtrixSourceInfoTests(unittest.TestCase):
    def test_sort_ids_and_labels_match_contract(self) -> None:
        info = awtrix.source_info()
        sort_ids = [s.id for s in info.sorts]
        self.assertEqual(sort_ids, ["newest", "popular", "picked", "name"])
        self.assertEqual(info.default_sort, "popular")
        self.assertEqual(info.sizes, ("8x8", "32x8"))
        self.assertFalse(info.requires_account)
        self.assertTrue(info.supports_search)

class AwtrixRequestTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self._min_interval = awtrix.MIN_REQUEST_INTERVAL_S
        self._retry_delay = awtrix._RETRY_DELAY_S
        self._last_request_at = awtrix._last_request_at
        awtrix.MIN_REQUEST_INTERVAL_S = 0
        awtrix._RETRY_DELAY_S = 0
        awtrix._last_request_at = 0
        awtrix._listing_cache.clear()

    def tearDown(self):
        awtrix.MIN_REQUEST_INTERVAL_S = self._min_interval
        awtrix._RETRY_DELAY_S = self._retry_delay
        awtrix._last_request_at = self._last_request_at
        awtrix._listing_cache.clear()

    async def test_listing_cache_is_scoped_by_sort_and_page_filters(self):
        html = _read("awtrix_icons_list.html")
        session = _FakeSession([_FakeResponse(body=html), _FakeResponse(body=html)])

        popular = await awtrix.search(session, sort="popular", page=1)
        cached = await awtrix.search(session, sort="popular", page=1)
        newest = await awtrix.search(session, sort="newest", page=1)

        self.assertEqual([item.id for item in popular.items], [item.id for item in cached.items])
        self.assertTrue(popular.has_more)
        self.assertEqual(len(session.calls), 2)
        self.assertEqual(session.calls[0][1]["params"], {})
        self.assertEqual(session.calls[1][1]["params"]["sort"], "newest")
        self.assertTrue(newest.has_more)

    async def test_invalid_listing_html_is_retried_and_transient_http_is_retried(self):
        html = _read("awtrix_icons_list.html")
        malformed = _FakeSession([_FakeResponse(body="<html></html>"), _FakeResponse(body=html)])
        page = await awtrix.search(malformed, query="clock")
        self.assertEqual(len(page.items), 4)
        self.assertEqual(len(malformed.calls), 2)

        transient = _FakeSession([_FakeResponse(status=503), _FakeResponse(body=html)])
        page = await awtrix.search(transient, sort="picked")
        self.assertTrue(page.items)
        self.assertEqual(len(transient.calls), 2)

    async def test_unparseable_counted_listing_retries_but_filtered_empty_is_valid(self):
        counted_empty = '<p role="status">2,216 icons in the collection</p>'
        malformed = _FakeSession([_FakeResponse(body=counted_empty), _FakeResponse(body=counted_empty)])
        with self.assertRaises(SourceRequestError):
            await awtrix.search(malformed)
        self.assertEqual(len(malformed.calls), 2)

        no_matches = _FakeSession([_FakeResponse(body=counted_empty)])
        page = await awtrix.search(no_matches, query="no matching icon")
        self.assertEqual(page.items, ())
        self.assertFalse(page.has_more)
        self.assertEqual(len(no_matches.calls), 1)

        bad_card = '<p role="status">2,216 icons in the collection</p><article class="icon-card"><h3>Title</h3></article>'
        unrecognized = _FakeSession([_FakeResponse(body=bad_card), _FakeResponse(body=bad_card)])
        with self.assertRaises(SourceRequestError):
            await awtrix.search(unrecognized, query="filtered page")
        self.assertEqual(len(unrecognized.calls), 2)

    async def test_media_404_and_timeout_are_classified_and_webp_type_is_preserved(self):
        missing = _FakeSession([_FakeResponse(status=404)])
        with self.assertRaises(SourceNotFound):
            await awtrix.fetch_media(missing, "missing-icon")
        self.assertEqual(len(missing.calls), 1)

        timed_out = _FakeSession([asyncio.TimeoutError(), asyncio.TimeoutError()])
        with self.assertRaises(SourceTimeout):
            await awtrix.fetch_media(timed_out, "slow-icon")
        self.assertEqual(len(timed_out.calls), 2)

        media = await awtrix.fetch_media(
            _FakeSession([_FakeResponse(data=b"image-bytes", content_type=None)]), "landscape-2"
        )
        self.assertEqual(media.data, b"image-bytes")
        self.assertEqual(media.content_type, "image/webp")

    async def test_request_starts_are_spaced_by_the_source_limit(self):
        now = [100.0]
        session = _FakeSession(
            [_FakeResponse(body="ok"), _FakeResponse(body="ok")],
            clock=lambda: now[0],
        )

        async def fake_sleep(delay):
            now[0] += delay

        with patch.object(awtrix, "_monotonic", side_effect=lambda: now[0]):
            with patch.object(awtrix, "MIN_REQUEST_INTERVAL_S", 1.0):
                with patch.object(awtrix.asyncio, "sleep", new=fake_sleep):
                    await awtrix._request(session, "https://awtrix.de/one")
                    await awtrix._request(session, "https://awtrix.de/two")

        self.assertEqual([call[2] for call in session.calls], [100.0, 101.0])



if __name__ == "__main__":
    unittest.main()
