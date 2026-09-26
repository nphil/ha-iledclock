"""LaMetric icon gallery source (docs/GALLERY.md 'Sources' row `lametric`, verified
2026-09-26).

Official public API, no auth: `GET https://developer.lametric.com/api/v2/icons` returns
at most `MAX_CATALOG_SIZE` icons and offers no server-side search or filtering, so this
source fetches the whole current catalog in one request (`page_size=MAX_CATALOG_SIZE`,
the observed ceiling -- `total_icon_count` never exceeds it) and the HA layer caches that
snapshot for `CACHE_TTL_CATALOG_S` ("refresh daily"); `search()` then filters/sorts/
paginates the cached snapshot entirely in memory -- no I/O, no network. Every icon is
8x8; the media URL extension (`.gif` vs `.png`) is deterministic from the catalog's own
`animated` flag, verified against live responses for both `type: "movie"` (-> `.gif`) and
`type: "picture"` (-> `.png`) rows.
"""

from __future__ import annotations

import json
from typing import Any, Sequence

from .models import GalleryItem, SearchPage, SortOption, SourceInfo, SourceRequestError

ID = "lametric"
NAME = "LaMetric"
HOMEPAGE = "https://developer.lametric.com/icons"
BASE_URL = "https://developer.lametric.com/api/v2/icons"
MEDIA_BASE_URL = "https://developer.lametric.com/content/apps/icon_thumbs"
REQUEST_FIELDS = "id,type,url,title"

#: Contract table: `order=popular|newest|title`.
SORTS = (
    SortOption("popular", "Popular"),
    SortOption("newest", "Newest"),
    SortOption("title", "Title"),
)
DEFAULT_SORT = "popular"
#: The only size this source ever serves.
SIZES = ("8x8",)
SUPPORTS_SEARCH = True  # client-side only, over the cached catalog snapshot

#: The API never reports more than this many icons total (verified live, 2026-09-26);
#: requesting this many at once returns the whole catalog in a single page.
MAX_CATALOG_SIZE = 2000
#: `search()` result page size (this source has no native pagination once cached).
PAGE_SIZE = 24
#: "cache the full list (<=2000, refresh daily)" -- docs/GALLERY.md.
CACHE_TTL_CATALOG_S = 24 * 60 * 60
REQUEST_TIMEOUT_S = 10


def source_info(*, configured: bool = True) -> SourceInfo:
    return SourceInfo(
        id=ID, name=NAME, configured=configured, requires_account=False, sorts=SORTS,
        default_sort=DEFAULT_SORT, sizes=SIZES, supports_search=SUPPORTS_SEARCH,
        homepage=HOMEPAGE,
    )


def parse_catalog_response(payload: dict[str, Any]) -> list[GalleryItem]:
    """Parse one `GET .../icons` JSON response's `data` array into `GalleryItem`s.

    LaMetric exposes no author/likes/downloads/created/per-item-page fields at all, so
    those stay `None` for every item (all optional per the WS contract).
    """
    items: list[GalleryItem] = []
    for row in payload.get("data", []):
        icon_id = row.get("id")
        if icon_id is None:
            continue
        title = (row.get("title") or "").strip() or f"Icon {icon_id}"
        items.append(
            GalleryItem(
                source=ID,
                id=str(icon_id),
                title=title,
                width=8,
                height=8,
                animated=row.get("type") == "movie",
            )
        )
    return items


async def fetch_catalog(
    session: Any, *, timeout_s: float = REQUEST_TIMEOUT_S
) -> list[GalleryItem]:
    """Fetch the whole current catalog in one request. `session` is an
    `aiohttp.ClientSession` (the HA layer supplies HA's shared one)."""
    import aiohttp

    params = {
        "page": "1",
        "page_size": str(MAX_CATALOG_SIZE),
        "order": "newest",
        "fields": REQUEST_FIELDS,
    }
    try:
        async with session.get(
            BASE_URL, params=params, timeout=aiohttp.ClientTimeout(total=timeout_s)
        ) as resp:
            resp.raise_for_status()
            payload = await resp.json(content_type=None)
    except aiohttp.ClientError as err:
        raise SourceRequestError(f"LaMetric request failed: {err}") from err
    except json.JSONDecodeError as err:
        raise SourceRequestError(f"LaMetric returned invalid JSON: {err}") from err
    return parse_catalog_response(payload)


def search(
    catalog: Sequence[GalleryItem],
    *,
    sort: str = DEFAULT_SORT,
    page: int = 1,
    query: str | None = None,
    size: str | None = None,
    animated_only: bool = False,
    page_size: int = PAGE_SIZE,
) -> SearchPage:
    """Filter/sort/paginate an already-fetched catalog snapshot. Pure, no I/O.

    `sort="popular"` and `sort="newest"` both preserve `catalog`'s own order: the API has
    no per-item popularity score once cached client-side, only a live `order=popular`
    request-time ordering we can't replay locally, and `fetch_catalog` already fetches
    `order=newest` so that ordering is already newest-first.
    """
    rows: Sequence[GalleryItem] = catalog
    if size is not None and size not in SIZES:
        rows = ()  # only size this source has; anything else is an empty result
    if query:
        needle = query.casefold()
        rows = [item for item in rows if needle in item.title.casefold()]
    if animated_only:
        rows = [item for item in rows if item.animated]
    if sort == "title":
        rows = sorted(rows, key=lambda item: item.title.casefold())
    start = max(page - 1, 0) * page_size
    end = start + page_size
    page_items = tuple(rows[start:end])
    return SearchPage(items=page_items, has_more=end < len(rows))


def find_item(catalog: Sequence[GalleryItem], item_id: str) -> GalleryItem | None:
    """Look up one item by id in a cached catalog snapshot (used to serve media: the
    media URL's extension depends on the item's `animated` flag, so fetching media needs
    the catalog row, not just the bare id)."""
    for item in catalog:
        if item.id == item_id:
            return item
    return None


def media_url(item: GalleryItem) -> str:
    """Full-resolution media URL for a catalog item."""
    ext = "gif" if item.animated else "png"
    return f"{MEDIA_BASE_URL}/{item.id}.{ext}"


async def fetch_media(
    session: Any, catalog: Sequence[GalleryItem], item_id: str,
    *, timeout_s: float = REQUEST_TIMEOUT_S,
):
    """Download one item's original media bytes. Requires the catalog snapshot (to
    resolve the id -> exact URL/extension); raises `SourceRequestError` for an unknown id
    (a stale id from a catalog that has since refreshed) or a failed download."""
    import aiohttp

    from .models import SourceMedia

    item = find_item(catalog, item_id)
    if item is None:
        raise SourceRequestError(f"LaMetric icon {item_id!r} not found in cached catalog")
    url = media_url(item)
    try:
        async with session.get(
            url, timeout=aiohttp.ClientTimeout(total=timeout_s)
        ) as resp:
            resp.raise_for_status()
            data = await resp.read()
            content_type = resp.content_type or ("image/gif" if item.animated else "image/png")
    except aiohttp.ClientError as err:
        raise SourceRequestError(f"LaMetric media fetch failed for {item_id!r}: {err}") from err
    return SourceMedia(data=data, content_type=content_type)
