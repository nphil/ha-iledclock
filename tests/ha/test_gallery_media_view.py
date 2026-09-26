"""The gallery media HTTP proxy view (docs/GALLERY.md): reached only through a signed path
(the same mechanism the frontend uses via `auth/sign_path`), returns the fetched media's raw
bytes and content type."""

from __future__ import annotations

import json
from datetime import timedelta
from pathlib import Path

from homeassistant.components.http.auth import async_sign_path

from custom_components.iledclock.gallery import lametric

_FIXTURES = Path(__file__).resolve().parents[1] / "gallery" / "fixtures"
_CATALOG = json.loads((_FIXTURES / "lametric_icons_newest.json").read_text(encoding="utf-8"))
_ITEM_ID = "77476"
_MEDIA_URL = f"{lametric.MEDIA_BASE_URL}/{_ITEM_ID}.png"
_MEDIA_BYTES = b"\x89PNG\r\n\x1a\n" + b"not a real png but the view never decodes it, only proxies it"


async def test_gallery_media_view_signed_path_returns_bytes(
    hass, hass_client_no_auth, config_entry, aioclient_mock
) -> None:
    aioclient_mock.get(lametric.BASE_URL, json=_CATALOG)
    aioclient_mock.get(_MEDIA_URL, content=_MEDIA_BYTES, headers={"Content-Type": "image/png"})

    path = f"/api/iledclock/gallery/media/lametric/{_ITEM_ID}?entry_id={config_entry.entry_id}"
    signed_path = async_sign_path(hass, path, timedelta(seconds=30))

    client = await hass_client_no_auth()
    response = await client.get(signed_path)
    assert response.status == 200
    assert response.content_type == "image/png"
    assert await response.read() == _MEDIA_BYTES


async def test_gallery_media_view_requires_valid_signature(hass, hass_client_no_auth, config_entry) -> None:
    client = await hass_client_no_auth()
    response = await client.get(f"/api/iledclock/gallery/media/lametric/{_ITEM_ID}?entry_id={config_entry.entry_id}")
    assert response.status == 401


async def test_gallery_media_view_missing_entry_id_errors(hass, hass_client_no_auth, config_entry) -> None:
    path = f"/api/iledclock/gallery/media/lametric/{_ITEM_ID}"
    signed_path = async_sign_path(hass, path, timedelta(seconds=30))
    client = await hass_client_no_auth()
    response = await client.get(signed_path)
    assert response.status == 400
