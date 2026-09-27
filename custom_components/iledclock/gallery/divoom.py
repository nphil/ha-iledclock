"""Divoom Cloud gallery source (docs/GALLERY.md 'Sources' row `divoom`) -- unofficial,
community-reverse-engineered. Request/response shapes ported from apixoo (MIT) and
servoom (Apache-2.0) -- see /NOTICE for full attribution.

Needs a free Divoom account (email + MD5-hashed password); the HA layer reads
`entry.options["divoom_email"]`/`["divoom_password_md5"]` and this source reports itself
"not configured" otherwise (docs/GALLERY.md: "Enabled only when the account is set").

**Scope note**: the gallery call was exercised against the live Divoom API using the configured account. Tests keep synthetic listing rows to stay deterministic.
Decoder format 3/4 evidence uses checked-in captures, while public servoom format tables do not document those layouts.
"""
from __future__ import annotations

import asyncio
import hashlib
import io
import json
import logging
import time
from dataclasses import dataclass
from enum import IntEnum
from typing import Any, Awaitable, Callable, Sequence

from .models import (
    GalleryItem, SearchPage, SortOption, SourceDecodeError, SourceInfo,
    SourceNotFound, SourceRequestError, SourceTimeout, SourceUnavailable,
)

_LOGGER = logging.getLogger(__name__)

ID = "divoom"
NAME = "Divoom Cloud"
HOMEPAGE = "https://app.divoom-gz.com"
API_HOST = "app.divoom-gz.com"
FILE_HOST = "f.divoom-gz.com"
REQUEST_TIMEOUT_S = 10

# Successful auth responses are cached in memory only. The API has no documented expiry
# field, so refresh well before the conservative local lifetime and on HTTP auth failures.
TOKEN_CACHE_TTL_S = 15 * 60
TOKEN_REFRESH_MARGIN_S = 60
_RETRY_DELAY_S = 0.2
_WARNING_INTERVAL_S = 60.0
_last_warning_at = 0.0
_monotonic = time.monotonic
_token_cache: dict[str, tuple[dict[str, Any], float]] = {}
_login_locks: dict[str, asyncio.Lock] = {}

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


class _DivoomAuthError(SourceRequestError):
    """HTTP authentication failure that permits one cached-token refresh."""


def _warn_failure(error: BaseException) -> None:
    global _last_warning_at
    now = _monotonic()
    if now - _last_warning_at >= _WARNING_INTERVAL_S:
        _LOGGER.warning("Divoom gallery request failed: %s", error)
        _last_warning_at = now


def _account_cache_key(account: DivoomAccount) -> str:
    material = f"{account.email}\0{account.password_md5}".encode("utf-8")
    return hashlib.sha256(material).hexdigest()


def _invalidate_token(account: DivoomAccount, failed_token: Any = None) -> None:
    key = _account_cache_key(account)
    cached = _token_cache.get(key)
    if cached is not None and (failed_token is None or cached[0].get("Token") == failed_token):
        _token_cache.pop(key, None)


def _is_auth_failure_response(response: dict[str, Any]) -> bool:
    code = str(response.get("ReturnCode", ""))
    if code == "0":
        return False
    message = response.get("ReturnMessage", "")
    message = message.casefold() if isinstance(message, str) else ""
    return code in {"401", "403"} or any(word in message for word in ("token", "expired", "unauthor", "login"))


async def _post_json(session: Any, path: str, payload: dict[str, Any]) -> dict[str, Any]:
    import aiohttp

    url = f"https://{API_HOST}{path}"
    for attempt in range(2):
        try:
            async with session.post(
                url, json=payload, timeout=aiohttp.ClientTimeout(total=REQUEST_TIMEOUT_S)
            ) as resp:
                if resp.status == 404:
                    raise SourceNotFound(f"Divoom endpoint {path} was not found")
                if resp.status in {401, 403}:
                    raise _DivoomAuthError("Divoom rejected the current login token")
                if resp.status >= 400:
                    if (resp.status == 429 or resp.status >= 500) and attempt == 0:
                        await asyncio.sleep(_RETRY_DELAY_S)
                        continue
                    error = SourceRequestError(f"Divoom endpoint {path} returned HTTP {resp.status}")
                    _warn_failure(error)
                    raise error
                result = await resp.json(content_type=None)
            if not isinstance(result, dict):
                raise ValueError("Divoom returned a non-object response")
            return result
        except (_DivoomAuthError, SourceNotFound):
            raise
        except asyncio.TimeoutError as err:
            if attempt == 0:
                await asyncio.sleep(_RETRY_DELAY_S)
                continue
            _warn_failure(err)
            raise SourceTimeout(f"Divoom request to {path} timed out") from err
        except (aiohttp.ClientError, ValueError) as err:
            if isinstance(err, aiohttp.ClientResponseError) and err.status < 500 and err.status != 429:
                _warn_failure(err)
                raise SourceRequestError(f"Divoom request to {path} failed: {err}") from err
            if attempt == 0:
                await asyncio.sleep(_RETRY_DELAY_S)
                continue
            _warn_failure(err)
            raise SourceRequestError(f"Divoom request to {path} failed: {err}") from err
    raise AssertionError("unreachable")


async def login(
    session: Any, account: DivoomAccount, *, refresh: bool = False
) -> dict[str, Any]:
    """Reuse a short-lived in-memory token and refresh it before the local expiry margin.
    The upstream login response documents no expiry field, so the conservative local
    lifetime is 15 minutes; rejected tokens trigger an immediate refresh in the caller."""
    key = _account_cache_key(account)
    lock = _login_locks.setdefault(key, asyncio.Lock())
    async with lock:
        now = _monotonic()
        cached = _token_cache.get(key)
        if not refresh and cached is not None and cached[1] - now > TOKEN_REFRESH_MARGIN_S:
            return dict(cached[0])
        try:
            response = await _post_json(
                session, ENDPOINT_LOGIN,
                {"Email": account.email, "Password": account.password_md5},
            )
        except _DivoomAuthError as err:
            failure = SourceUnavailable("Divoom login was rejected; check the configured account")
            _warn_failure(failure)
            raise failure from err
        if not response.get("UserId") or not response.get("Token"):
            failure = SourceUnavailable("Divoom login was rejected; check the configured account")
            _warn_failure(failure)
            raise failure
        _token_cache[key] = (dict(response), now + TOKEN_CACHE_TTL_S)
        return response


def _auth_payload(login_response: dict[str, Any]) -> dict[str, Any]:
    return {"Token": login_response["Token"], "UserId": login_response["UserId"]}


async def _authenticated_post(
    session: Any, account: DivoomAccount, path: str, payload: dict[str, Any]
) -> dict[str, Any]:
    for attempt in range(2):
        login_response = await login(session, account)
        try:
            response = await _post_json(
                session, path, {**_auth_payload(login_response), **payload}
            )
        except _DivoomAuthError as err:
            _invalidate_token(account, login_response.get("Token"))
            if attempt == 0:
                continue
            failure = SourceRequestError("Divoom rejected the refreshed login token")
            _warn_failure(failure)
            raise failure from err
        if _is_auth_failure_response(response):
            _invalidate_token(account, login_response.get("Token"))
            if attempt == 0:
                continue
            failure = SourceRequestError("Divoom rejected the refreshed login token")
            _warn_failure(failure)
            raise failure
        return response
    raise AssertionError("unreachable")


def _reported_total(response: dict[str, Any]) -> int | None:
    value = response.get("FileListNum")
    try:
        total = int(value)
    except (TypeError, ValueError):
        return None
    return total if total >= 0 else None


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
    size_label = size or DEFAULT_SIZE
    dimension = _resolve_size(size_label)
    file_type = _resolve_file_type(size_label, animated_only=animated_only)
    category_request = _sort_to_request(sort) if not query else None
    start_num = max(1, (page - 1) * page_size + 1)
    end_num = start_num + page_size  # inclusive look-ahead row for a reliable has_more flag

    if query:
        path = ENDPOINT_SEARCH_GALLERY
        payload = {"Keywords": query, "StartNum": start_num, "EndNum": end_num}
    else:
        category, file_sort = category_request
        path = ENDPOINT_CATEGORY_FILES
        payload = {
            "Classify": int(category), "FileSize": int(dimension),
            "FileType": int(file_type), "FileSort": int(file_sort),
            "Version": 12, "RefreshIndex": 0,
            "StartNum": start_num, "EndNum": end_num,
        }
    response = await _authenticated_post(session, account, path, payload)
    if str(response.get("ReturnCode", 0)) != "0":
        raise SourceRequestError(f"Divoom listing failed (ReturnCode {response.get('ReturnCode')})")

    raw_rows = parse_category_response(response)
    if not isinstance(raw_rows, list):
        raise SourceRequestError("Divoom listing returned an invalid file list")
    items = parse_category_items(response, size_label=size_label)
    unique_items = []
    seen_ids: set[str] = set()
    for item in items:
        if item.id not in seen_ids:
            seen_ids.add(item.id)
            unique_items.append(item)

    total = _reported_total(response)
    if total is not None:
        has_more = bool(raw_rows) and start_num - 1 + len(raw_rows) < total
    else:
        has_more = len(raw_rows) > page_size
    return SearchPage(items=tuple(unique_items[:page_size]), has_more=has_more)

async def fetch_artwork_info(
    session: Any, account: DivoomAccount, gallery_id: str
) -> dict[str, Any]:
    if not gallery_id.isdecimal():
        raise SourceNotFound(f"Divoom artwork {gallery_id!r} was not found")
    response = await _authenticated_post(
        session, account, ENDPOINT_GALLERY_INFO, {"GalleryId": int(gallery_id)}
    )
    if str(response.get("ReturnCode", 0)) != "0":
        message = response.get("ReturnMessage", "")
        message = message.casefold() if isinstance(message, str) else ""
        if "not found" in message or "no file" in message:
            raise SourceNotFound(f"Divoom artwork {gallery_id!r} was not found")
        raise SourceRequestError(
            f"Divoom artwork info failed for {gallery_id!r} (ReturnCode {response.get('ReturnCode')})"
        )
    if not response.get("FileId"):
        raise SourceNotFound(f"Divoom artwork {gallery_id!r} has no media file")
    return response


async def _download_file(session: Any, file_id: str) -> bytes:
    """Download a public raw artwork container with one transient-failure retry."""
    import aiohttp
    from urllib.parse import quote

    if not file_id:
        raise SourceNotFound("Divoom artwork has no file id")
    url = f"https://{FILE_HOST}/{quote(file_id, safe='/')}"
    for attempt in range(2):
        try:
            async with session.get(url, timeout=aiohttp.ClientTimeout(total=REQUEST_TIMEOUT_S)) as resp:
                if resp.status == 404:
                    raise SourceNotFound("Divoom artwork file was not found")
                if resp.status >= 400:
                    if (resp.status == 429 or resp.status >= 500) and attempt == 0:
                        await asyncio.sleep(_RETRY_DELAY_S)
                        continue
                    error = SourceRequestError(f"Divoom artwork download returned HTTP {resp.status}")
                    _warn_failure(error)
                    raise error
                data = await resp.read()
            if not data:
                raise ValueError("Divoom artwork file was empty")
            return data
        except SourceNotFound:
            raise
        except asyncio.TimeoutError as err:
            if attempt == 0:
                await asyncio.sleep(_RETRY_DELAY_S)
                continue
            _warn_failure(err)
            raise SourceTimeout("Divoom artwork download timed out") from err
        except (aiohttp.ClientError, ValueError) as err:
            if isinstance(err, aiohttp.ClientResponseError) and err.status < 500 and err.status != 429:
                _warn_failure(err)
                raise SourceRequestError(f"Divoom artwork download failed: {err}") from err
            if attempt == 0:
                await asyncio.sleep(_RETRY_DELAY_S)
                continue
            _warn_failure(err)
            raise SourceRequestError(f"Divoom artwork download failed: {err}") from err
    raise AssertionError("unreachable")


def _decode_and_encode(raw: bytes, gallery_id: str):
    from PIL import Image

    from . import divoom_pixelbean
    from .models import SourceMedia

    try:
        container = divoom_pixelbean.decode(raw)
    except divoom_pixelbean.PixelBeanDecodeError as err:
        raise SourceDecodeError(f"Divoom artwork {gallery_id!r} failed to decode: {err}") from err

    try:
        if not container.frames_rgb:
            raise ValueError("decoded artwork has no frames")
        frames = [
            Image.frombytes("RGB", (container.width, container.height), rgb).convert("RGBA")
            for rgb in container.frames_rgb
        ]
        buf = io.BytesIO()
        if len(frames) == 1:
            frames[0].convert("P", palette=Image.ADAPTIVE).save(buf, format="GIF")
        else:
            palette_frames = [frame.convert("P", palette=Image.ADAPTIVE) for frame in frames]
            palette_frames[0].save(
                buf, format="GIF", save_all=True, append_images=palette_frames[1:],
                duration=container.delay_ms, loop=0, disposal=2,
            )
        data = buf.getvalue()
        if not data:
            raise ValueError("GIF encoder returned no data")
    except (OSError, ValueError) as err:
        raise SourceDecodeError(f"Divoom artwork {gallery_id!r} could not be encoded: {err}") from err
    return SourceMedia(data=data, content_type="image/gif")


async def fetch_media(
    session: Any, account: DivoomAccount, gallery_id: str,
    *, decode_executor: Callable[..., Awaitable[Any]] | None = None,
):
    """Download and decode one artwork into a real GIF; the packed .dat is not browser media."""
    info = await fetch_artwork_info(session, account, gallery_id)
    raw = await _download_file(session, str(info["FileId"]))
    if decode_executor is not None:
        return await decode_executor(_decode_and_encode, raw, gallery_id)
    return _decode_and_encode(raw, gallery_id)
