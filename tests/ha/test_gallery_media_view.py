"""The gallery media HTTP proxy view (docs/GALLERY.md): reached only through a signed path
(the same mechanism the frontend uses via `auth/sign_path`), returns the fetched media's raw
bytes and content type."""

from __future__ import annotations

import asyncio
import json
from datetime import timedelta
from pathlib import Path
from unittest.mock import AsyncMock

from homeassistant.components.http.auth import async_sign_path

from custom_components.iledclock import gallery
from custom_components.iledclock.gallery import GalleryCommandError, lametric
from custom_components.iledclock.gallery.models import SourceNotFound, SourceRequestError, SourceTimeout

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


async def test_gallery_media_view_maps_source_failures_to_http_statuses(
    hass, hass_client_no_auth, config_entry, monkeypatch
) -> None:
    client = await hass_client_no_auth()
    cases = (
        (SourceNotFound("missing"), 404),
        (SourceRequestError("upstream unavailable"), 502),
        (SourceTimeout("upstream timed out"), 504),
        (GalleryCommandError("unknown_entry", "missing integration entry"), 404),
        (GalleryCommandError("unknown_source", "missing source"), 400),
    )

    for index, (failure, expected_status) in enumerate(cases):
        monkeypatch.setattr(gallery, "async_fetch_media", AsyncMock(side_effect=failure))
        path = (
            f"/api/iledclock/gallery/media/lametric/error-{index}"
            f"?entry_id={config_entry.entry_id}"
        )
        response = await client.get(async_sign_path(hass, path, timedelta(seconds=30)))
        assert response.status == expected_status


async def test_gallery_media_view_deadline_returns_gateway_timeout(
    hass, hass_client_no_auth, config_entry, monkeypatch
) -> None:
    monkeypatch.setattr(gallery, "MEDIA_REQUEST_TIMEOUT_S", 0.001)

    async def never_finishes(*_args, **_kwargs):
        await asyncio.sleep(1)

    monkeypatch.setattr(gallery, "async_fetch_media", never_finishes)
    path = f"/api/iledclock/gallery/media/lametric/slow?entry_id={config_entry.entry_id}"
    client = await hass_client_no_auth()
    response = await client.get(async_sign_path(hass, path, timedelta(seconds=30)))
    assert response.status == 504


async def test_gallery_media_view_accepts_slash_containing_item_ids(
    hass, hass_client_no_auth, config_entry, monkeypatch
) -> None:
    item_id = "dynamic/nature/river.gif"
    fetch = AsyncMock(return_value=(b"gif-data", "image/gif"))
    monkeypatch.setattr(gallery, "async_fetch_media", fetch)
    path = (
        f"/api/iledclock/gallery/media/iledclock_anim/{item_id}"
        f"?entry_id={config_entry.entry_id}"
    )
    client = await hass_client_no_auth()
    response = await client.get(async_sign_path(hass, path, timedelta(seconds=30)))
    assert response.status == 200
    assert await response.read() == b"gif-data"
    fetch.assert_awaited_once_with(
        hass, config_entry.entry_id, source="iledclock_anim", item_id=item_id
    )


async def test_coolledx_media_cache_reuses_bytes_and_stores_decoded_frame_count(
    hass, config_entry, monkeypatch
) -> None:
    from functools import partial
    from io import BytesIO

    from PIL import Image

    from custom_components.iledclock.gallery.models import SourceMedia

    first = Image.new("RGB", (1, 1), (255, 0, 0))
    second = Image.new("RGB", (1, 1), (0, 0, 255))
    encoded = BytesIO()
    first.save(encoded, format="GIF", save_all=True, append_images=[second], duration=40, loop=0)
    media = SourceMedia(encoded.getvalue(), "image/gif")
    catalog = object()
    calls = []

    async def fake_fetch(_session, _catalog, item_id):
        calls.append(item_id)
        await asyncio.sleep(0.01)
        return media

    monkeypatch.setattr(gallery, "_coolledx_catalog", AsyncMock(return_value=catalog))
    monkeypatch.setattr(gallery.coolledx, "fetch_media", fake_fetch)
    item_id = "trending/fish/blue.gif"
    results = []
    for _ in range(5):
        results.append(
            await gallery.async_fetch_media(
                hass, config_entry.entry_id, source="iledclock", item_id=item_id
            )
        )

    assert results == [(media.data, media.content_type)] * 5
    assert calls == [item_id]
    frame_entry = await hass.async_add_executor_job(
        partial(gallery._cache(hass).get, f"frames:iledclock:{item_id}", ttl_s=None)
    )
    assert frame_entry is not None
    assert frame_entry.data == b"2"


async def test_decode_failure_is_negative_cached_without_caching_media(
    hass, config_entry, monkeypatch
) -> None:
    from custom_components.iledclock.gallery.models import SourceDecodeError

    calls = 0

    async def invalid_media(*_args):
        nonlocal calls
        calls += 1
        raise SourceDecodeError("invalid image data")

    monkeypatch.setattr(gallery, "_coolledx_catalog", AsyncMock(return_value=object()))
    monkeypatch.setattr(gallery.coolledx, "fetch_media", invalid_media)
    for _ in range(2):
        try:
            await gallery.async_fetch_media(
                hass,
                config_entry.entry_id,
                source="iledclock",
                item_id="trending/broken.gif",
            )
        except SourceDecodeError:
            pass
        else:
            raise AssertionError("a malformed gallery item must keep failing until its negative cache expires")
    assert calls == 1


async def test_media_concurrency_is_limited_per_source(hass, config_entry, monkeypatch) -> None:
    from custom_components.iledclock.gallery.models import SourceMedia

    active = 0
    peak = 0
    reached_limit = asyncio.Event()
    release = asyncio.Event()

    async def blocked_fetch(_session, item_id):
        nonlocal active, peak
        active += 1
        peak = max(peak, active)
        if active == gallery.MEDIA_CONCURRENCY_PER_SOURCE:
            reached_limit.set()
        await release.wait()
        active -= 1
        return SourceMedia(item_id.encode(), "image/webp")

    monkeypatch.setattr(gallery.awtrix, "fetch_media", blocked_fetch)
    tasks = [
        asyncio.create_task(
            gallery.async_fetch_media(
                hass, config_entry.entry_id, source="awtrix", item_id=f"icon-{index}"
            )
        )
        for index in range(gallery.MEDIA_CONCURRENCY_PER_SOURCE + 1)
    ]
    try:
        await asyncio.wait_for(reached_limit.wait(), timeout=2)
        assert peak == gallery.MEDIA_CONCURRENCY_PER_SOURCE
    finally:
        release.set()
        await asyncio.gather(*tasks)
    assert peak == gallery.MEDIA_CONCURRENCY_PER_SOURCE
