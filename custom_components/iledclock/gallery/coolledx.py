"""iLedClock's online, device-sized GIF material gallery.

The vendor sends one localized item manifest per category and XOR-obfuscates
only the first 32 bytes of each GIF. This module owns that wire format; the HA
layer owns persistence and the authenticated media proxy.
"""
from __future__ import annotations

import asyncio
import json
import re
from dataclasses import dataclass
from io import BytesIO
from typing import Any, Mapping, Sequence
from urllib.parse import urlparse

import aiohttp
from PIL import Image

from .models import (
    CategoryInfo,
    GalleryItem,
    SearchPage,
    SortOption,
    SourceInfo,
    SourceMedia,
    SourceDecodeError,
    SourceNotFound,
    SourceRequestError,
    SourceTimeout,
)

ID = "iledclock"
NAME = "iLedClock originals"
HOMEPAGE = "https://www.coolledx.com/CoolLEDX/iLedClock/material"
CONFIG_URL = "http://www.coolledx.com/CoolLEDX/iLedClock/config.json"
VENDOR_HOSTS = frozenset(("www.coolledx.com", "coolledx.com"))
DEFAULT_SORT = "featured"
SORTS = (SortOption(DEFAULT_SORT, "Featured"),)
SIZES = ("32x16",)
SUPPORTS_SEARCH = True
ROWS = 16
COLS = 32
PAGE_SIZE = 48
REQUEST_TIMEOUT_S = 10.0
MAX_CONCURRENT_LISTING_REQUESTS = 4
CACHE_TTL_CATALOG_S = 12 * 60 * 60
CACHE_TTL_MEDIA_S: float | None = None


@dataclass(frozen=True, slots=True)
class Category:
    id: str
    label: str
    url: str

    def to_json(self) -> dict[str, str]:
        return {"id": self.id, "label": self.label, "url": self.url}


@dataclass(frozen=True, slots=True)
class Catalog:
    categories: tuple[Category, ...]
    items: tuple[GalleryItem, ...]
    media_urls: tuple[tuple[str, str], ...]
    rows: int = ROWS
    cols: int = COLS

    def media_url(self, item_id: str) -> str | None:
        return next((url for key, url in self.media_urls if key == item_id), None)


def normalize_language(language: str | None) -> str:
    """Use the vendor's locale filenames while accepting HA's language tags."""
    normalized = (language or "en").strip().replace("_", "-")
    if not normalized:
        return "en"
    parts = normalized.split("-")
    language_code = parts[0].lower()
    if language_code == "iw":
        language_code = "he"
    if language_code == "zh":
        region = parts[1].upper() if len(parts) > 1 else "CN"
        return "zh-TW" if region == "TW" else "zh-CN"
    return language_code


def _localized_label(name: Any, language: str) -> str:
    if isinstance(name, str):
        return name.strip()
    if not isinstance(name, Mapping):
        return ""
    label = name.get(language) or name.get(language.split("-", 1)[0]) or name.get("en")
    return label.strip() if isinstance(label, str) else ""


def _category_slug(url: str, index: int) -> str:
    raw = urlparse(url).path.rstrip("/").rsplit("/", 1)[-1].lower()
    slug = re.sub(r"[^a-z0-9_-]+", "-", raw).strip("-_")
    return slug or f"category-{index + 1}"


def is_vendor_url(url: str) -> bool:
    """Accept only HTTP(S) URLs on the two vendor hosts, without custom ports or userinfo."""
    try:
        parsed = urlparse(url)
        return (
            parsed.scheme.lower() in ("http", "https")
            and parsed.hostname in VENDOR_HOSTS
            and parsed.port in (None, 80 if parsed.scheme.lower() == "http" else 443)
            and parsed.username is None
            and parsed.password is None
        )
    except (TypeError, ValueError):
        return False


def parse_categories(payload: Mapping[str, Any], language: str | None = "en") -> tuple[Category, ...]:
    raw_categories = payload.get("category")
    if not isinstance(raw_categories, list):
        raise SourceRequestError("CoolLEDX category response has no category list")
    locale = normalize_language(language)
    categories: list[Category] = []
    seen: set[str] = set()
    for index, raw in enumerate(raw_categories):
        if not isinstance(raw, Mapping):
            continue
        url = raw.get("url")
        if not isinstance(url, str) or not is_vendor_url(url):
            continue
        category_id = _category_slug(url, index)
        if category_id in seen:
            category_id = f"{category_id}-{index + 1}"
        seen.add(category_id)
        label = _localized_label(raw.get("name"), locale) or category_id.replace("-", " ").title()
        categories.append(Category(category_id, label, url.rstrip("/")))
    if not categories:
        raise SourceRequestError("CoolLEDX category response contains no usable categories")
    return tuple(categories)


def source_info(*, categories: Sequence[Category] = (), configured: bool = True) -> SourceInfo:
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
        categories=tuple(CategoryInfo(category.id, category.label) for category in categories),
        kind="native",
    )


async def _get_json(session: Any, url: str, timeout_s: float) -> Any:
    if not is_vendor_url(url):
        raise SourceRequestError("CoolLEDX URL is not an approved vendor URL")
    try:
        async with session.get(
            url, timeout=aiohttp.ClientTimeout(total=timeout_s), allow_redirects=False
        ) as response:
            if response.status == 404:
                raise SourceNotFound(f"CoolLEDX resource not found: {url}")
            if response.status >= 300:
                raise SourceRequestError(f"CoolLEDX returned HTTP {response.status}")
            try:
                return await response.json(content_type=None)
            except (aiohttp.ContentTypeError, json.JSONDecodeError, UnicodeDecodeError) as err:
                raise SourceRequestError(f"CoolLEDX returned invalid JSON: {url}") from err
    except (asyncio.TimeoutError, aiohttp.ServerTimeoutError) as err:
        raise SourceTimeout(f"CoolLEDX request timed out: {url}") from err
    except aiohttp.ClientError as err:
        raise SourceRequestError(f"CoolLEDX request failed: {err}") from err


async def _get_bytes(session: Any, url: str, timeout_s: float) -> bytes:
    if not is_vendor_url(url):
        raise SourceRequestError("CoolLEDX URL is not an approved vendor URL")
    try:
        async with session.get(
            url, timeout=aiohttp.ClientTimeout(total=timeout_s), allow_redirects=False
        ) as response:
            if response.status == 404:
                raise SourceNotFound(f"CoolLEDX media not found: {url}")
            if response.status >= 300:
                raise SourceRequestError(f"CoolLEDX returned HTTP {response.status} for media")
            return await response.read()
    except (asyncio.TimeoutError, aiohttp.ServerTimeoutError) as err:
        raise SourceTimeout(f"CoolLEDX media request timed out: {url}") from err
    except aiohttp.ClientError as err:
        raise SourceRequestError(f"CoolLEDX media request failed: {err}") from err


async def fetch_categories(
    session: Any,
    *,
    language: str | None = "en",
    rows: int = ROWS,
    cols: int = COLS,
    timeout_s: float = REQUEST_TIMEOUT_S,
) -> tuple[Category, ...]:
    config = await _get_json(session, CONFIG_URL, timeout_s)
    material_url = config.get("material_url") if isinstance(config, Mapping) else None
    if not isinstance(material_url, str) or not is_vendor_url(material_url):
        raise SourceRequestError("CoolLEDX device config has no material_url")
    category_url = f"{material_url.rstrip('/')}/fc/{rows}x{cols}/category.json"
    payload = await _get_json(session, category_url, timeout_s)
    if not isinstance(payload, Mapping):
        raise SourceRequestError("CoolLEDX category response is not an object")
    return parse_categories(payload, language)


def _filename(value: Any) -> str | None:
    if not isinstance(value, str) or value in (".", ".."):
        return None
    if re.fullmatch(r"[A-Za-z0-9._-]+\.gif", value, flags=re.IGNORECASE) is None:
        return None
    return value


def build_catalog(
    categories: Sequence[Category],
    manifests: Mapping[str, Mapping[str, Any]],
    *,
    rows: int = ROWS,
    cols: int = COLS,
) -> Catalog:
    items: list[GalleryItem] = []
    media_urls: list[tuple[str, str]] = []
    for category in categories:
        manifest = manifests.get(category.id)
        if not isinstance(manifest, Mapping):
            continue
        base_url = manifest.get("baseUrl")
        files = manifest.get("list")
        if not isinstance(base_url, str) or not is_vendor_url(base_url):
            continue
        if not isinstance(files, list):
            continue
        for raw_filename in files:
            filename = _filename(raw_filename)
            if filename is None:
                continue
            item_id = f"{category.id}/{filename}"
            media_url = f"{base_url.rstrip('/')}/{filename}"
            items.append(
                GalleryItem(
                    source=ID,
                    id=item_id,
                    title="",
                    width=cols,
                    height=rows,
                    # The feed contains GIFs. The HA search layer replaces this hint with
                    # the decoded frame count while warming the media cache for this page.
                    animated=True,
                    category=category.id,
                    native_fit=True,
                )
            )
            media_urls.append((item_id, media_url))
    return Catalog(tuple(categories), tuple(items), tuple(media_urls), rows=rows, cols=cols)


async def _fetch_manifest(
    session: Any, category: Category, language: str, timeout_s: float
) -> Mapping[str, Any] | None:
    try:
        payload = await _get_json(session, f"{category.url}/list_{language}.json", timeout_s)
    except SourceNotFound:
        if language == "en":
            return None
        payload = await _get_json(session, f"{category.url}/list_en.json", timeout_s)
    if not isinstance(payload, Mapping):
        return None
    return payload


async def fetch_catalog(
    session: Any,
    *,
    language: str | None = "en",
    rows: int = ROWS,
    cols: int = COLS,
    categories: Sequence[Category] | None = None,
    timeout_s: float = REQUEST_TIMEOUT_S,
) -> Catalog:
    """Fetch the category list and its full per-category manifests (there is no vendor paging)."""
    resolved_categories = tuple(categories) if categories is not None else await fetch_categories(
        session, language=language, rows=rows, cols=cols, timeout_s=timeout_s
    )
    locale = normalize_language(language)
    semaphore = asyncio.Semaphore(MAX_CONCURRENT_LISTING_REQUESTS)

    async def fetch_one(category: Category) -> tuple[str, Mapping[str, Any] | None]:
        async with semaphore:
            try:
                return category.id, await _fetch_manifest(session, category, locale, timeout_s)
            except SourceRequestError:
                # One broken category must not hide the rest of this vendor's gallery.
                return category.id, None

    responses = await asyncio.gather(*(fetch_one(category) for category in resolved_categories))
    manifests = {category_id: payload for category_id, payload in responses if payload is not None}
    if resolved_categories and not manifests:
        raise SourceRequestError("CoolLEDX returned no usable category manifests")
    return build_catalog(resolved_categories, manifests, rows=rows, cols=cols)


def catalog_to_json(catalog: Catalog) -> dict[str, Any]:
    return {
        "categories": [category.to_json() for category in catalog.categories],
        "items": [item.to_json() for item in catalog.items],
        "media_urls": [list(pair) for pair in catalog.media_urls],
        "rows": catalog.rows,
        "cols": catalog.cols,
    }


def catalog_from_json(value: Mapping[str, Any] | bytes | str) -> Catalog:
    if isinstance(value, (bytes, str)):
        value = json.loads(value)
    if not isinstance(value, Mapping):
        raise ValueError("catalog payload is not an object")
    categories = tuple(Category(**row) for row in value["categories"])
    items = tuple(GalleryItem(**row) for row in value["items"])
    urls = tuple((str(pair[0]), str(pair[1])) for pair in value["media_urls"])
    return Catalog(categories, items, urls, int(value.get("rows", ROWS)), int(value.get("cols", COLS)))


def search(
    catalog: Catalog,
    *,
    sort: str = DEFAULT_SORT,
    page: int = 1,
    query: str | None = None,
    size: str | None = None,
    animated_only: bool = False,
    category: str | None = None,
) -> SearchPage:
    if sort not in ("", DEFAULT_SORT):
        raise SourceRequestError(f"CoolLEDX does not support sort {sort!r}")
    if size and size not in SIZES:
        return SearchPage((), False)
    items = catalog.items
    if category:
        items = tuple(item for item in items if item.category == category)
    if animated_only:
        items = tuple(item for item in items if item.animated)
    if query:
        needle = query.casefold().strip()
        if needle:
            items = tuple(
                item for item in items
                if needle in item.title.casefold() or needle in item.id.casefold()
            )
    page = max(1, page)
    start = (page - 1) * PAGE_SIZE
    end = start + PAGE_SIZE
    return SearchPage(tuple(items[start:end]), end < len(items))


def find_item(catalog: Catalog, item_id: str) -> GalleryItem | None:
    return next((item for item in catalog.items if item.id == item_id), None)


def frame_count(gif_bytes: bytes) -> int:
    """Return the decoded frame count for one already-deobfuscated GIF."""
    try:
        with Image.open(BytesIO(gif_bytes)) as image:
            if image.format != "GIF":
                raise SourceDecodeError("CoolLEDX media did not decode as GIF")
            return int(image.n_frames)
    except SourceRequestError:
        raise
    except Exception as err:
        raise SourceDecodeError("CoolLEDX returned an invalid GIF") from err


async def fetch_media(
    session: Any,
    catalog: Catalog,
    item_id: str,
    *,
    timeout_s: float = REQUEST_TIMEOUT_S,
) -> SourceMedia:
    url = catalog.media_url(item_id)
    if url is None:
        raise SourceNotFound(f"CoolLEDX item {item_id!r} is not in the cached catalog")
    encrypted = await _get_bytes(session, url, timeout_s)
    if len(encrypted) < 32:
        raise SourceDecodeError("CoolLEDX returned media shorter than the 32-byte header")
    decoded = bytes(byte ^ 0xDA for byte in encrypted[:32]) + encrypted[32:]
    if not decoded.startswith((b"GIF87a", b"GIF89a")):
        raise SourceDecodeError("CoolLEDX media did not decode to a GIF header")
    return SourceMedia(decoded, "image/gif")
