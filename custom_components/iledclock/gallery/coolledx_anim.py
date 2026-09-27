"""Decode the iLedClock app's versioned 32x16 static/dynamic animation feeds."""
from __future__ import annotations

import asyncio
import base64
import json
import re
from dataclasses import dataclass, replace
from io import BytesIO
from pathlib import Path
from typing import Any, Mapping

import aiohttp
from PIL import Image

from .coolledx import is_vendor_url
from .models import (
    CategoryInfo,
    GalleryItem,
    SearchPage,
    SortOption,
    SourceInfo,
    SourceDecodeError,
    SourceNotFound,
    SourceMedia,
    SourceRequestError,
    SourceTimeout,
)

ID = "iledclock_anim"
NAME = "Animations"
BASE_URL = "https://coolledx.com/appDownload/CoolLED1248/animation_update_data/1632"
HOMEPAGE = BASE_URL
KINDS = ("static", "dynamic")
CATEGORIES = (CategoryInfo("static", "Static"), CategoryInfo("dynamic", "Dynamic"))
DEFAULT_SORT = "featured"
SORTS = (SortOption(DEFAULT_SORT, "Featured"),)
SIZES = ("32x16",)
SUPPORTS_SEARCH = True
PAGE_SIZE = 48
REQUEST_TIMEOUT_S = 10.0
CACHE_TTL_CATALOG_S = 12 * 60 * 60
CACHE_TTL_MEDIA_S: float | None = None
PIXEL_WIDTH = 32
PIXEL_HEIGHT = 16
HEADER_BYTES = 27
PLANE_BYTES_PER_FRAME = PIXEL_WIDTH * PIXEL_HEIGHT // 8
MAX_FRAMES = 64
TITLE_TRANSLATIONS: dict[str, str] = json.loads(
    Path(__file__).with_name("coolledx_anim_titles.json").read_text(encoding="utf-8")
)


@dataclass(frozen=True, slots=True)
class AnimationRecord:
    item: GalleryItem
    send_data: bytes
    delay_ms: int
    description: str = ""

@dataclass(frozen=True, slots=True)
class Catalog:
    entries: tuple[AnimationRecord, ...]


def source_info(*, configured: bool = True) -> SourceInfo:
    return SourceInfo(
        id=ID,
        name=NAME,
        configured=configured,
        requires_account=False,
        sorts=SORTS,
        default_sort=DEFAULT_SORT,
        sizes=SIZES,
        supports_search=SUPPORTS_SEARCH,
        homepage=HOMEPAGE,
        categories=CATEGORIES,
        kind="native",
    )


async def _get_json(session: Any, kind: str, timeout_s: float) -> Any:
    url = f"{BASE_URL}/data1632_{kind}.json"
    if not is_vendor_url(url):
        raise SourceRequestError("iLedClock animation URL is not an approved vendor URL")
    try:
        async with session.get(
            url, timeout=aiohttp.ClientTimeout(total=timeout_s), allow_redirects=False
        ) as response:
            if response.status == 404:
                raise SourceNotFound(f"iLedClock {kind} animation feed not found")
            if response.status >= 300:
                raise SourceRequestError(f"iLedClock animation feed returned HTTP {response.status}")
            try:
                return await response.json(content_type=None)
            except (aiohttp.ContentTypeError, json.JSONDecodeError, UnicodeDecodeError) as err:
                raise SourceRequestError(f"iLedClock {kind} animation feed is invalid JSON") from err
    except (asyncio.TimeoutError, aiohttp.ServerTimeoutError) as err:
        raise SourceTimeout(f"iLedClock {kind} animation feed request timed out") from err
    except aiohttp.ClientError as err:
        raise SourceRequestError(f"iLedClock {kind} animation feed request failed: {err}") from err


def _as_byte_data(value: Any) -> bytes:
    if not isinstance(value, list) or any(
        isinstance(byte, bool) or not isinstance(byte, int) or byte < 0 or byte > 255
        for byte in value
    ):
        raise SourceDecodeError("iLedClock animation entry has invalid sendData")
    try:
        return bytes(value)
    except ValueError as err:
        raise SourceDecodeError("iLedClock animation entry has invalid sendData") from err


def _header(send_data: bytes) -> tuple[int, int]:
    if len(send_data) < HEADER_BYTES:
        raise SourceDecodeError("iLedClock animation entry is shorter than its header")
    frame_count = send_data[24]
    delay_ms = (send_data[25] << 8) | send_data[26]
    if not 1 <= frame_count <= MAX_FRAMES:
        raise SourceDecodeError(f"iLedClock animation has invalid frame count {frame_count}")
    expected = HEADER_BYTES + frame_count * PLANE_BYTES_PER_FRAME * 3
    if len(send_data) != expected:
        raise SourceDecodeError(
            f"iLedClock animation has {len(send_data)} bytes; expected {expected} for {frame_count} frames"
        )
    if delay_ms == 0:
        raise SourceDecodeError("iLedClock animation has a zero frame delay")
    return frame_count, delay_ms


def decode_frames(send_data: bytes) -> tuple[tuple[bytes, ...], int]:
    """Decode vendor R/G/B bit planes into row-major 32x16 RGB888 frames.

    Each colour plane stores a frame's two 8-pixel-high groups, with one byte
    per x coordinate and group. Within a byte, the top pixel is bit 7.
    """
    frame_count, delay_ms = _header(send_data)
    plane_bytes = frame_count * PLANE_BYTES_PER_FRAME
    frames: list[bytes] = []
    for frame_index in range(frame_count):
        plane_offsets = tuple(
            HEADER_BYTES + color_index * plane_bytes + frame_index * PLANE_BYTES_PER_FRAME
            for color_index in range(3)
        )
        rgb = bytearray(PIXEL_WIDTH * PIXEL_HEIGHT * 3)
        for x in range(PIXEL_WIDTH):
            for group in range(PIXEL_HEIGHT // 8):
                packed_index = x * (PIXEL_HEIGHT // 8) + group
                red = send_data[plane_offsets[0] + packed_index]
                green = send_data[plane_offsets[1] + packed_index]
                blue = send_data[plane_offsets[2] + packed_index]
                for y_in_group in range(8):
                    mask = 1 << (7 - y_in_group)
                    pixel_offset = ((group * 8 + y_in_group) * PIXEL_WIDTH + x) * 3
                    if red & mask:
                        rgb[pixel_offset] = 255
                    if green & mask:
                        rgb[pixel_offset + 1] = 255
                    if blue & mask:
                        rgb[pixel_offset + 2] = 255
        frames.append(bytes(rgb))
    return tuple(frames), delay_ms


_NUMERIC_PREFIX = re.compile(r"^\s*\d+\s*[.．、]?\s*")


def _strip_numeric_prefix(description: str) -> str:
    return _NUMERIC_PREFIX.sub("", description).strip()


_TITLE_TRANSLATIONS_BY_BASE: dict[str, str] = {}
for _source_title, _translated_title in TITLE_TRANSLATIONS.items():
    _TITLE_TRANSLATIONS_BY_BASE.setdefault(_strip_numeric_prefix(_source_title), _translated_title)


def _title(description: Any, kind: str, index: int) -> str:
    if isinstance(description, str) and description.strip():
        text = _strip_numeric_prefix(description)
        if text:
            return text
    return f"{kind.title()} {index + 1}"


def _english_title(entry: AnimationRecord) -> str:
    return (
        TITLE_TRANSLATIONS.get(entry.description)
        or _TITLE_TRANSLATIONS_BY_BASE.get(_strip_numeric_prefix(entry.description))
        or entry.item.title
    )


def _display_title(entry: AnimationRecord, language: str | None) -> str:
    if language and language.casefold().startswith("zh"):
        return entry.item.title
    return _english_title(entry)



def parse_catalog(feeds: Mapping[str, Mapping[str, Any]]) -> Catalog:
    entries: list[AnimationRecord] = []
    for kind in KINDS:
        feed = feeds.get(kind)
        if not isinstance(feed, Mapping):
            continue
        try:
            version = int(feed["versionCode"])
        except (KeyError, TypeError, ValueError) as err:
            raise SourceRequestError(f"iLedClock {kind} animation feed has no versionCode") from err
        raw_entries = feed.get("animationData")
        if not isinstance(raw_entries, list):
            raise SourceRequestError(f"iLedClock {kind} animation feed has no animationData list")
        valid_for_kind = 0
        for index, row in enumerate(raw_entries):
            if not isinstance(row, Mapping):
                continue
            try:
                if int(row.get("sendDataType", -1)) != 4:
                    continue
                send_data = _as_byte_data(row.get("sendData"))
                frames, delay_ms = _header(send_data)
            except (TypeError, ValueError, SourceRequestError):
                # A single malformed preset must not hide other usable records.
                continue
            description = row.get("describe")
            if not isinstance(description, str):
                description = ""
            description = description.strip()
            item = GalleryItem(
                source=ID,
                id=f"{kind}-{version}-{index}",
                title=_title(description, kind, index),
                width=PIXEL_WIDTH,
                height=PIXEL_HEIGHT,
                animated=frames > 1,
                category=kind,
                frames=frames,
                native_fit=True,
            )
            entries.append(AnimationRecord(item, send_data, delay_ms, description))
            valid_for_kind += 1
        if raw_entries and not valid_for_kind:
            raise SourceDecodeError(f"iLedClock {kind} feed contains no decodable presets")
    if not entries:
        raise SourceRequestError("iLedClock returned no usable animation presets")
    return Catalog(tuple(entries))


async def fetch_catalog(session: Any, *, timeout_s: float = REQUEST_TIMEOUT_S) -> Catalog:
    """Fetch both feeds together; keep one category available if the other is offline."""
    results = await asyncio.gather(
        *(_get_json(session, kind, timeout_s) for kind in KINDS), return_exceptions=True
    )
    feeds: dict[str, Mapping[str, Any]] = {}
    failures: list[BaseException] = []
    for kind, result in zip(KINDS, results):
        if isinstance(result, BaseException):
            failures.append(result)
        elif isinstance(result, Mapping):
            feeds[kind] = result
    if not feeds and failures:
        raise failures[0]
    return parse_catalog(feeds)


def catalog_to_json(catalog: Catalog) -> dict[str, Any]:
    return {
        "entries": [
            {
                "item": entry.item.to_json(),
                "send_data": base64.b64encode(entry.send_data).decode("ascii"),
                "delay_ms": entry.delay_ms,
                "description": entry.description,
            }
            for entry in catalog.entries
        ]
    }


def catalog_from_json(value: Mapping[str, Any] | bytes | str) -> Catalog:
    if isinstance(value, (bytes, str)):
        value = json.loads(value)
    if not isinstance(value, Mapping) or not isinstance(value.get("entries"), list):
        raise ValueError("animation catalog payload is invalid")
    entries: list[AnimationRecord] = []
    for row in value["entries"]:
        item = GalleryItem(**row["item"])
        send_data = base64.b64decode(row["send_data"], validate=True)
        frames, delay_ms = _header(send_data)
        if item.frames != frames or row.get("delay_ms") != delay_ms:
            raise ValueError("animation catalog metadata does not match sendData")
        description = row.get("description")
        if not isinstance(description, str):
            description = item.title
        entries.append(AnimationRecord(item, send_data, delay_ms, description))
    return Catalog(tuple(entries))


def search(
    catalog: Catalog,
    *,
    sort: str = DEFAULT_SORT,
    page: int = 1,
    query: str | None = None,
    size: str | None = None,
    animated_only: bool = False,
    category: str | None = None,
    language: str | None = None,
) -> SearchPage:
    if sort not in ("", DEFAULT_SORT):
        raise SourceRequestError(f"iLedClock animations do not support sort {sort!r}")
    if size and size not in SIZES:
        return SearchPage((), False)
    entries = catalog.entries
    if category:
        entries = tuple(entry for entry in entries if entry.item.category == category)
    if animated_only:
        entries = tuple(entry for entry in entries if entry.item.animated)
    if query:
        needle = query.casefold().strip()
        if needle:
            entries = tuple(
                entry
                for entry in entries
                if needle in _english_title(entry).casefold()
                or needle in entry.item.title.casefold()
                or needle in entry.description.casefold()
                or needle in entry.item.id.casefold()
            )
    page = max(1, page)
    start = (page - 1) * PAGE_SIZE
    end = start + PAGE_SIZE
    return SearchPage(
        tuple(replace(entry.item, title=_display_title(entry, language)) for entry in entries[start:end]),
        end < len(entries),
    )


def _find_record(catalog: Catalog, item_id: str) -> AnimationRecord | None:
    return next((entry for entry in catalog.entries if entry.item.id == item_id), None)


def render_media(catalog: Catalog, item_id: str) -> SourceMedia:
    """Render one versioned vendor preset to a standard GIF for preview/import."""
    entry = _find_record(catalog, item_id)
    if entry is None:
        raise SourceNotFound(f"iLedClock animation {item_id!r} is not in the cached catalog")
    frames, delay_ms = decode_frames(entry.send_data)
    images = [Image.frombytes("RGB", (PIXEL_WIDTH, PIXEL_HEIGHT), frame) for frame in frames]
    output = BytesIO()
    images[0].save(
        output,
        format="GIF",
        save_all=True,
        append_images=images[1:],
        duration=delay_ms,
        loop=0,
        disposal=2,
        optimize=False,
    )
    return SourceMedia(output.getvalue(), "image/gif")
