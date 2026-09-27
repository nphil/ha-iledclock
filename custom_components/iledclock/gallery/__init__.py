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

import base64
import json
import logging
from functools import partial
from pathlib import Path
from typing import Any, Mapping

import voluptuous as vol
from aiohttp import web
from homeassistant.components import websocket_api
from homeassistant.components.http import HomeAssistantView
from homeassistant.core import HomeAssistant
from homeassistant.helpers import aiohttp_client

from .. import adapt
from ..const import DOMAIN
from ..designs import DesignValidationError
from ..importers import DecodeError as ImportDecodeError
from ..importers import gif as gif_importer
from ..importers import load_by_filename
from ..store import async_get_design_library
from . import awtrix, divoom, lametric
from .cache import DiskLRUCache
from .models import GalleryItem, SourceError, SourceInfo, SourceRequestError, SourceUnavailable

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

_SOURCE_MODULES: dict[str, Any] = {"lametric": lametric, "awtrix": awtrix, "divoom": divoom}

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


def _source_infos(hass: HomeAssistant, entry_id: str) -> list[SourceInfo]:
    _require_entry(hass, entry_id)
    return [
        lametric.source_info(),
        awtrix.source_info(),
        divoom.source_info(configured=_divoom_account(hass, entry_id) is not None),
    ]


async def _lametric_catalog(hass: HomeAssistant) -> list[GalleryItem]:
    cache = _cache(hass)
    entry = await hass.async_add_executor_job(partial(cache.get, "lametric:catalog", ttl_s=lametric.CACHE_TTL_CATALOG_S))
    if entry is not None:
        try:
            rows = json.loads(entry.data.decode("utf-8"))
            return [GalleryItem(**row) for row in rows]
        except (ValueError, TypeError, KeyError) as err:
            _LOGGER.debug("Discarding corrupt LaMetric catalog cache entry: %s", err)
    session = aiohttp_client.async_get_clientsession(hass)
    catalog = await lametric.fetch_catalog(session)
    payload = json.dumps([item.to_json() for item in catalog]).encode("utf-8")
    await hass.async_add_executor_job(partial(cache.put, "lametric:catalog", payload, content_type="application/json"))
    return catalog


async def async_search(
    hass: HomeAssistant, entry_id: str, *, source: str, sort: str | None, page: int,
    query: str | None, size: str | None, animated_only: bool,
) -> tuple[list[GalleryItem], bool]:
    module = _SOURCE_MODULES.get(source)
    if module is None:
        raise GalleryCommandError("unknown_source", f"unknown gallery source {source!r}")
    resolved_sort = sort or module.DEFAULT_SORT
    session = aiohttp_client.async_get_clientsession(hass)

    if source == "lametric":
        catalog = await _lametric_catalog(hass)
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

    items = [
        item.with_media_path(f"/api/iledclock/gallery/media/{source}/{item.id}?entry_id={entry_id}")
        for item in page_result.items
    ]
    return items, page_result.has_more


async def async_fetch_media(
    hass: HomeAssistant, entry_id: str, *, source: str, item_id: str
) -> tuple[bytes, str]:
    """Fetch (or serve from cache) one item's *displayable* media bytes: the source's own
    original bytes for LaMetric/AWTRIX, or the already-decoded GIF for Divoom (docs/
    GALLERY.md: "proxies + caches original media (and Divoom-decoded GIFs)")."""
    if source not in _SOURCE_MODULES:
        raise GalleryCommandError("unknown_source", f"unknown gallery source {source!r}")

    cache = _cache(hass)
    cache_key = f"media:{source}:{item_id}"
    cached = await hass.async_add_executor_job(partial(cache.get, cache_key, ttl_s=CACHE_TTL_MEDIA_S))
    if cached is not None:
        return cached.data, cached.content_type

    session = aiohttp_client.async_get_clientsession(hass)
    if source == "lametric":
        catalog = await _lametric_catalog(hass)
        media = await lametric.fetch_media(session, catalog, item_id)
    elif source == "awtrix":
        media = await awtrix.fetch_media(session, item_id)
    else:  # divoom
        account = _divoom_account(hass, entry_id)
        if account is None:
            raise SourceUnavailable("Divoom is not configured for this integration (add an account in options)")
        await _ensure_divoom_requirements(hass)
        media = await divoom.fetch_media(session, account, item_id)

    await hass.async_add_executor_job(partial(cache.put, cache_key, media.data, content_type=media.content_type))
    return media.data, media.content_type


async def async_item_credit(hass: HomeAssistant, entry_id: str, *, source: str, item_id: str) -> dict[str, Any]:
    """`{title, author, url}` for the "credit + link to the original" the item sheet and
    `origin` (docs/GALLERY.md `gallery/import`) both need. One extra request per item --
    acceptable here (a single item, not a listing page), unlike `search()`'s politeness
    budget."""
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
        infos = _source_infos(hass, msg["entry_id"])
    except GalleryCommandError as err:
        _send_command_error(connection, msg["id"], err)
        return
    connection.send_result(msg["id"], [info.to_json() for info in infos])


@websocket_api.websocket_command(
    {
        vol.Required("type"): "iledclock/gallery/search",
        vol.Required("entry_id"): str,
        vol.Required("source"): str,
        vol.Optional("sort"): str,
        vol.Optional("page", default=1): vol.All(int, vol.Range(min=1)),
        vol.Optional("query"): str,
        vol.Optional("size"): str,
        vol.Optional("animated_only", default=False): bool,
    }
)
@websocket_api.async_response
async def ws_gallery_search(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict) -> None:
    try:
        items, has_more = await async_search(
            hass, msg["entry_id"], source=msg["source"], sort=msg.get("sort"), page=msg["page"],
            query=msg.get("query"), size=msg.get("size"), animated_only=msg["animated_only"],
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

    url = "/api/iledclock/gallery/media/{source}/{item_id}"
    name = "api:iledclock:gallery:media"

    def __init__(self, hass: HomeAssistant) -> None:
        self._hass = hass

    async def get(self, request: web.Request, source: str, item_id: str) -> web.Response:
        entry_id = request.query.get("entry_id")
        if not entry_id:
            return web.Response(status=400, text="entry_id query parameter is required")
        try:
            data, content_type = await async_fetch_media(self._hass, entry_id, source=source, item_id=item_id)
        except GalleryCommandError as err:
            status = 404 if err.code == "unknown_entry" else 400
            return web.Response(status=status, text=str(err))
        except SourceUnavailable as err:
            return web.Response(status=409, text=str(err))
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

    websocket_api.async_register_command(hass, ws_gallery_sources)
    websocket_api.async_register_command(hass, ws_gallery_search)
    websocket_api.async_register_command(hass, ws_gallery_preview)
    websocket_api.async_register_command(hass, ws_gallery_import)
    websocket_api.async_register_command(hass, ws_import_file)

    hass.http.register_view(GalleryMediaView(hass))
