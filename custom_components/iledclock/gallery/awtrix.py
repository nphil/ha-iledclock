"""AWTRIX Hub icon gallery source (docs/GALLERY.md 'Sources' row `awtrix`, verified
2026-09-26).

Public website (Laravel Livewire), no documented JSON API -- but the `icon-browser`
Livewire component binds its full state (`query`, `sort`, `size`, `animated`, `page`) to
plain URL query parameters (confirmed from the page's own `wire:effects.url` payload), so
a server-rendered `GET https://awtrix.de/icons?query=&sort=&size=&animated=&page=` with no
JavaScript gives the exact same filtered/sorted/paginated HTML a browser would render.
That means this "parser" only ever has to read one page shape: the icon grid
(`<article class="icon-card">...`) plus, for a single item's detail page, the byline (for
optional author/date). Both are tiny, targeted regexes over well-formed, hand-verified
real markup (fixtures under `tests/gallery/fixtures/awtrix_*.html`), not a general HTML
parser -- there is exactly one producer of this markup and its shape is stable.
"""

from __future__ import annotations

import asyncio
import html
import logging
import re
import time
from datetime import datetime, timezone
from typing import Any

from .models import (
    GalleryItem, SearchPage, SortOption, SourceInfo, SourceNotFound,
    SourceRequestError, SourceTimeout,
)

_LOGGER = logging.getLogger(__name__)

ID = "awtrix"
NAME = "AWTRIX Hub"
HOMEPAGE = "https://awtrix.de/icons"
BASE_URL = "https://awtrix.de/icons"

#: Exact `<option value=...>` values from the live `#icon-sort` `<select>`, labels as
#: shown in the UI (docs/GALLERY.md: "newest, most downloaded, hand-picked, A-Z").
SORTS = (
    SortOption("newest", "Newest"),
    SortOption("popular", "Most downloaded"),
    SortOption("picked", "Hand-picked"),
    SortOption("name", "A \u2013 Z"),
)
DEFAULT_SORT = "popular"
SIZES = ("8x8", "32x8")
SUPPORTS_SEARCH = True
PAGE_SIZE = 24  # the live `perPage` value in the component's own snapshot
REQUEST_TIMEOUT_S = 10
#: "Be polite: cache, <=1 req/s" -- docs/GALLERY.md. The module-level request lock spaces
#: listing, detail, and media requests so concurrent callers share the same source limit.
MIN_REQUEST_INTERVAL_S = 1.0
#: Listing pages are user-generated content that changes with new uploads; cache briefly
#: rather than "refresh daily" like LaMetric's whole-catalog snapshot.
CACHE_TTL_LISTING_S = 60 * 60
CACHE_TTL_MEDIA_S = 7 * 24 * 60 * 60

_RETRY_DELAY_S = 0.2
_WARNING_INTERVAL_S = 60.0
_last_warning_at = 0.0
_monotonic = time.monotonic
_last_request_at = 0.0
_request_lock = asyncio.Lock()
_listing_cache: dict[tuple[str, int, str, str, bool], tuple[float, SearchPage]] = {}

_ARTICLE_RE = re.compile(r'<article class="icon-card">(.*?)</article>', re.DOTALL)
_HREF_RE = re.compile(r'<a href="https://awtrix\.de/icons/([^"]+)" class="icon-card__link"')
_ANIMATED_RE = re.compile(r'class="icon-card__motion"')
_TITLE_RE = re.compile(r"<h3>(.*?)</h3>", re.DOTALL)
_META_SIZE_RE = re.compile(
    r'<p class="icon-card__meta"><span title="[^"]*">[^<]*</span><span>([^<]+)</span></p>'
)
_TOTAL_COUNT_RE = re.compile(r'<p role="status">([\d,]+) icons')
_BYLINE_RE = re.compile(
    r'<p class="detail-byline">(.*?)<span aria-hidden="true">\u00b7</span>\s*'
    r"(\d{1,2} \w+ \d{4})</p>",
    re.DOTALL,
)
_DETAIL_TITLE_RE = re.compile(r'<h1 class="display-lg">(.*?)</h1>', re.DOTALL)


def source_info(*, configured: bool = True) -> SourceInfo:
    return SourceInfo(
        id=ID, name=NAME, configured=configured, requires_account=False, sorts=SORTS,
        default_sort=DEFAULT_SORT, sizes=SIZES, supports_search=SUPPORTS_SEARCH,
        homepage=HOMEPAGE,
    )


def _parse_size(size_text: str) -> tuple[int, int]:
    width_text, _, height_text = size_text.strip().partition("x")
    try:
        return int(width_text), int(height_text)
    except ValueError:
        return 8, 8  # never observed live; keeps a malformed row from raising


def parse_listing_html(page_html: str) -> tuple[list[GalleryItem], int | None]:
    """Parse one rendered `GET /icons?...` page into `(items, total_count)`. `total_count`
    is `None` only if the "N icons in the collection" line is missing (never observed
    live, but the caller falls back to a page-size heuristic for `has_more`)."""
    items: list[GalleryItem] = []
    for match in _ARTICLE_RE.finditer(page_html):
        chunk = match.group(1)
        href_match = _HREF_RE.search(chunk)
        title_match = _TITLE_RE.search(chunk)
        size_match = _META_SIZE_RE.search(chunk)
        if not (href_match and title_match and size_match):
            continue  # a card we don't recognise; skip rather than fail the whole page
        slug = href_match.group(1)
        title = html.unescape(title_match.group(1)).strip() or slug
        width, height = _parse_size(size_match.group(1))
        items.append(
            GalleryItem(
                source=ID,
                id=slug,
                title=title,
                width=width,
                height=height,
                animated=bool(_ANIMATED_RE.search(chunk)),
                url=f"{BASE_URL}/{slug}",
            )
        )
    total_match = _TOTAL_COUNT_RE.search(page_html)
    total_count = int(total_match.group(1).replace(",", "")) if total_match else None
    return items, total_count


def parse_detail_html(page_html: str) -> dict[str, Any]:
    """Extract the title/optional author/created fields from one item's detail page
    (fetched only at preview/import time for a single item -- never during listing, to
    stay within the politeness budget)."""
    result: dict[str, Any] = {"title": None, "author": None, "created": None}
    title_match = _DETAIL_TITLE_RE.search(page_html)
    if title_match:
        result["title"] = html.unescape(title_match.group(1)).strip() or None
    byline_match = _BYLINE_RE.search(page_html)
    if not byline_match:
        return result
    prefix = html.unescape(byline_match.group(1)).strip()
    if prefix.startswith("by "):
        result["author"] = prefix[3:].strip() or None
    date_text = byline_match.group(2)
    try:
        parsed = datetime.strptime(date_text, "%d %b %Y").replace(tzinfo=timezone.utc)
        result["created"] = int(parsed.timestamp())
    except ValueError:
        pass
    return result


def _params(
    *, sort: str, page: int, query: str | None, size: str | None, animated_only: bool
) -> dict[str, str]:
    params: dict[str, str] = {}
    if sort and sort != DEFAULT_SORT:
        params["sort"] = sort
    if query:
        params["query"] = query
    if size:
        params["size"] = size
    if animated_only:
        params["animated"] = "1"
    if page > 1:
        params["page"] = str(page)
    return params


def _warn_failure(error: BaseException) -> None:
    global _last_warning_at
    now = _monotonic()
    if now - _last_warning_at >= _WARNING_INTERVAL_S:
        _LOGGER.warning("AWTRIX gallery request failed: %s", error)
        _last_warning_at = now


async def _request(
    session: Any, url: str, *, params: dict[str, str] | None = None,
    binary: bool = False, timeout_s: float = REQUEST_TIMEOUT_S,
) -> tuple[str | bytes, str | None]:
    import aiohttp

    global _last_request_at
    for attempt in range(2):
        try:
            async with _request_lock:
                delay = _last_request_at + MIN_REQUEST_INTERVAL_S - _monotonic()
                if delay > 0:
                    await asyncio.sleep(delay)
                _last_request_at = _monotonic()
                async with session.get(
                    url, params=params, timeout=aiohttp.ClientTimeout(total=timeout_s)
                ) as resp:
                    if resp.status == 404:
                        raise SourceNotFound("AWTRIX item was not found")
                    if resp.status >= 400:
                        if (resp.status == 429 or resp.status >= 500) and attempt == 0:
                            await asyncio.sleep(_RETRY_DELAY_S)
                            continue
                        error = SourceRequestError(f"AWTRIX returned HTTP {resp.status}")
                        _warn_failure(error)
                        raise error
                    data = await resp.read() if binary else await resp.text()
                    content_type = resp.content_type
            if not data:
                raise ValueError("AWTRIX returned an empty response")
            return data, content_type
        except SourceNotFound:
            raise
        except SourceRequestError:
            raise
        except asyncio.TimeoutError as err:
            if attempt == 0:
                await asyncio.sleep(_RETRY_DELAY_S)
                continue
            _warn_failure(err)
            raise SourceTimeout("AWTRIX request timed out") from err
        except (aiohttp.ClientError, ValueError) as err:
            if isinstance(err, aiohttp.ClientResponseError) and err.status < 500 and err.status != 429:
                _warn_failure(err)
                raise SourceRequestError(f"AWTRIX request failed: {err}") from err
            if attempt == 0:
                await asyncio.sleep(_RETRY_DELAY_S)
                continue
            _warn_failure(err)
            raise SourceRequestError(f"AWTRIX request failed: {err}") from err
    raise AssertionError("unreachable")


async def search(
    session: Any,
    *,
    sort: str = DEFAULT_SORT,
    page: int = 1,
    query: str | None = None,
    size: str | None = None,
    animated_only: bool = False,
    timeout_s: float = REQUEST_TIMEOUT_S,
) -> SearchPage:
    """Fetch and parse one page, caching each exact filter/page combination."""
    cache_key = (sort, page, query or "", size or "", animated_only)
    now = _monotonic()
    cached = _listing_cache.get(cache_key)
    if cached is not None and cached[0] > now:
        return cached[1]

    params = _params(sort=sort, page=page, query=query, size=size, animated_only=animated_only)
    for parse_attempt in range(2):
        page_html, _ = await _request(session, BASE_URL, params=params, timeout_s=timeout_s)
        items, total_count = parse_listing_html(page_html)
        # The count is collection-wide, so empty filtered pages are valid; cards we failed to parse
        # or an empty unfiltered first page indicate that the source markup changed.
        if not items and (
            total_count is None
            or _ARTICLE_RE.search(page_html) is not None
            or (page == 1 and not query and not size and not animated_only and total_count > 0)
        ):
            if parse_attempt == 0:
                continue
            error = SourceRequestError("AWTRIX listing response could not be parsed")
            _warn_failure(error)
            raise error
        if total_count is not None:
            offset = max(page - 1, 0) * PAGE_SIZE
            has_more = bool(items) and offset + len(items) < total_count
        else:
            has_more = len(items) >= PAGE_SIZE
        result = SearchPage(items=tuple(items), has_more=has_more)
        _listing_cache[cache_key] = (_monotonic() + CACHE_TTL_LISTING_S, result)
        return result
    raise AssertionError("unreachable")


async def fetch_detail(session: Any, item_id: str, *, timeout_s: float = REQUEST_TIMEOUT_S) -> dict[str, Any]:
    from urllib.parse import quote

    url = f"{BASE_URL}/{quote(item_id, safe='-_')}"
    page_html, _ = await _request(session, url, timeout_s=timeout_s)
    details = parse_detail_html(page_html)
    if details["title"] is None:
        raise SourceRequestError("AWTRIX detail response could not be parsed")
    return details


def media_url(item_id: str) -> str:
    # Public listing preview is the source image, upscaled 8x as animated WebP; the
    # adaptation pipeline's native-scale recovery brings it back to 32x8/8x8 exactly.
    from urllib.parse import quote

    return f"{BASE_URL}/{quote(item_id, safe='-_')}/preview.webp"


async def fetch_media(session: Any, item_id: str, *, timeout_s: float = REQUEST_TIMEOUT_S):
    from .models import SourceMedia

    data, content_type = await _request(
        session, media_url(item_id), binary=True, timeout_s=timeout_s
    )
    return SourceMedia(data=data, content_type=content_type or "image/webp")
