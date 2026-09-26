"""Shared types for online gallery sources (docs/GALLERY.md 'Sources' / 'WebSocket API').

Pure module -- sources implement against these types and talk to the network through an
injected `aiohttp.ClientSession` (a third-party async HTTP library, not `homeassistant`
itself); the HA layer in `gallery/__init__.py` is the only place that supplies that
session, the cache, and Divoom account credentials from a config entry.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True, slots=True)
class SortOption:
    id: str
    label: str


@dataclass(frozen=True, slots=True)
class SourceInfo:
    """Contract `iledclock/gallery/sources` response item."""

    id: str
    name: str
    configured: bool
    requires_account: bool
    sorts: tuple[SortOption, ...]
    default_sort: str
    sizes: tuple[str, ...]
    supports_search: bool
    homepage: str

    def to_json(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "configured": self.configured,
            "requires_account": self.requires_account,
            "sorts": [{"id": s.id, "label": s.label} for s in self.sorts],
            "default_sort": self.default_sort,
            "sizes": list(self.sizes),
            "supports_search": self.supports_search,
            "homepage": self.homepage,
        }


@dataclass(frozen=True, slots=True)
class GalleryItem:
    """One search-result row (contract `iledclock/gallery/search` item shape). `author`,
    `likes`, `downloads`, `created` (Unix epoch seconds), and `url` (the item's own page on
    the source site, when the source has one) are all optional/nullable -- most sources
    only populate a subset. `media_path` is filled in by the HA layer, never by a source
    (a source has no idea what HTTP view path it will be proxied through)."""

    source: str
    id: str
    title: str
    width: int
    height: int
    animated: bool
    author: str | None = None
    likes: int | None = None
    downloads: int | None = None
    created: int | None = None
    url: str | None = None
    media_path: str = ""

    def to_json(self) -> dict:
        return {
            "source": self.source,
            "id": self.id,
            "title": self.title,
            "author": self.author,
            "width": self.width,
            "height": self.height,
            "animated": self.animated,
            "likes": self.likes,
            "downloads": self.downloads,
            "created": self.created,
            "url": self.url,
            "media_path": self.media_path,
        }

    def with_media_path(self, media_path: str) -> "GalleryItem":
        return GalleryItem(
            source=self.source, id=self.id, title=self.title, width=self.width,
            height=self.height, animated=self.animated, author=self.author,
            likes=self.likes, downloads=self.downloads, created=self.created,
            url=self.url, media_path=media_path,
        )


@dataclass(frozen=True, slots=True)
class SearchPage:
    items: tuple[GalleryItem, ...]
    has_more: bool


@dataclass(frozen=True, slots=True)
class SourceMedia:
    """Raw bytes of an item's original (or, for Divoom, decoded-to-GIF) media -- what the
    HTTP media view proxies/caches and what `importers.gif.load()` decodes."""

    data: bytes
    content_type: str


class SourceError(RuntimeError):
    """A source-specific failure (network, auth, decode). Callers must catch this per
    source so one source's failure never breaks another (GALLERY.md: "Isolate
    failures")."""


class SourceUnavailable(SourceError):
    """Raised by `search`/`fetch_media` when the source needs an account that isn't
    configured yet (Divoom before `divoom_email`/`divoom_password_md5` are set)."""


class SourceRequestError(SourceError):
    """A network/HTTP/parse failure talking to the source's live service."""
