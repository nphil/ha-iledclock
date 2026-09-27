"""`iledclock/gallery/*` and `iledclock/import/file` (docs/GALLERY.md WebSocket API), through
`hass_ws_client` with LaMetric's real HTTP shape mocked via HA's `AiohttpClientMocker` and
`tests/gallery/fixtures/lametric_icons_newest.json` -- one valid-payload success + shape check
and one invalid-payload check per command."""

from __future__ import annotations

import base64
import io
import json
from datetime import timedelta
from pathlib import Path

from homeassistant.components.http.auth import async_sign_path
from PIL import Image

import custom_components.iledclock.gallery as gallery
from custom_components.iledclock.gallery import coolledx, coolledx_anim, lametric

_FIXTURES = Path(__file__).resolve().parents[1] / "gallery" / "fixtures"
_CATALOG = json.loads((_FIXTURES / "lametric_icons_newest.json").read_text(encoding="utf-8"))
_COOLLEDX_FIXTURES = Path(__file__).resolve().parents[1] / "fixtures" / "coolledx"
_COOLLEDX_CONFIG = json.loads((_COOLLEDX_FIXTURES / "config.json").read_text(encoding="utf-8"))
_COOLLEDX_CATEGORIES = json.loads((_COOLLEDX_FIXTURES / "category-fc-16x32.json").read_text(encoding="utf-8"))
_COOLLEDX_CATEGORY_URL = f"{_COOLLEDX_CONFIG['material_url']}/fc/16x32/category.json"
_COOLLEDX_STATIC = json.loads((_COOLLEDX_FIXTURES / "data1632_static_sample.json").read_text(encoding="utf-8"))
_COOLLEDX_DYNAMIC = json.loads((_COOLLEDX_FIXTURES / "data1632_dynamic_sample.json").read_text(encoding="utf-8"))
#: First "picture" (non-animated) row in the fixture -- id 77476, per `test_lametric_source.py`.
_ITEM_ID = "77476"
_MEDIA_URL = f"{lametric.MEDIA_BASE_URL}/{_ITEM_ID}.png"


def _png_bytes(color: tuple[int, int, int] = (10, 200, 30)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (8, 8), color).save(buf, format="PNG")
    return buf.getvalue()


def _mock_catalog(aioclient_mock) -> None:
    aioclient_mock.get(lametric.BASE_URL, json=_CATALOG)


def _mock_media(aioclient_mock, data: bytes | None = None) -> None:
    aioclient_mock.get(_MEDIA_URL, content=data or _png_bytes())


def _mock_coolledx_categories(aioclient_mock, *, category_ids: set[str] | None = None) -> None:
    categories = list(_COOLLEDX_CATEGORIES["category"])
    if category_ids is not None:
        categories = [item for item in categories if item["url"].rsplit("/", 1)[-1] in category_ids]
    aioclient_mock.get(coolledx.CONFIG_URL, json=_COOLLEDX_CONFIG)
    aioclient_mock.get(
        _COOLLEDX_CATEGORY_URL,
        json={**_COOLLEDX_CATEGORIES, "category": categories},
    )





# -- iledclock/gallery/sources ----------------------------------------------------------------


async def test_ws_gallery_sources_shape(hass, hass_ws_client, config_entry, aioclient_mock) -> None:
    _mock_coolledx_categories(aioclient_mock)
    client = await hass_ws_client(hass)
    await client.send_json_auto_id({"type": "iledclock/gallery/sources", "entry_id": config_entry.entry_id})
    response = await client.receive_json()
    assert response["success"] is True
    sources = response["result"]
    ids = {source["id"] for source in sources}
    assert ids == {"iledclock", "iledclock_anim", "lametric", "awtrix", "divoom"}
    originals = next(s for s in sources if s["id"] == "iledclock")
    assert originals["kind"] == "native"
    assert {category["id"] for category in originals["categories"]} == {
        "trending", "creative", "emoji", "life", "festival", "sport", "flag", "business", "default"
    }
    animations = next(s for s in sources if s["id"] == "iledclock_anim")
    assert animations["kind"] == "native"
    assert animations["categories"] == [{"id": "static", "label": "Static"}, {"id": "dynamic", "label": "Dynamic"}]
    divoom = next(s for s in sources if s["id"] == "divoom")
    assert divoom["configured"] is False



async def test_ws_gallery_sources_unknown_entry_errors(hass, hass_ws_client) -> None:
    client = await hass_ws_client(hass)
    await client.send_json_auto_id({"type": "iledclock/gallery/sources", "entry_id": "nope"})
    response = await client.receive_json()
    assert response["success"] is False


async def test_ws_gallery_shelves_plan(hass, hass_ws_client, config_entry, aioclient_mock) -> None:
    _mock_coolledx_categories(aioclient_mock)
    client = await hass_ws_client(hass)
    await client.send_json_auto_id({"type": "iledclock/gallery/shelves", "entry_id": config_entry.entry_id})
    response = await client.receive_json()

    assert response["success"] is True
    shelves = {shelf["id"]: shelf for shelf in response["result"]}
    assert shelves["iledclock-trending"]["source"] == "iledclock"
    assert shelves["iledclock-trending"]["category"] == "trending"
    assert shelves["iledclock-creative"]["category"] == "creative"
    assert shelves["iledclock-emoji"]["category"] == "emoji"
    assert shelves["iledclock-festival"]["category"] == "festival"
    assert shelves["iledclock-animations"]["source"] == "iledclock_anim"
    assert shelves["lametric-popular"]["sort"] == "popular"
    assert shelves["awtrix-new"]["sort"] == "newest"
    assert "divoom-trending" not in shelves


async def test_ws_gallery_search_iledclock_category_and_slash_item_id(
    hass, hass_ws_client, config_entry, aioclient_mock
) -> None:
    _mock_coolledx_categories(aioclient_mock, category_ids={"trending"})
    category = next(
        item for item in _COOLLEDX_CATEGORIES["category"]
        if item["url"].rsplit("/", 1)[-1] == "trending"
    )
    manifest = json.loads((_COOLLEDX_FIXTURES / "items-trending-en.json").read_text(encoding="utf-8"))
    aioclient_mock.get(f"{category['url']}/list_en.json", json=manifest)
    gallery._cache(hass).put(
        "frames:iledclock:trending/fc_16x32_254_77.gif", b"1", content_type="text/plain"
    )
    client = await hass_ws_client(hass)
    await client.send_json_auto_id({
        "type": "iledclock/gallery/search", "entry_id": config_entry.entry_id,
        "source": "iledclock", "page": 1, "category": "trending",
    })
    response = await client.receive_json()

    assert response["success"] is True
    result = response["result"]
    assert len(result["items"]) == 48
    first = result["items"][0]
    assert first["id"] == "trending/fc_16x32_254_77.gif"
    assert first["frames"] == 1
    assert first["animated"] is False
    assert first["category"] == "trending"
    assert first["native_fit"] is True
    assert first["media_path"].startswith("/api/iledclock/gallery/media/iledclock/trending/")
    await client.send_json_auto_id({
        "type": "iledclock/gallery/search", "entry_id": config_entry.entry_id,
        "source": "iledclock", "page": 1, "category": "trending", "animated_only": True,
    })
    filtered_response = await client.receive_json()

    assert filtered_response["success"] is True
    filtered_ids = {item["id"] for item in filtered_response["result"]["items"]}
    assert "trending/fc_16x32_254_77.gif" not in filtered_ids


async def test_gallery_media_view_coolledx_nested_id_records_decoded_frame_count(
    hass, hass_client_no_auth, config_entry, aioclient_mock
) -> None:
    _mock_coolledx_categories(aioclient_mock, category_ids={"trending"})
    category = next(
        item for item in _COOLLEDX_CATEGORIES["category"]
        if item["url"].rsplit("/", 1)[-1] == "trending"
    )
    manifest = json.loads((_COOLLEDX_FIXTURES / "items-trending-en.json").read_text(encoding="utf-8"))
    aioclient_mock.get(f"{category['url']}/list_en.json", json=manifest)
    filename = manifest["list"][0]
    item_id = f"trending/{filename}"
    media_url = f"{manifest['baseUrl'].rstrip('/')}/{filename}"

    gif_buffer = io.BytesIO()
    Image.new("P", (32, 16), 1).save(gif_buffer, format="GIF")
    expected_gif = gif_buffer.getvalue()
    encrypted_gif = bytearray(expected_gif)
    for index in range(min(32, len(encrypted_gif))):
        encrypted_gif[index] ^= 0xDA
    aioclient_mock.get(media_url, content=bytes(encrypted_gif))

    path = f"/api/iledclock/gallery/media/iledclock/{item_id}?entry_id={config_entry.entry_id}"
    signed_path = async_sign_path(hass, path, timedelta(seconds=30))
    client = await hass_client_no_auth()
    response = await client.get(signed_path)

    assert response.status == 200
    assert response.content_type == "image/gif"
    media = await response.read()
    assert media == expected_gif
    frame_count = gallery._cache(hass).get(f"frames:iledclock:{item_id}", ttl_s=None)
    assert frame_count is not None
    assert frame_count.data == b"1"


async def test_ws_gallery_search_animation_source_filters_decoded_frames(
    hass, hass_ws_client, config_entry, aioclient_mock
) -> None:
    aioclient_mock.get(f"{coolledx_anim.BASE_URL}/data1632_static.json", json=_COOLLEDX_STATIC)
    aioclient_mock.get(f"{coolledx_anim.BASE_URL}/data1632_dynamic.json", json=_COOLLEDX_DYNAMIC)
    client = await hass_ws_client(hass)
    await client.send_json_auto_id({
        "type": "iledclock/gallery/search", "entry_id": config_entry.entry_id,
        "source": "iledclock_anim", "page": 1, "category": "dynamic", "animated_only": True,
    })
    response = await client.receive_json()

    assert response["success"] is True
    result = response["result"]
    first = result["items"][0]
    assert first["id"] == "dynamic-14-0"
    assert first["frames"] == 14
    assert first["animated"] is True
    assert first["category"] == "dynamic"
    assert first["native_fit"] is True
    assert result["has_more"] is False


# -- iledclock/gallery/search -----------------------------------------------------------------


async def test_ws_gallery_search_success_shape(hass, hass_ws_client, config_entry, aioclient_mock) -> None:
    _mock_catalog(aioclient_mock)
    client = await hass_ws_client(hass)
    await client.send_json_auto_id(
        {
            "type": "iledclock/gallery/search",
            "entry_id": config_entry.entry_id,
            "source": "lametric",
            "page": 1,
        }
    )
    response = await client.receive_json()
    assert response["success"] is True
    result = response["result"]
    assert result["page"] == 1
    # All 20 fixture rows fit in one 24-item page -- `has_more` correctly reports "no more".
    assert len(result["items"]) == 20
    assert result["has_more"] is False
    item = result["items"][0]
    assert item["source"] == "lametric"
    assert item["media_path"].startswith(f"/api/iledclock/gallery/media/lametric/{item['id']}")


async def test_ws_gallery_search_page_is_one_based(hass, hass_ws_client, config_entry, aioclient_mock) -> None:
    """Contract: pages are 1-based -- `page: 0` is a structurally invalid payload, not "page
    before the first" silently clamped to page 1."""
    _mock_catalog(aioclient_mock)
    client = await hass_ws_client(hass)
    await client.send_json_auto_id(
        {
            "type": "iledclock/gallery/search",
            "entry_id": config_entry.entry_id,
            "source": "lametric",
            "page": 0,
        }
    )
    response = await client.receive_json()
    assert response["success"] is False
    assert response["error"]["code"] == "invalid_format"


async def test_ws_gallery_search_unknown_source_errors(hass, hass_ws_client, config_entry) -> None:
    client = await hass_ws_client(hass)
    await client.send_json_auto_id(
        {
            "type": "iledclock/gallery/search",
            "entry_id": config_entry.entry_id,
            "source": "not-a-real-source",
            "page": 1,
        }
    )
    response = await client.receive_json()
    assert response["success"] is False
    assert response["error"]["code"] == "unknown_source"


# -- iledclock/gallery/preview ------------------------------------------------------------------


async def test_ws_gallery_preview_success_shape(hass, hass_ws_client, config_entry, aioclient_mock) -> None:
    _mock_catalog(aioclient_mock)
    _mock_media(aioclient_mock)
    client = await hass_ws_client(hass)
    await client.send_json_auto_id(
        {
            "type": "iledclock/gallery/preview",
            "entry_id": config_entry.entry_id,
            "source": "lametric",
            "item_id": _ITEM_ID,
        }
    )
    response = await client.receive_json()
    assert response["success"] is True
    result = response["result"]
    assert len(result["frames"]) >= 1
    assert len(base64.b64decode(result["frames"][0])) == 32 * 16 * 3
    assert "layout" in result
    assert "layouts_available" in result


async def test_ws_gallery_preview_unknown_item_errors(hass, hass_ws_client, config_entry, aioclient_mock) -> None:
    _mock_catalog(aioclient_mock)
    client = await hass_ws_client(hass)
    await client.send_json_auto_id(
        {
            "type": "iledclock/gallery/preview",
            "entry_id": config_entry.entry_id,
            "source": "lametric",
            "item_id": "no-such-item",
        }
    )
    response = await client.receive_json()
    assert response["success"] is False


# -- iledclock/gallery/import -------------------------------------------------------------------


async def test_ws_gallery_import_saves_design_with_credit(hass, hass_ws_client, config_entry, aioclient_mock) -> None:
    _mock_catalog(aioclient_mock)
    _mock_media(aioclient_mock)
    client = await hass_ws_client(hass)
    await client.send_json_auto_id(
        {
            "type": "iledclock/gallery/import",
            "entry_id": config_entry.entry_id,
            "source": "lametric",
            "item_id": _ITEM_ID,
        }
    )
    response = await client.receive_json()
    assert response["success"] is True
    design_id = response["result"]["design_id"]
    assert isinstance(design_id, str) and design_id

    await client.send_json_auto_id({"type": "iledclock/designs/list"})
    designs = (await client.receive_json())["result"]
    saved = next(d for d in designs if d["id"] == design_id)
    assert saved["origin"]["source"] == "lametric"
    assert saved["origin"]["id"] == _ITEM_ID


async def test_ws_gallery_import_unknown_source_errors(hass, hass_ws_client, config_entry) -> None:
    client = await hass_ws_client(hass)
    await client.send_json_auto_id(
        {
            "type": "iledclock/gallery/import",
            "entry_id": config_entry.entry_id,
            "source": "not-a-real-source",
            "item_id": _ITEM_ID,
        }
    )
    response = await client.receive_json()
    assert response["success"] is False


# -- iledclock/import/file ----------------------------------------------------------------------


async def test_ws_import_file_preview_then_save(hass, hass_ws_client, config_entry) -> None:
    client = await hass_ws_client(hass)
    data_b64 = base64.b64encode(_png_bytes()).decode("ascii")

    await client.send_json_auto_id(
        {
            "type": "iledclock/import/file",
            "entry_id": config_entry.entry_id,
            "filename": "swatch.png",
            "data_b64": data_b64,
        }
    )
    response = await client.receive_json()
    assert response["success"] is True
    assert "design_id" not in response["result"]
    assert len(response["result"]["frames"]) >= 1

    await client.send_json_auto_id(
        {
            "type": "iledclock/import/file",
            "entry_id": config_entry.entry_id,
            "filename": "swatch.png",
            "data_b64": data_b64,
            "save": True,
            "name": "Swatch",
        }
    )
    response = await client.receive_json()
    assert response["success"] is True
    assert isinstance(response["result"]["design_id"], str)


async def test_ws_import_file_invalid_base64_errors(hass, hass_ws_client, config_entry) -> None:
    client = await hass_ws_client(hass)
    await client.send_json_auto_id(
        {
            "type": "iledclock/import/file",
            "entry_id": config_entry.entry_id,
            "filename": "swatch.png",
            "data_b64": "not-valid-base64!!!",
        }
    )
    response = await client.receive_json()
    assert response["success"] is False
    assert response["error"]["code"] == "invalid_format"
