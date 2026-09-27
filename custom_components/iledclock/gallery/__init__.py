"""HA layer for the online gallery (docs/GALLERY.md 'HA layer' + 'WebSocket API').

`async_setup_gallery(hass)` is called once from `custom_components/iledclock/__init__.py`'s
`async_setup` (see that file's `from .gallery import async_setup_gallery` + call site);
registers the WS commands and the authenticated media-proxy HTTP view. Deliberately thin:
all real logic (source parsing, pixel-bean decoding, the adaptation pipeline) lives in the
pure sibling modules (`lametric.py`/`awtrix.py`/`divoom.py`/`divoom_pixelbean.py`/
`cache.py`, `..adapt`, `..importers`) -- this module's only job is picking a source,
running its (session-injected) async calls through HA's shared aiohttp session, running
blocking work (disk cache I/O, image decode/adapt) through the executor, and shaping
results for the WS/HTTP wire.
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import time
from dataclasses import replace
from functools import partial
from pathlib import Path
from typing import Any, Callable, Mapping

import voluptuous as vol
from aiohttp import web
from homeassistant.components import websocket_api
from homeassistant.components.http import HomeAssistantView
from homeassistant.core import HomeAssistant
from homeassistant.helpers import aiohttp_client

from .. import adapt
from ..const import DISPLAY_HEIGHT, DISPLAY_WIDTH, DOMAIN
from ..designs import DesignValidationError
from ..importers import DecodeError as ImportDecodeError
from ..importers import gif as gif_importer
from ..importers import load_by_filename
from ..store import async_get_design_library
from . import awtrix, coolledx, coolledx_anim, divoom, lametric
from .cache import DiskLRUCache
from .models import (
    GalleryItem, SourceDecodeError, SourceError, SourceInfo, SourceNotFound,
    SourceRequestError, SourceTimeout, SourceUnavailable,
)

_LOGGER = logging.getLogger(__name__)

#: docs/GALLERY.md: "Disk cache under `<config>/.storage/iledclock_gallery/`".
CACHE_DIR_NAME = "iledclock_gallery"
#: docs/GALLERY.md: "Max upload 8 MB".
MAX_UPLOAD_BYTES = 8 * 1024 * 1024
#: Media bytes (the actual image data) change far less often than a listing page; a
#: week-long cache is generous but safe -- `iledclock/gallery/import` always fetches
#: fresh-enough data because the WS `search` -> `preview`/`import` flow happens within one
#: browsing session, well inside any TTL that would matter here.
CACHE_TTL_MEDIA_S = 7 * 24 * 60 * 60

MEDIA_CONCURRENCY_PER_SOURCE = 4
NEGATIVE_DECODE_CACHE_TTL_S = 5 * 60
MEDIA_REQUEST_TIMEOUT_S = 12

_SOURCE_MODULES: dict[str, Any] = {
    "iledclock": coolledx, "iledclock_anim": coolledx_anim,
    "lametric": lametric, "awtrix": awtrix, "divoom": divoom,
}

#: Only Divoom's pixel-bean decoder needs these (AES, LZO, zstd formats). They are NOT manifest
#: requirements: a package that fails to install on the host would stop the whole integration -
#: clock control included - from loading. HA installs them the first time Divoom media is fetched,
#: and a failure there only makes the Divoom source unavailable.
DIVOOM_REQUIREMENTS = ["pycryptodome", "lzallright", "zstandard"]


async def _ensure_divoom_requirements(hass: HomeAssistant) -> None:
    from homeassistant.requirements import RequirementsNotFound, async_process_requirements

    try:
        await async_process_requirements(hass, f"{DOMAIN}.divoom", DIVOOM_REQUIREMENTS)
    except RequirementsNotFound as err:
        raise SourceUnavailable(f"Divoom decoder packages could not be installed: {err}") from err


class GalleryCommandError(Exception):
    """Raised by the shared helpers below; every WS handler catches this (plus
    `SourceError`/`ImportDecodeError`/`adapt.AdaptError`) and maps it to a WS error."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


# ============================================================================
# Shared state: cache instance, Divoom account resolution, source dispatch
# ============================================================================
def _cache(hass: HomeAssistant) -> DiskLRUCache:
    domain_data = hass.data.setdefault(DOMAIN, {})
    cache = domain_data.get("gallery_cache")
    if cache is None:
        cache = DiskLRUCache(Path(hass.config.path(".storage", CACHE_DIR_NAME)))
        domain_data["gallery_cache"] = cache
    return cache


def _require_entry(hass: HomeAssistant, entry_id: str):
    entry = hass.config_entries.async_get_entry(entry_id)
    if entry is None or entry.domain != DOMAIN:
        raise GalleryCommandError("unknown_entry", f"{entry_id!r} is not an iLedClock config entry")
    return entry


def _divoom_account(hass: HomeAssistant, entry_id: str) -> "divoom.DivoomAccount | None":
    """docs/GALLERY.md: "any `entry_id` of the integration is accepted for account
    lookup" -- credentials are configured once (via one config entry's options flow) but
    not necessarily the same entry the caller is currently browsing from, so this checks
    every loaded iledclock entry, not just the one named, as long as `entry_id` itself
    names a real entry."""
    entry = _require_entry(hass, entry_id)
    for candidate in (entry, *hass.config_entries.async_entries(DOMAIN)):
        email = candidate.options.get("divoom_email")
        password_md5 = candidate.options.get("divoom_password_md5")
        if email and password_md5:
            return divoom.DivoomAccount(email=email, password_md5=password_md5)
    return None


async def _cached_vendor_catalog(
    hass: HomeAssistant,
    key: str,
    ttl_s: float,
    *,
    decode: Callable[[bytes], Any],
    encode: Callable[[Any], Any],
    fetch: Callable[[], Any],
) -> Any:
    """Serve stale catalogs immediately and refresh them once in the background."""
    domain_data = hass.data.setdefault(DOMAIN, {})
    cache = _cache(hass)

    async def read_cached() -> tuple[Any | None, float | None]:
        entry = await hass.async_add_executor_job(partial(cache.get, key, ttl_s=None))
        if entry is None:
            return None, None
        try:
            return decode(entry.data), time.time() - entry.stored_at
        except Exception:
            _LOGGER.debug("Ignoring invalid cached gallery catalog %s", key, exc_info=True)
            return None, None

    async def refresh() -> Any:
        locks = domain_data.setdefault("gallery_catalog_locks", {})
        lock = locks.setdefault(key, asyncio.Lock())
        async with lock:
            current, age = await read_cached()
            if current is not None and age is not None and age <= ttl_s:
                return current
            result = await fetch()
            payload = json.dumps(encode(result), ensure_ascii=False, separators=(",", ":")).encode("utf-8")
            await hass.async_add_executor_job(
                partial(cache.put, key, payload, content_type="application/json")
            )
            return result

    cached, age = await read_cached()
    if cached is not None:
        if age is not None and age > ttl_s:
            tasks = domain_data.setdefault("gallery_catalog_refresh_tasks", {})
            task = tasks.get(key)
            if task is None or task.done():
                async def revalidate() -> None:
                    try:
                        await refresh()
                    except Exception:
                        _LOGGER.debug("Could not refresh gallery catalog %s", key, exc_info=True)

                task = hass.async_create_task(revalidate())
                tasks[key] = task
                task.add_done_callback(
                    lambda done: tasks.pop(key, None) if tasks.get(key) is done else None
                )
        return cached
    return await refresh()


def _encode_coolledx_categories(categories: Any) -> list[dict[str, str]]:
    return [{"id": item.id, "label": item.label, "url": item.url} for item in categories]


def _decode_coolledx_categories(payload: bytes) -> tuple[coolledx.Category, ...]:
    value = json.loads(payload)
    if not isinstance(value, list):
        raise ValueError("cached category list is not an array")
    return tuple(
        coolledx.Category(id=item["id"], label=item["label"], url=item["url"])
        for item in value if isinstance(item, dict)
    )


async def _coolledx_categories(
    hass: HomeAssistant, *, language: str | None = None
) -> tuple[coolledx.Category, ...]:
    resolved_language = coolledx.normalize_language(language or getattr(hass.config, "language", "en"))
    rows, cols = DISPLAY_HEIGHT, DISPLAY_WIDTH
    key = f"iledclock:categories:{rows}x{cols}:{resolved_language}"
    session = aiohttp_client.async_get_clientsession(hass)
    return await _cached_vendor_catalog(
        hass, key, coolledx.CACHE_TTL_CATALOG_S,
        decode=_decode_coolledx_categories, encode=_encode_coolledx_categories,
        fetch=lambda: coolledx.fetch_categories(
            session, language=resolved_language, rows=rows, cols=cols
        ),
    )


async def _available_coolledx_categories(hass: HomeAssistant) -> tuple[coolledx.Category, ...]:
    """Return disk-cached labels immediately and refresh missing/stale labels in the background."""
    language = coolledx.normalize_language(getattr(hass.config, "language", "en"))
    key = f"iledclock:categories:{DISPLAY_HEIGHT}x{DISPLAY_WIDTH}:{language}"
    cache = _cache(hass)
    entry = await hass.async_add_executor_job(partial(cache.get, key, ttl_s=None))
    categories: tuple[coolledx.Category, ...] = ()
    if entry is not None:
        try:
            categories = _decode_coolledx_categories(entry.data)
        except Exception:
            _LOGGER.debug("Ignoring invalid cached gallery categories %s", key, exc_info=True)

    if entry is None or time.time() - entry.stored_at > coolledx.CACHE_TTL_CATALOG_S:
        domain_data = hass.data.setdefault(DOMAIN, {})
        tasks = domain_data.setdefault("gallery_categories_refresh_tasks", {})
        task = tasks.get(key)
        if task is None or task.done():
            async def refresh() -> None:
                try:
                    await _coolledx_categories(hass, language=language)
                except Exception:
                    _LOGGER.debug("Could not refresh iLedClock categories %s", key, exc_info=True)

            task = hass.async_create_task(refresh())
            tasks[key] = task
            task.add_done_callback(
                lambda done: tasks.pop(key, None) if tasks.get(key) is done else None
            )
    return categories


async def _coolledx_catalog(hass: HomeAssistant) -> coolledx.Catalog:
    language = coolledx.normalize_language(getattr(hass.config, "language", "en"))
    rows, cols = DISPLAY_HEIGHT, DISPLAY_WIDTH
    categories = await _coolledx_categories(hass, language=language)
    session = aiohttp_client.async_get_clientsession(hass)
    key = f"iledclock:catalog:{rows}x{cols}:{language}"
    return await _cached_vendor_catalog(
        hass, key, coolledx.CACHE_TTL_CATALOG_S,
        decode=coolledx.catalog_from_json, encode=coolledx.catalog_to_json,
        fetch=lambda: coolledx.fetch_catalog(
            session, language=language, rows=rows, cols=cols, categories=categories
        ),
    )


async def _cached_coolledx_frames(
    hass: HomeAssistant, items: tuple[GalleryItem, ...]
) -> dict[str, int]:
    """Return frame counts already learned by successful CoolLEDX media decodes."""
    if not items:
        return {}
    cache = _cache(hass)

    def read_counts() -> dict[str, int]:
        counts: dict[str, int] = {}
        for item in items:
            entry = cache.get(f"frames:iledclock:{item.id}", ttl_s=None)
            if entry is None:
                continue
            try:
                count = int(entry.data)
            except (TypeError, ValueError):
                continue
            if count > 0:
                counts[item.id] = count
        return counts

    return await hass.async_add_executor_job(read_counts)


def _with_coolledx_frame_counts(
    items: tuple[GalleryItem, ...], counts: Mapping[str, int]
) -> tuple[GalleryItem, ...]:
    return tuple(
        replace(item, frames=frames, animated=frames > 1)
        if (frames := counts.get(item.id)) is not None else item
        for item in items
    )


async def _coolledx_anim_catalog(hass: HomeAssistant) -> coolledx_anim.Catalog:
    session = aiohttp_client.async_get_clientsession(hass)
    return await _cached_vendor_catalog(
        hass, "iledclock_anim:catalog", coolledx_anim.CACHE_TTL_CATALOG_S,
        decode=coolledx_anim.catalog_from_json, encode=coolledx_anim.catalog_to_json,
        fetch=lambda: coolledx_anim.fetch_catalog(session),
    )


async def _source_infos(hass: HomeAssistant, entry_id: str) -> list[SourceInfo]:
    _require_entry(hass, entry_id)
    categories = await _available_coolledx_categories(hass)
    return [
        coolledx.source_info(categories=categories),
        coolledx_anim.source_info(),
        lametric.source_info(),
        awtrix.source_info(),
        divoom.source_info(configured=_divoom_account(hass, entry_id) is not None),
    ]


async def _lametric_catalog(
    hass: HomeAssistant, *, order: str = lametric.DEFAULT_SORT
) -> list[GalleryItem]:
    session = aiohttp_client.async_get_clientsession(hass)
    return await _cached_vendor_catalog(
        hass,
        f"lametric:catalog:{order}",
        lametric.CACHE_TTL_CATALOG_S,
        decode=lambda payload: [GalleryItem(**row) for row in json.loads(payload)],
        encode=lambda items: [item.to_json() for item in items],
        fetch=lambda: lametric.fetch_catalog(session, order=order),
    )


async def async_search(
    hass: HomeAssistant, entry_id: str, *, source: str, sort: str | None, page: int,
    query: str | None, size: str | None, animated_only: bool, category: str | None = None,
) -> tuple[list[GalleryItem], bool]:
    module = _SOURCE_MODULES.get(source)
    if module is None:
        raise GalleryCommandError("unknown_source", f"unknown gallery source {source!r}")
    resolved_sort = sort or module.DEFAULT_SORT
    session = aiohttp_client.async_get_clientsession(hass)

    if source == "iledclock":
        catalog = await _coolledx_catalog(hass)
        if animated_only:
            counts = await _cached_coolledx_frames(hass, catalog.items)
            catalog = replace(catalog, items=_with_coolledx_frame_counts(catalog.items, counts))
        page_result = coolledx.search(
            catalog, sort=resolved_sort, page=page, query=query, size=size,
            animated_only=animated_only, category=category,
        )
    elif source == "iledclock_anim":
        catalog = await _coolledx_anim_catalog(hass)
        page_result = coolledx_anim.search(
            catalog, sort=resolved_sort, page=page, query=query, size=size,
            animated_only=animated_only, category=category,
            language=hass.config.language,
        )
    elif source == "lametric":
        catalog = await _lametric_catalog(hass, order=resolved_sort)
        page_result = lametric.search(
            catalog, sort=resolved_sort, page=page, query=query, size=size, animated_only=animated_only
        )
    elif source == "awtrix":
        page_result = await awtrix.search(
            session, sort=resolved_sort, page=page, query=query, size=size, animated_only=animated_only
        )
    else:  # divoom
        account = _divoom_account(hass, entry_id)
        if account is None:
            raise SourceUnavailable("Divoom is not configured for this integration (add an account in options)")
        page_result = await divoom.search(
            session, account, sort=resolved_sort, page=page, query=query, size=size, animated_only=animated_only
        )

    result_items = page_result.items
    if source == "iledclock" and not animated_only:
        counts = await _cached_coolledx_frames(hass, result_items)
        result_items = _with_coolledx_frame_counts(result_items, counts)
    items = [
        item.with_media_path(f"/api/iledclock/gallery/media/{source}/{item.id}?entry_id={entry_id}")
        for item in result_items
    ]
    return items, page_result.has_more


async def async_fetch_media(
    hass: HomeAssistant, entry_id: str, *, source: str, item_id: str
) -> tuple[bytes, str]:
    """Fetch displayable media once per source/item, caching only successful payloads."""

    _require_entry(hass, entry_id)
    module = _SOURCE_MODULES.get(source)
    if module is None:
        raise GalleryCommandError("unknown_source", f"unknown gallery source {source!r}")

    cache = _cache(hass)
    cache_key = f"media:{source}:{item_id}"
    negative_key = f"decode-failed:{cache_key}"
    ttl_s = getattr(module, "CACHE_TTL_MEDIA_S", CACHE_TTL_MEDIA_S)

    async def cached_media():
        return await hass.async_add_executor_job(partial(cache.get, cache_key, ttl_s=ttl_s))

    async def raise_if_recently_invalid() -> None:
        failed = await hass.async_add_executor_job(
            partial(cache.get, negative_key, ttl_s=NEGATIVE_DECODE_CACHE_TTL_S)
        )
        if failed is not None:
            raise SourceDecodeError("This gallery item failed media decoding recently")

    cached = await cached_media()
    if cached is not None:
        return cached.data, cached.content_type
    await raise_if_recently_invalid()

    domain_data = hass.data.setdefault(DOMAIN, {})
    semaphores = domain_data.setdefault("gallery_media_semaphores", {})
    semaphore = semaphores.setdefault(
        source, asyncio.Semaphore(MEDIA_CONCURRENCY_PER_SOURCE)
    )
    async with semaphore:
        cached = await cached_media()
        if cached is not None:
            return cached.data, cached.content_type
        await raise_if_recently_invalid()

        session = aiohttp_client.async_get_clientsession(hass)
        try:
            if source == "iledclock":
                catalog = await _coolledx_catalog(hass)
                media = await coolledx.fetch_media(session, catalog, item_id)
                frames = await hass.async_add_executor_job(coolledx.frame_count, media.data)
                await hass.async_add_executor_job(
                    partial(
                        cache.put,
                        f"frames:iledclock:{item_id}",
                        str(frames).encode("utf-8"),
                        content_type="text/plain",
                    )
                )
            elif source == "iledclock_anim":
                catalog = await _coolledx_anim_catalog(hass)
                media = await hass.async_add_executor_job(
                    coolledx_anim.render_media, catalog, item_id
                )
            elif source == "lametric":
                catalog = await _lametric_catalog(hass)
                media = await lametric.fetch_media(session, catalog, item_id)
            elif source == "awtrix":
                media = await awtrix.fetch_media(session, item_id)
            else:  # divoom
                account = _divoom_account(hass, entry_id)
                if account is None:
                    raise SourceUnavailable(
                        "Divoom is not configured for this integration (add an account in options)"
                    )
                await _ensure_divoom_requirements(hass)
                media = await divoom.fetch_media(
                    session, account, item_id, decode_executor=hass.async_add_executor_job
                )
        except SourceDecodeError:
            await hass.async_add_executor_job(
                partial(cache.put, negative_key, b"1", content_type="text/plain")
            )
            raise

        await hass.async_add_executor_job(
            partial(cache.put, cache_key, media.data, content_type=media.content_type)
        )
        return media.data, media.content_type


async def async_item_credit(hass: HomeAssistant, entry_id: str, *, source: str, item_id: str) -> dict[str, Any]:
    """`{title, author, url}` for the "credit + link to the original" the item sheet and
    `origin` (docs/GALLERY.md `gallery/import`) both need. One extra request per item --
    acceptable here (a single item, not a listing page), unlike `search()`'s politeness
    budget."""
    if source == "iledclock":
        catalog = await _coolledx_catalog(hass)
        item = coolledx.find_item(catalog, item_id)
        if item is None:
            raise SourceRequestError(f"iLedClock material {item_id!r} not found in cached catalog")
        return {"title": item.title, "author": None, "url": None}
    if source == "iledclock_anim":
        catalog = await _coolledx_anim_catalog(hass)
        record = next((entry for entry in catalog.entries if entry.item.id == item_id), None)
        if record is None:
            raise SourceRequestError(f"iLedClock animation {item_id!r} not found in cached catalog")
        return {"title": record.item.title, "author": None, "url": None}
    if source == "lametric":
        catalog = await _lametric_catalog(hass)
        item = lametric.find_item(catalog, item_id)
        if item is None:
            raise SourceRequestError(f"LaMetric icon {item_id!r} not found in cached catalog")
        return {"title": item.title, "author": None, "url": None}
    if source == "awtrix":
        session = aiohttp_client.async_get_clientsession(hass)
        detail = await awtrix.fetch_detail(session, item_id)
        return {
            "title": detail.get("title") or item_id,
            "author": detail.get("author"),
            "url": f"{awtrix.BASE_URL}/{item_id}",
        }
    if source == "divoom":
        account = _divoom_account(hass, entry_id)
        if account is None:
            raise SourceUnavailable("Divoom is not configured for this integration (add an account in options)")
        session = aiohttp_client.async_get_clientsession(hass)
        info = await divoom.fetch_artwork_info(session, account, item_id)
        return {
            "title": info.get("FileName") or f"Divoom #{item_id}",
            "author": info.get("NickName") or info.get("UserName"),
            "url": None,
        }
    raise GalleryCommandError("unknown_source", f"unknown gallery source {source!r}")


async def async_preview(
    hass: HomeAssistant, entry_id: str, *, source: str, item_id: str, options: Mapping[str, Any] | None
) -> adapt.Adapted:
    data, _content_type = await async_fetch_media(hass, entry_id, source=source, item_id=item_id)
    decoded = await hass.async_add_executor_job(gif_importer.load, data)
    return await hass.async_add_executor_job(adapt.adapt, decoded.frames, decoded.delays_ms, options)


def _adapted_to_json(adapted: adapt.Adapted) -> dict[str, Any]:
    """Contract `iledclock/gallery/preview` result shape."""
    return {
        "frames": [base64.b64encode(frame).decode("ascii") for frame in adapted.frames],
        "delays_ms": list(adapted.delays_ms),
        "layout": adapted.layout,
        "layouts_available": list(adapted.layouts_available),
        "report": adapted.report,
    }


async def _async_save_adapted(
    hass: HomeAssistant, adapted: adapt.Adapted, *, name: str, origin: dict[str, Any] | None
) -> str:
    kind = "animation" if len(adapted.frames) > 1 else "image"
    raw: dict[str, Any] = {
        "name": name,
        "kind": kind,
        "frames": [base64.b64encode(frame).decode("ascii") for frame in adapted.frames],
    }
    if kind == "animation":
        raw["delays"] = list(adapted.delays_ms)
    if origin is not None:
        raw["origin"] = origin
    if adapted.report.get("native_region"):
        # "Icon with clock": keep the reserved area so the upload adds the live firmware clock.
        raw["clock_region"] = adapted.report["native_region"]
    library = async_get_design_library(hass)
    await library.async_load()
    try:
        design = await library.async_save_design(raw)
    except DesignValidationError as err:
        raise GalleryCommandError("invalid_design", str(err)) from err
    return design.id


# ============================================================================
# WebSocket API
# ============================================================================
def _send_command_error(connection: websocket_api.ActiveConnection, msg_id: int, err: Exception) -> None:
    if isinstance(err, GalleryCommandError):
        connection.send_error(msg_id, err.code, str(err))
    elif isinstance(err, SourceUnavailable):
        connection.send_error(msg_id, "source_unavailable", str(err))
    elif isinstance(err, SourceError):
        connection.send_error(msg_id, "source_error", str(err))
    elif isinstance(err, ImportDecodeError):
        connection.send_error(msg_id, "decode_error", str(err))
    elif isinstance(err, adapt.AdaptError):
        connection.send_error(msg_id, "adapt_error", str(err))
    else:  # pragma: no cover - defensive: isolate a source's failure from the rest of HA
        _LOGGER.exception("Unexpected gallery error")
        connection.send_error(msg_id, "unknown_error", str(err))


@websocket_api.websocket_command(
    {vol.Required("type"): "iledclock/gallery/sources", vol.Required("entry_id"): str}
)
@websocket_api.async_response
async def ws_gallery_sources(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict) -> None:
    try:
        infos = await _source_infos(hass, msg["entry_id"])
    except GalleryCommandError as err:
        _send_command_error(connection, msg["id"], err)
        return
    connection.send_result(msg["id"], [info.to_json() for info in infos])


async def async_shelves(hass: HomeAssistant, entry_id: str) -> list[dict[str, str]]:
    """Return the independent shelf plan used by Pixel Studio’s For-you view."""
    _require_entry(hass, entry_id)
    categories = await _available_coolledx_categories(hass)
    labels = {category.id: category.label for category in categories}
    featured_categories = (
        ("trending", "Trending"),
        ("creative", "Creative"),
        ("emoji", "Emoji"),
        ("festival", "Festival"),
    )
    shelves = [
        {
            "id": f"iledclock-{category}",
            "title": f"iLedClock originals · {labels.get(category, fallback)}",
            "source": "iledclock",
            "category": category,
            "sort": coolledx.DEFAULT_SORT,
        }
        for category, fallback in featured_categories
    ]
    shelves.extend((
        {"id": "iledclock-animations", "title": "Animations", "source": "iledclock_anim"},
        {"id": "lametric-popular", "title": "LaMetric popular", "source": "lametric", "sort": "popular"},
        {"id": "awtrix-new", "title": "AWTRIX new", "source": "awtrix", "sort": "newest"},
    ))
    if _divoom_account(hass, entry_id) is not None:
        shelves.append({
            "id": "divoom-trending", "title": "Divoom trending",
            "source": "divoom", "sort": divoom.DEFAULT_SORT,
        })
    return shelves


@websocket_api.websocket_command(
    {vol.Required("type"): "iledclock/gallery/shelves", vol.Required("entry_id"): str}
)
@websocket_api.async_response
async def ws_gallery_shelves(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict) -> None:
    try:
        shelves = await async_shelves(hass, msg["entry_id"])
    except (GalleryCommandError, SourceError) as err:
        _send_command_error(connection, msg["id"], err)
        return
    connection.send_result(msg["id"], shelves)


@websocket_api.websocket_command(
    {
        vol.Required("type"): "iledclock/gallery/search",
        vol.Required("entry_id"): str,
        vol.Required("source"): str,
        vol.Optional("sort"): str,
        vol.Optional("page", default=1): vol.All(int, vol.Range(min=1)),
        vol.Optional("query"): str,
        vol.Optional("size"): str,
        vol.Optional("category"): str,
        vol.Optional("animated_only", default=False): bool,
    }
)
@websocket_api.async_response
async def ws_gallery_search(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict) -> None:
    try:
        items, has_more = await async_search(
            hass, msg["entry_id"], source=msg["source"], sort=msg.get("sort"), page=msg["page"],
            query=msg.get("query"), size=msg.get("size"),
            animated_only=msg["animated_only"], category=msg.get("category"),
        )
    except (GalleryCommandError, SourceError) as err:
        _send_command_error(connection, msg["id"], err)
        return
    connection.send_result(
        msg["id"], {"items": [item.to_json() for item in items], "page": msg["page"], "has_more": has_more}
    )


@websocket_api.websocket_command(
    {
        vol.Required("type"): "iledclock/gallery/preview",
        vol.Required("entry_id"): str,
        vol.Required("source"): str,
        vol.Required("item_id"): str,
        vol.Optional("options"): dict,
    }
)
@websocket_api.async_response
async def ws_gallery_preview(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict) -> None:
    try:
        adapted = await async_preview(
            hass, msg["entry_id"], source=msg["source"], item_id=msg["item_id"], options=msg.get("options")
        )
    except (GalleryCommandError, SourceError, ImportDecodeError, adapt.AdaptError) as err:
        _send_command_error(connection, msg["id"], err)
        return
    connection.send_result(msg["id"], _adapted_to_json(adapted))


@websocket_api.websocket_command(
    {
        vol.Required("type"): "iledclock/gallery/import",
        vol.Required("entry_id"): str,
        vol.Required("source"): str,
        vol.Required("item_id"): str,
        vol.Optional("options"): dict,
        vol.Optional("name"): str,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_gallery_import(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict) -> None:
    try:
        adapted = await async_preview(
            hass, msg["entry_id"], source=msg["source"], item_id=msg["item_id"], options=msg.get("options")
        )
        credit = await async_item_credit(hass, msg["entry_id"], source=msg["source"], item_id=msg["item_id"])
    except (GalleryCommandError, SourceError, ImportDecodeError, adapt.AdaptError) as err:
        _send_command_error(connection, msg["id"], err)
        return

    # `msg["id"]` is HA's own websocket *message* id (an int every request carries), never a
    # gallery item -- the source item id this command was given is `item_id`, and that is what
    # both the fallback name and the design's `origin.id` credit field must carry.
    name = msg.get("name") or credit.get("title") or f"{msg['source']}:{msg['item_id']}"
    origin = {
        "source": msg["source"], "id": msg["item_id"],
        "title": credit.get("title"), "author": credit.get("author"), "url": credit.get("url"),
    }
    try:
        design_id = await _async_save_adapted(hass, adapted, name=name, origin=origin)
    except GalleryCommandError as err:
        _send_command_error(connection, msg["id"], err)
        return
    connection.send_result(msg["id"], {"design_id": design_id})


@websocket_api.websocket_command(
    {
        vol.Required("type"): "iledclock/import/file",
        vol.Required("entry_id"): str,
        vol.Required("filename"): str,
        vol.Required("data_b64"): str,
        vol.Optional("options"): dict,
        vol.Optional("save", default=False): bool,
        vol.Optional("name"): str,
    }
)
@websocket_api.async_response
async def ws_import_file(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict) -> None:
    """docs/GALLERY.md: "(admin when save)" -- unlike `gallery/import`, this command is
    usable by a non-admin user for a preview (`save` omitted/false), so the admin check is
    conditional here rather than the blanket `@websocket_api.require_admin` decorator."""
    if msg["save"] and not connection.user.is_admin:
        connection.send_error(msg["id"], "unauthorized", "admin is required to save an imported file")
        return

    try:
        data = base64.b64decode(msg["data_b64"], validate=True)
    except (ValueError, TypeError) as err:
        connection.send_error(msg["id"], "invalid_format", f"data_b64 is not valid base64: {err}")
        return
    if len(data) > MAX_UPLOAD_BYTES:
        connection.send_error(msg["id"], "too_large", f"upload exceeds {MAX_UPLOAD_BYTES} bytes")
        return

    try:
        decoded = await hass.async_add_executor_job(load_by_filename, msg["filename"], data)
        adapted = await hass.async_add_executor_job(adapt.adapt, decoded.frames, decoded.delays_ms, msg.get("options"))
    except (ImportDecodeError, adapt.AdaptError) as err:
        _send_command_error(connection, msg["id"], err)
        return

    if not msg["save"]:
        connection.send_result(msg["id"], _adapted_to_json(adapted))
        return

    name = msg.get("name") or msg["filename"]
    try:
        design_id = await _async_save_adapted(hass, adapted, name=name, origin=None)
    except GalleryCommandError as err:
        _send_command_error(connection, msg["id"], err)
        return
    connection.send_result(msg["id"], {"design_id": design_id})


# ============================================================================
# HTTP media proxy view
# ============================================================================
class GalleryMediaView(HomeAssistantView):
    """docs/GALLERY.md: authenticated proxy+cache for each source's media, so the browser
    (including the iOS app, with no CORS) never talks to LaMetric/AWTRIX/Divoom directly.
    The frontend signs URLs via WS `auth/sign_path` (standard HA mechanism -- this view
    needs no special support for that beyond the default `requires_auth = True`)."""

    url = "/api/iledclock/gallery/media/{source}/{item_id:.+}"
    name = "api:iledclock:gallery:media"

    def __init__(self, hass: HomeAssistant) -> None:
        self._hass = hass

    async def get(self, request: web.Request, source: str, item_id: str) -> web.Response:
        entry_id = request.query.get("entry_id")
        if not entry_id:
            return web.Response(status=400, text="entry_id query parameter is required")
        try:
            async with asyncio.timeout(MEDIA_REQUEST_TIMEOUT_S):
                data, content_type = await async_fetch_media(
                    self._hass, entry_id, source=source, item_id=item_id
                )
        except GalleryCommandError as err:
            status = 404 if err.code == "unknown_entry" else 400
            return web.Response(status=status, text=str(err))
        except SourceUnavailable as err:
            return web.Response(status=409, text=str(err))
        except SourceNotFound as err:
            return web.Response(status=404, text=str(err))
        except SourceTimeout as err:
            return web.Response(status=504, text=str(err))
        except TimeoutError:
            return web.Response(status=504, text="gallery media request timed out")
        except SourceError as err:
            return web.Response(status=502, text=str(err))
        return web.Response(
            body=data, content_type=content_type, headers={"Cache-Control": "public, max-age=86400"}
        )


# ============================================================================
# Setup
# ============================================================================
async def async_setup_gallery(hass: HomeAssistant) -> None:
    """Called once from `custom_components/iledclock/__init__.py`'s `async_setup`.
    Idempotent, matching `websocket_api.py`'s `async_setup_websocket_api` guard pattern
    (registering the same WS command id twice raises, and HA has no documented way to
    check for an already-registered command or view)."""
    domain_data = hass.data.setdefault(DOMAIN, {})
    if domain_data.get("gallery_registered"):
        return
    domain_data["gallery_registered"] = True

    websocket_api.async_register_command(hass, ws_gallery_shelves)
    websocket_api.async_register_command(hass, ws_gallery_sources)
    websocket_api.async_register_command(hass, ws_gallery_search)
    websocket_api.async_register_command(hass, ws_gallery_preview)
    websocket_api.async_register_command(hass, ws_gallery_import)
    websocket_api.async_register_command(hass, ws_import_file)

    hass.http.register_view(GalleryMediaView(hass))
