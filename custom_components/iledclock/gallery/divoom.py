"""Divoom Cloud gallery source (docs/GALLERY.md 'Sources' row `divoom`) -- unofficial,
community-reverse-engineered. Request/response shapes ported from apixoo (MIT) and
servoom (Apache-2.0) -- see /NOTICE for full attribution.

Needs a free Divoom account (email + MD5-hashed password); the HA layer reads
`entry.options["divoom_email"]`/`["divoom_password_md5"]` and this source reports itself
"not configured" otherwise (docs/GALLERY.md: "Enabled only when the account is set").

**Scope note (no live Divoom account was available for this port -- see the assignment
report)**: every request-shape/field-name claim below is taken directly from apixoo's/
servoom's own source and reference docs (a real, working community client), not
independently re-verified against a live response by this integration. Decoding the
downloaded artwork itself (`divoom_pixelbean.decode`) is separately verified with
synthetic fixtures built from the documented byte layout (see `test_divoom_pixelbean.py`)
-- that part does not depend on live API access at all, only the *listing*/*metadata*
shapes below are unverified.
"""

from __future__ import annotations

import io
import json
from dataclasses import dataclass
from enum import IntEnum
from typing import Any, Sequence

from .models import GalleryItem, SearchPage, SortOption, SourceInfo, SourceRequestError, SourceUnavailable

ID = "divoom"
NAME = "Divoom Cloud"
HOMEPAGE = "https://app.divoom-gz.com"
API_HOST = "app.divoom-gz.com"
FILE_HOST = "f.divoom-gz.com"
REQUEST_TIMEOUT_S = 10

#: apixoo/servoom `ApiEndpoint` (paths joined onto `API_HOST`).
ENDPOINT_LOGIN = "/UserLogin"
ENDPOINT_GALLERY_INFO = "/Cloud/GalleryInfo"
ENDPOINT_CATEGORY_FILES = "/GetCategoryFileListV2"
ENDPOINT_SEARCH_GALLERY = "/SearchGalleryV3"


class GalleryCategory(IntEnum):
    """`Classify` values observed in the app (apixoo/servoom `gallery_reference.py`).
    Only the ones this module's sort mapping (`_sort_to_request`) actually uses."""

    NEW = 0
    DEFAULT = 1
    TOP = 14
    RECOMMEND = 18


class GallerySorting(IntEnum):
    """`FileSort` values."""

    NEW_UPLOAD = 0
    MOST_LIKED = 1


class GalleryType(IntEnum):
    """`FileType` values -- also what a listing row's own `FileType` field reports back,
    used here to derive each item's `animated` flag (0/2 = picture, 1/3 = animation)."""

    PICTURE = 0
    ANIMATION = 1
    MULTI_PICTURE = 2
    MULTI_ANIMATION = 3
    ALL = 5


class GalleryDimension(IntEnum):
    """`FileSize` bitmask values. Deliberately narrower than servoom's newer, larger
    enum (which also covers 128x128/256x256): docs/GALLERY.md's own sizes column for this
    source lists only 16x16/32x32/64x64 -- big enough for a 32x16 clock's majority-pool
    downscale, without pulling in canvas sizes this device has no real use for."""

    W16H16 = 1
    W32H32 = 2
    W64H64 = 4


#: docs/GALLERY.md sizes column.
SIZES: tuple[str, ...] = ("16x16", "32x32", "64x64")
_SIZE_TO_DIMENSION: dict[str, GalleryDimension] = {
    "16x16": GalleryDimension.W16H16, "32x32": GalleryDimension.W32H32, "64x64": GalleryDimension.W64H64,
}
#: Divoom's own listing rows carry no per-item width/height field (verified absent from
#: apixoo's/servoom's own `GalleryInfo` key mapping) -- the only way to know an item's
#: canvas size is to have REQUESTED that exact size via `FileSize`, so `search()` always
#: resolves to one concrete size per call (never "all sizes at once"). Chosen as the
#: richest/most-detailed default when the caller doesn't specify one.
DEFAULT_SIZE = "64x64"

#: docs/GALLERY.md: "recommended, new, popular/most-liked (whatever categories the API
#: exposes)". Divoom's own API splits "which pool of art" (`Classify`/category) from "what
#: order" (`FileSort`) as two independent axes; this module folds that into the single
#: `sort` control GALLERY.md's WS contract expects, mapped as documented in
#: `_sort_to_request` below -- an implementation decision (the contract explicitly leaves
#: this source's exact category choice open), not a verified Divoom-side taxonomy.
SORTS = (
    SortOption("recommended", "Recommended"),
    SortOption("new", "New"),
    SortOption("popular", "Popular"),
)
DEFAULT_SORT = "recommended"
SUPPORTS_SEARCH = True  # SearchGalleryV3
PAGE_SIZE = 24


@dataclass(frozen=True, slots=True)
class DivoomAccount:
    email: str
    password_md5: str


def source_info(*, configured: bool) -> SourceInfo:
    return SourceInfo(
        id=ID, name=NAME, configured=configured, requires_account=True, sorts=SORTS,
        default_sort=DEFAULT_SORT, sizes=SIZES, supports_search=SUPPORTS_SEARCH, homepage=HOMEPAGE,
    )


def _sort_to_request(sort: str) -> tuple[GalleryCategory, GallerySorting]:
    """`(category, file_sort)` for one of `SORTS`' ids -- see the `SORTS` docstring above
    for why this mapping exists at all (Divoom has no single "sort" axis)."""
    if sort == "recommended":
        return GalleryCategory.RECOMMEND, GallerySorting.NEW_UPLOAD
    if sort == "new":
        return GalleryCategory.NEW, GallerySorting.NEW_UPLOAD
    if sort == "popular":
        return GalleryCategory.TOP, GallerySorting.MOST_LIKED
    raise SourceRequestError(f"unknown divoom sort {sort!r}, choose one of {[s.id for s in SORTS]}")


def _resolve_size(size: str | None) -> GalleryDimension:
    label = size or DEFAULT_SIZE
    if label not in _SIZE_TO_DIMENSION:
        raise SourceRequestError(f"unsupported divoom size {label!r}, choose one of {SIZES}")
    return _SIZE_TO_DIMENSION[label]


def _resolve_file_type(size_label: str, *, animated_only: bool) -> GalleryType:
    if not animated_only:
        return GalleryType.ALL
    # FILE_FORMATS.md's server-classification table: FileType=1 ("animation") occurs at
    # 16x16 canvases; FileType=3 ("multi-animation") at 32x32/64x64 (and rarely 16x16,
    # which FileType=1 already covers for that size).
    return GalleryType.ANIMATION if size_label == "16x16" else GalleryType.MULTI_ANIMATION


def parse_category_response(payload: dict[str, Any]) -> list[dict[str, Any]]:
    """Return the raw item rows from one `GetCategoryFileListV2`/`SearchGalleryV3`
    response (`FileList`, or the older `CategoryFileList` key some servoom call sites
    also accept) -- kept separate from `_row_to_item` so a caller can inspect
    `ReturnCode`/pagination fields on the full payload if needed."""
    return payload.get("FileList") or payload.get("CategoryFileList") or []


def _row_to_item(row: dict[str, Any], *, size_label: str) -> GalleryItem | None:
    gallery_id = row.get("GalleryId")
    if gallery_id is None:
        return None
    width = height = int(size_label.split("x")[0])
    title = row.get("FileName") or f"Divoom #{gallery_id}"
    file_type = row.get("FileType")
    animated = file_type in (GalleryType.ANIMATION, GalleryType.MULTI_ANIMATION)
    # [UNVERIFIED] no live response was available to confirm which of these field names
    # (if any) `GetCategoryFileListV2`/`SearchGalleryV3` rows actually carry; other Divoom
    # endpoints examined (Forum/Comment listings) do carry a `NickName`, so this is a
    # reasonable, defensive best-effort mapping, not a confirmed one.
    author = row.get("NickName") or row.get("UserName")
    likes = row.get("LikeCnt")
    downloads = row.get("ShareCnt")  # Divoom exposes no direct "download count"; ShareCnt
    # is the closest analogue in the documented field set (GalleryInfo has no separate
    # download counter at all) -- [UNVERIFIED] treat as approximate, not a true download tally.
    created = row.get("Date")
    return GalleryItem(
        source=ID,
        id=str(gallery_id),
        title=str(title),
        width=width,
        height=height,
        animated=bool(animated),
        author=str(author) if author else None,
        likes=int(likes) if isinstance(likes, (int, float, str)) and str(likes).lstrip("-").isdigit() else None,
        downloads=int(downloads) if isinstance(downloads, (int, float, str)) and str(downloads).lstrip("-").isdigit() else None,
        created=int(created) if isinstance(created, (int, float, str)) and str(created).lstrip("-").isdigit() else None,
    )


def parse_category_items(payload: dict[str, Any], *, size_label: str) -> list[GalleryItem]:
    items = []
    for row in parse_category_response(payload):
        item = _row_to_item(row, size_label=size_label)
        if item is not None:
            items.append(item)
    return items


async def _post_json(session: Any, path: str, payload: dict[str, Any]) -> dict[str, Any]:
    import aiohttp

    url = f"https://{API_HOST}{path}"
    try:
        async with session.post(
            url, json=payload, timeout=aiohttp.ClientTimeout(total=REQUEST_TIMEOUT_S)
        ) as resp:
            resp.raise_for_status()
            return await resp.json(content_type=None)
    except aiohttp.ClientError as err:
        raise SourceRequestError(f"Divoom request to {path} failed: {err}") from err
    except json.JSONDecodeError as err:
        raise SourceRequestError(f"Divoom returned invalid JSON from {path}: {err}") from err


async def login(session: Any, account: DivoomAccount) -> dict[str, Any]:
    """`{"UserId": ..., "Token": ...}` on success. Raises `SourceUnavailable` for a
    rejected login (wrong credentials) and `SourceRequestError` for a network/protocol
    failure -- callers should surface the former as "check your Divoom account" and the
    latter as a generic "Divoom is unavailable right now" (docs/GALLERY.md: "Isolate
    failures")."""
    resp = await _post_json(session, ENDPOINT_LOGIN, {"Email": account.email, "Password": account.password_md5})
    if "UserId" not in resp or "Token" not in resp:
        raise SourceUnavailable(f"Divoom login rejected (response: {resp!r})")
    return resp


def _auth_payload(login_resp: dict[str, Any]) -> dict[str, Any]:
    return {"Token": login_resp["Token"], "UserId": login_resp["UserId"]}


async def search(
    session: Any,
    account: DivoomAccount,
    *,
    sort: str = DEFAULT_SORT,
    page: int = 1,
    query: str | None = None,
    size: str | None = None,
    animated_only: bool = False,
    page_size: int = PAGE_SIZE,
) -> SearchPage:
    login_resp = await login(session, account)
    size_label = size or DEFAULT_SIZE
    dimension = _resolve_size(size_label)
    file_type = _resolve_file_type(size_label, animated_only=animated_only)
    start_num = max(1, (page - 1) * page_size + 1)
    end_num = start_num + page_size - 1

    if query:
        payload = {
            **_auth_payload(login_resp), "Keywords": query, "StartNum": start_num, "EndNum": end_num,
        }
        resp = await _post_json(session, ENDPOINT_SEARCH_GALLERY, payload)
    else:
        category, file_sort = _sort_to_request(sort)
        payload = {
            **_auth_payload(login_resp),
            "Classify": int(category),
            "FileSize": int(dimension),
            "FileType": int(file_type),
            "FileSort": int(file_sort),
            "Version": 12,
            "RefreshIndex": 0,
            "StartNum": start_num,
            "EndNum": end_num,
        }
        resp = await _post_json(session, ENDPOINT_CATEGORY_FILES, payload)

    if resp.get("ReturnCode", 0) != 0:
        raise SourceRequestError(f"Divoom listing failed (ReturnCode {resp.get('ReturnCode')})")
    items = parse_category_items(resp, size_label=size_label)
    return SearchPage(items=tuple(items), has_more=len(items) >= page_size)


async def fetch_artwork_info(session: Any, account: DivoomAccount, gallery_id: str) -> dict[str, Any]:
    login_resp = await login(session, account)
    resp = await _post_json(
        session, ENDPOINT_GALLERY_INFO, {**_auth_payload(login_resp), "GalleryId": int(gallery_id)}
    )
    if resp.get("ReturnCode", 0) != 0:
        raise SourceRequestError(f"Divoom artwork info failed for {gallery_id!r} (ReturnCode {resp.get('ReturnCode')})")
    return resp


async def _download_file(session: Any, file_id: str) -> bytes:
    """Downloads a raw cloud file (an artwork's `FileId`). No login required -- the file
    server is public once the id is known (confirmed in servoom's own client)."""
    import aiohttp

    url = f"https://{FILE_HOST}/{file_id}"
    try:
        async with session.get(url, timeout=aiohttp.ClientTimeout(total=REQUEST_TIMEOUT_S)) as resp:
            resp.raise_for_status()
            return await resp.read()
    except aiohttp.ClientError as err:
        raise SourceRequestError(f"Divoom file download failed for {file_id!r}: {err}") from err


async def fetch_media(session: Any, account: DivoomAccount, gallery_id: str):
    """Download + decode one artwork, then re-encode it as a real GIF -- the raw
    `.dat` pixel-bean container isn't a displayable image format, so (per docs/GALLERY.md
    "and Divoom-decoded GIFs") this is the one source whose HTTP media view serves
    *decoded* bytes, not a proxy of the original file."""
    from . import divoom_pixelbean
    from .models import SourceMedia

    info = await fetch_artwork_info(session, account, gallery_id)
    file_id = info.get("FileId")
    if not file_id:
        raise SourceRequestError(f"Divoom artwork {gallery_id!r} has no FileId in its metadata")
    raw = await _download_file(session, file_id)
    try:
        container = divoom_pixelbean.decode(raw)
    except divoom_pixelbean.PixelBeanDecodeError as err:
        raise SourceRequestError(f"Divoom artwork {gallery_id!r} failed to decode: {err}") from err

    from PIL import Image

    frames = [
        Image.frombytes("RGB", (container.width, container.height), rgb).convert("RGBA")
        for rgb in container.frames_rgb
    ]
    buf = io.BytesIO()
    if len(frames) == 1:
        frames[0].convert("P", palette=Image.ADAPTIVE).save(buf, format="GIF")
    else:
        palette_frames = [f.convert("P", palette=Image.ADAPTIVE) for f in frames]
        palette_frames[0].save(
            buf, format="GIF", save_all=True, append_images=palette_frames[1:],
            duration=container.delay_ms, loop=0, disposal=2,
        )
    return SourceMedia(data=buf.getvalue(), content_type="image/gif")
