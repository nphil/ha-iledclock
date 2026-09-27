"""Divoom source tests use deterministic listing rows and captured artwork containers."""

from __future__ import annotations

import asyncio
import io
import json
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from custom_components.iledclock.gallery import divoom
from custom_components.iledclock.gallery.models import SourceNotFound, SourceRequestError, SourceTimeout

_FIXTURES = Path(__file__).parent / "fixtures"

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

class _FakeResponse:
    def __init__(self, *, payload=None, data=b"file", status=200, json_error=None):
        self.payload = payload
        self.data = data
        self.status = status
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

    def post(self, url, *, json, **kwargs):
        self.calls.append((url, json))
        response = self.responses.pop(0)
        if isinstance(response, BaseException):
            raise response
        return response

    def get(self, url, **kwargs):
        self.calls.append((url, kwargs))
        response = self.responses.pop(0)
        if isinstance(response, BaseException):
            raise response
        return response


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
    def test_captured_multiframe_artwork_uses_the_real_decoder_and_gif_encoder(self) -> None:
        from PIL import Image

        raw = (_FIXTURES / "divoom_33674.dat").read_bytes()
        media = divoom._decode_and_encode(raw, "33674")
        decoded = Image.open(io.BytesIO(media.data))

        self.assertEqual(media.content_type, "image/gif")
        self.assertEqual(decoded.size, (16, 16))
        self.assertEqual(decoded.n_frames, 4)
        decoded.seek(0)
        self.assertEqual(decoded.convert("RGB").getpixel((0, 0)), (0, 254, 254))

class SourceInfoTests(unittest.TestCase):
    def test_requires_account_and_sorts(self) -> None:
        info = divoom.source_info(configured=False)
        self.assertTrue(info.requires_account)
        self.assertFalse(info.configured)
        self.assertEqual([s.id for s in info.sorts], ["recommended", "new", "popular"])
        self.assertEqual(info.sizes, ("16x16", "32x32", "64x64"))

class DivoomRequestTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self._retry_delay = divoom._RETRY_DELAY_S
        divoom._RETRY_DELAY_S = 0
        divoom._token_cache.clear()
        divoom._login_locks.clear()

    def tearDown(self):
        divoom._RETRY_DELAY_S = self._retry_delay
        divoom._token_cache.clear()
        divoom._login_locks.clear()

    async def test_invalid_json_and_transient_http_errors_retry_once(self):
        invalid_json = _FakeSession([
            _FakeResponse(json_error=json.JSONDecodeError("invalid", "x", 0)),
            _FakeResponse(payload={"ReturnCode": 0}),
        ])
        self.assertEqual(await divoom._post_json(invalid_json, "/test", {}), {"ReturnCode": 0})
        self.assertEqual(len(invalid_json.calls), 2)

        transient_http = _FakeSession([
            _FakeResponse(status=503),
            _FakeResponse(payload={"ReturnCode": 0}),
        ])
        await divoom._post_json(transient_http, "/test", {})
        self.assertEqual(len(transient_http.calls), 2)

    async def test_timeout_retries_once_and_404_is_not_found(self):
        timed_out = _FakeSession([asyncio.TimeoutError(), asyncio.TimeoutError()])
        with self.assertRaises(SourceTimeout):
            await divoom._post_json(timed_out, "/test", {})
        self.assertEqual(len(timed_out.calls), 2)

        missing = _FakeSession([_FakeResponse(status=404)])
        with self.assertRaises(SourceNotFound):
            await divoom._post_json(missing, "/test", {})
        self.assertEqual(len(missing.calls), 1)

    async def test_login_token_is_reused_until_its_refresh_margin(self):
        account = divoom.DivoomAccount("example@example.invalid", "test-hash")
        now = [1_000.0]
        tokens = iter(("token-one", "token-two"))

        async def fake_post(_session, _path, _payload):
            return {"UserId": "user-1", "Token": next(tokens)}

        with patch.object(divoom, "_monotonic", side_effect=lambda: now[0]):
            post = AsyncMock(side_effect=fake_post)
            with patch.object(divoom, "_post_json", post):
                first = await divoom.login(object(), account)
                second = await divoom.login(object(), account)
                now[0] += divoom.TOKEN_CACHE_TTL_S - divoom.TOKEN_REFRESH_MARGIN_S + 1
                third = await divoom.login(object(), account)

        self.assertEqual(first["Token"], "token-one")
        self.assertEqual(second["Token"], "token-one")
        self.assertEqual(third["Token"], "token-two")
        self.assertEqual(post.await_count, 2)

    async def test_rejected_cached_token_is_refreshed_once(self):
        account = divoom.DivoomAccount("example@example.invalid", "test-hash")
        used_tokens = []

        async def fake_post(_session, path, payload):
            if path == divoom.ENDPOINT_LOGIN:
                return {"UserId": "user-1", "Token": "old-token" if not used_tokens else "new-token"}
            used_tokens.append(payload["Token"])
            if len(used_tokens) == 1:
                raise divoom._DivoomAuthError("expired")
            return {"ReturnCode": 0, "ReturnMessage": "Login successful", "FileList": []}

        post = AsyncMock(side_effect=fake_post)
        with patch.object(divoom, "_post_json", post):
            response = await divoom._authenticated_post(object(), account, "/listing", {})

        self.assertEqual(response["ReturnCode"], 0)
        self.assertEqual(used_tokens, ["old-token", "new-token"])
        self.assertEqual(post.await_count, 4)

    async def test_failed_token_refresh_logs_once_after_bounded_retry(self):
        account = divoom.DivoomAccount("failure@example.invalid", "test-hash")
        login_count = 0

        async def fake_post(_session, path, _payload):
            nonlocal login_count
            if path == divoom.ENDPOINT_LOGIN:
                login_count += 1
                return {"UserId": "user-1", "Token": f"token-{login_count}"}
            return {"ReturnCode": 403, "ReturnMessage": "token expired"}

        post = AsyncMock(side_effect=fake_post)
        with patch.object(divoom, "_last_warning_at", 0):
            with patch.object(divoom, "_monotonic", return_value=100):
                with self.assertLogs(divoom._LOGGER, level="WARNING") as captured:
                    with patch.object(divoom, "_post_json", post):
                        with self.assertRaises(SourceRequestError):
                            await divoom._authenticated_post(object(), account, "/listing", {})

        self.assertEqual(post.await_count, 4)
        self.assertEqual(len(captured.records), 1)
        self.assertNotIn(account.email, captured.output[0])

    async def test_lookahead_pagination_returns_no_duplicate_ids(self):
        account = divoom.DivoomAccount("example@example.invalid", "test-hash")
        requests = []

        async def fake_authenticated(_session, _account, path, payload):
            requests.append((path, payload))
            start = payload["StartNum"]
            stop = 25 if start == 1 else 30
            return {
                "ReturnCode": 0,
                "FileListNum": "30",
                "FileList": [
                    {"GalleryId": item_id, "FileName": f"Art {item_id}", "FileType": 2}
                    for item_id in range(start, stop + 1)
                ],
            }

        with patch.object(divoom, "_authenticated_post", side_effect=fake_authenticated):
            first = await divoom.search(object(), account, page=1)
            second = await divoom.search(object(), account, page=2)

        first_ids = [item.id for item in first.items]
        second_ids = [item.id for item in second.items]
        self.assertEqual(first_ids, [str(item_id) for item_id in range(1, 25)])
        self.assertEqual(second_ids, [str(item_id) for item_id in range(25, 31)])
        self.assertFalse(set(first_ids) & set(second_ids))
        self.assertTrue(first.has_more)
        self.assertFalse(second.has_more)
        self.assertEqual([(payload["StartNum"], payload["EndNum"]) for _, payload in requests], [(1, 25), (25, 49)])

    async def test_media_decoding_runs_in_the_supplied_executor(self):
        import threading

        account = divoom.DivoomAccount("example@example.invalid", "test-hash")
        raw = (_FIXTURES / "divoom_33674.dat").read_bytes()
        worker_ids = []

        async def decode_executor(function, *args):
            def run():
                worker_ids.append(threading.get_ident())
                return function(*args)
            return await asyncio.to_thread(run)

        with patch.object(divoom, "fetch_artwork_info", AsyncMock(return_value={"FileId": "captured.dat"})):
            with patch.object(divoom, "_download_file", AsyncMock(return_value=raw)):
                media = await divoom.fetch_media(object(), account, "33674", decode_executor=decode_executor)

        self.assertEqual(media.content_type, "image/gif")
        self.assertNotEqual(worker_ids[0], threading.get_ident())



if __name__ == "__main__":
    unittest.main()
