"""Contract tests for the captured iLedClock material gallery responses."""
from __future__ import annotations

import asyncio
import io
import json
import unittest
from pathlib import Path
from typing import Any

from PIL import Image

from custom_components.iledclock.gallery import coolledx
from custom_components.iledclock.gallery.models import SourceNotFound

_FIXTURES = Path(__file__).resolve().parents[1] / "fixtures" / "coolledx"


def _load(name: str) -> dict[str, Any]:
    return json.loads((_FIXTURES / name).read_text(encoding="utf-8"))


class _Response:
    def __init__(self, *, payload: Any = None, content: bytes = b"", status: int = 200) -> None:
        self.payload = payload
        self.content = content
        self.status = status

    async def __aenter__(self) -> "_Response":
        return self

    async def __aexit__(self, *_: Any) -> None:
        return None

    async def json(self, *, content_type: str | None = None) -> Any:
        return self.payload

    async def read(self) -> bytes:
        return self.content


class _Session:
    def __init__(self, responses: dict[str, _Response]) -> None:
        self.responses = responses
        self.calls: list[str] = []
        self.options: list[dict[str, Any]] = []

    def get(self, url: str, **options: Any) -> _Response:
        self.calls.append(url)
        self.options.append(options)
        return self.responses.get(url, _Response(status=404))


def _gif_bytes() -> bytes:
    output = io.BytesIO()
    frames = [Image.new("RGB", (32, 16), color) for color in ((255, 0, 0), (0, 255, 0))]
    frames[0].save(output, format="GIF", save_all=True, append_images=frames[1:], duration=120, loop=0)
    return output.getvalue()


class CoolledxCatalogTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        self.category_payload = _load("category-fc-16x32.json")
        self.manifest = _load("items-trending-en.json")
        self.categories = coolledx.parse_categories(self.category_payload, "en")
        self.trending = next(category for category in self.categories if category.id == "trending")
        self.catalog = coolledx.build_catalog(
            (self.trending,), {"trending": self.manifest}
        )

    def test_localized_category_labels_and_legacy_hebrew_code(self) -> None:
        categories_fr = coolledx.parse_categories(self.category_payload, "fr-FR")
        categories_iw = coolledx.parse_categories(self.category_payload, "iw")
        self.assertEqual(categories_fr[0].label, "Tendance")
        self.assertEqual(categories_iw[0].label, "פופולרי")
        self.assertEqual([category.id for category in self.categories[:3]], ["trending", "creative", "emoji"])

    def test_items_use_category_filename_ids_and_local_paging(self) -> None:
        page = coolledx.search(self.catalog, page=1)
        self.assertEqual(len(page.items), 48)
        self.assertTrue(page.has_more)
        first = page.items[0]
        self.assertEqual(first.id, "trending/fc_16x32_254_77.gif")
        self.assertEqual(first.title, "")
        self.assertEqual((first.width, first.height), (32, 16))
        self.assertEqual(first.category, "trending")
        self.assertTrue(first.native_fit)

        last_page = coolledx.search(self.catalog, page=2)
        self.assertEqual(len(last_page.items), 1)
        self.assertFalse(last_page.has_more)
        self.assertEqual(coolledx.search(self.catalog, query="254_77").items, (first,))
        self.assertEqual(coolledx.search(self.catalog, category="creative").items, ())

    def test_vendor_urls_reject_other_hosts_ip_literals_and_custom_ports(self) -> None:
        self.assertTrue(coolledx.is_vendor_url("http://www.coolledx.com/path"))
        self.assertTrue(coolledx.is_vendor_url("https://coolledx.com/path"))
        for url in (
            "http://127.0.0.1/config.json",
            "http://192.168.1.1/config.json",
            "http://[::1]/config.json",
            "http://attacker.example/config.json",
            "https://www.coolledx.com.attacker.example/path",
            "http://user@coolledx.com/path",
            "http://coolledx.com:8080/path",
        ):
            with self.subTest(url=url):
                self.assertFalse(coolledx.is_vendor_url(url))

    async def test_vendor_redirect_is_not_followed(self) -> None:
        session = _Session({coolledx.CONFIG_URL: _Response(status=302)})
        with self.assertRaises(coolledx.SourceRequestError):
            await coolledx.fetch_categories(session)
        self.assertEqual(session.calls, [coolledx.CONFIG_URL])
        self.assertIs(session.options[0]["allow_redirects"], False)

    async def test_tampered_config_material_url_is_rejected_before_request(self) -> None:
        session = _Session({coolledx.CONFIG_URL: _Response(payload={"material_url": "http://127.0.0.1"})})
        with self.assertRaises(coolledx.SourceRequestError):
            await coolledx.fetch_categories(session)
        self.assertEqual(session.calls, [coolledx.CONFIG_URL])

    def test_untrusted_manifest_base_url_is_discarded(self) -> None:
        catalog = coolledx.build_catalog(
            (self.trending,),
            {"trending": {"baseUrl": "http://10.0.0.8/secret", "list": ["image.gif"]}},
        )
        self.assertEqual(catalog.items, ())
        self.assertIsNone(catalog.media_url("trending/image.gif"))

    def test_untrusted_manifest_filenames_cannot_escape_media_path(self) -> None:
        catalog = coolledx.build_catalog(
            (self.trending,),
            {"trending": {"baseUrl": self.manifest["baseUrl"], "list": ["../oops.gif", "x.gif?bad=1", "ok.gif"]}},
        )
        self.assertEqual([item.id for item in catalog.items], ["trending/ok.gif"])
        self.assertEqual(catalog.media_url("trending/ok.gif"), f"{self.manifest['baseUrl']}/ok.gif")

    def test_catalog_cache_round_trip_preserves_category_and_media_resolution(self) -> None:
        restored = coolledx.catalog_from_json(coolledx.catalog_to_json(self.catalog))
        self.assertEqual(restored.items[0].to_json(), self.catalog.items[0].to_json())
        self.assertEqual(restored.media_url("trending/fc_16x32_254_77.gif"),
                         f"{self.manifest['baseUrl']}/fc_16x32_254_77.gif")


class CoolledxHttpTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        categories = coolledx.parse_categories(_load("category-fc-16x32.json"), "en")
        self.catalog = coolledx.build_catalog(
            categories, {"trending": _load("items-trending-en.json")},
        )

    async def test_catalog_falls_back_to_english_manifest_on_locale_404(self) -> None:
        config = _load("config.json")
        category_payload = _load("category-fc-16x32.json")
        manifest = _load("items-trending-en.json")
        category = coolledx.parse_categories(category_payload, "fr")[0]
        session = _Session({
            f"{category.url}/list_fr.json": _Response(status=404),
            f"{category.url}/list_en.json": _Response(payload=manifest),
        })

        catalog = await coolledx.fetch_catalog(session, language="fr", categories=(category,))

        self.assertEqual(len(catalog.items), 49)
        self.assertEqual(session.calls, [f"{category.url}/list_fr.json", f"{category.url}/list_en.json"])
        self.assertEqual(config["material_url"], "http://www.coolledx.com/CoolLEDX/iLedClock/material")

    async def test_fetch_categories_uses_hardware_rows_then_columns(self) -> None:
        config = _load("config.json")
        category_payload = _load("category-fc-16x32.json")
        category_url = f"{config['material_url']}/fc/16x32/category.json"
        session = _Session({
            coolledx.CONFIG_URL: _Response(payload=config),
            category_url: _Response(payload=category_payload),
        })

        categories = await coolledx.fetch_categories(session, language="en")

        self.assertEqual(len(categories), 9)
        self.assertEqual(session.calls, [coolledx.CONFIG_URL, category_url])

    async def test_media_decrypts_only_the_obfuscated_prefix_and_counts_frames(self) -> None:
        original = _gif_bytes()
        encrypted = bytes(value ^ 0xDA for value in original[:32]) + original[32:]
        media_url = self.catalog.media_url(self.catalog.items[0].id)
        session = _Session({media_url: _Response(content=encrypted)})

        media = await coolledx.fetch_media(session, self.catalog, self.catalog.items[0].id)

        self.assertEqual(media.content_type, "image/gif")
        self.assertEqual(media.data, original)
        self.assertEqual(coolledx.frame_count(media.data), 2)

    async def test_media_redirect_is_not_followed(self) -> None:
        item = self.catalog.items[0]
        url = self.catalog.media_url(item.id)
        session = _Session({url: _Response(status=302)})
        with self.assertRaises(coolledx.SourceRequestError):
            await coolledx.fetch_media(session, self.catalog, item.id)
        self.assertEqual(session.calls, [url])
        self.assertIs(session.options[0]["allow_redirects"], False)

    async def test_missing_media_is_a_not_found_error(self) -> None:
        item = self.catalog.items[0]
        session = _Session({})
        with self.assertRaises(SourceNotFound):
            await coolledx.fetch_media(session, self.catalog, item.id)


if __name__ == "__main__":
    unittest.main()
