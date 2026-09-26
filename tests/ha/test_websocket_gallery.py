"""`iledclock/gallery/*` and `iledclock/import/file` (docs/GALLERY.md WebSocket API), through
`hass_ws_client` with LaMetric's real HTTP shape mocked via HA's `AiohttpClientMocker` and
`tests/gallery/fixtures/lametric_icons_newest.json` -- one valid-payload success + shape check
and one invalid-payload check per command."""

from __future__ import annotations

import base64
import io
import json
from pathlib import Path

from PIL import Image

from custom_components.iledclock.gallery import lametric

_FIXTURES = Path(__file__).resolve().parents[1] / "gallery" / "fixtures"
_CATALOG = json.loads((_FIXTURES / "lametric_icons_newest.json").read_text(encoding="utf-8"))
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


# -- iledclock/gallery/sources ----------------------------------------------------------------


async def test_ws_gallery_sources_shape(hass, hass_ws_client, config_entry) -> None:
    client = await hass_ws_client(hass)
    await client.send_json_auto_id({"type": "iledclock/gallery/sources", "entry_id": config_entry.entry_id})
    response = await client.receive_json()
    assert response["success"] is True
    ids = {source["id"] for source in response["result"]}
    assert ids == {"lametric", "awtrix", "divoom"}
    divoom = next(s for s in response["result"] if s["id"] == "divoom")
    assert divoom["configured"] is False


async def test_ws_gallery_sources_unknown_entry_errors(hass, hass_ws_client) -> None:
    client = await hass_ws_client(hass)
    await client.send_json_auto_id({"type": "iledclock/gallery/sources", "entry_id": "nope"})
    response = await client.receive_json()
    assert response["success"] is False


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
