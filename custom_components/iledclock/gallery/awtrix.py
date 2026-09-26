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

import html
import re
from datetime import datetime, timezone
from typing import Any

from .models import GalleryItem, SearchPage, SortOption, SourceInfo, SourceRequestError

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
DEFAULT_SORT = "newest"
SIZES = ("8x8", "32x8")
SUPPORTS_SEARCH = True
PAGE_SIZE = 24  # the live `perPage` value in the component's own snapshot
REQUEST_TIMEOUT_S = 10
#: "Be polite: cache, <=1 req/s" -- docs/GALLERY.md. The HA layer must not issue two
#: requests to this source closer together than this; this constant is the single source
#: of truth other modules read it from (see gallery/__init__.py's rate limiter).
MIN_REQUEST_INTERVAL_S = 1.0
#: Listing pages are user-generated content that changes with new uploads; cache briefly
#: rather than "refresh daily" like LaMetric's whole-catalog snapshot.
CACHE_TTL_LISTING_S = 60 * 60
CACHE_TTL_MEDIA_S = 7 * 24 * 60 * 60

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
    """Fetch and parse one results page. `session` is an `aiohttp.ClientSession`."""
    import aiohttp

    params = _params(sort=sort, page=page, query=query, size=size, animated_only=animated_only)
    try:
        async with session.get(
            BASE_URL, params=params, timeout=aiohttp.ClientTimeout(total=timeout_s)
        ) as resp:
            resp.raise_for_status()
            page_html = await resp.text()
    except aiohttp.ClientError as err:
        raise SourceRequestError(f"AWTRIX request failed: {err}") from err

    items, total_count = parse_listing_html(page_html)
    if total_count is not None:
        has_more = page * PAGE_SIZE < total_count
    else:
        has_more = len(items) >= PAGE_SIZE
    return SearchPage(items=tuple(items), has_more=has_more)


async def fetch_detail(session: Any, item_id: str, *, timeout_s: float = REQUEST_TIMEOUT_S) -> dict[str, Any]:
    """Fetch one item's detail page for its optional author/created metadata."""
    import aiohttp

    url = f"{BASE_URL}/{item_id}"
    try:
        async with session.get(
            url, timeout=aiohttp.ClientTimeout(total=timeout_s)
        ) as resp:
            resp.raise_for_status()
            page_html = await resp.text()
    except aiohttp.ClientError as err:
        raise SourceRequestError(f"AWTRIX detail fetch failed for {item_id!r}: {err}") from err
    return parse_detail_html(page_html)


def media_url(item_id: str) -> str:
    return f"{BASE_URL}/{item_id}.gif"


async def fetch_media(session: Any, item_id: str, *, timeout_s: float = REQUEST_TIMEOUT_S):
    import aiohttp

    from .models import SourceMedia

    url = media_url(item_id)
    try:
        async with session.get(
            url, timeout=aiohttp.ClientTimeout(total=timeout_s)
        ) as resp:
            resp.raise_for_status()
            data = await resp.read()
            content_type = resp.content_type or "image/gif"
    except aiohttp.ClientError as err:
        raise SourceRequestError(f"AWTRIX media fetch failed for {item_id!r}: {err}") from err
    return SourceMedia(data=data, content_type=content_type)
