"""Playlist validation (Contract D).

A playlist is the ordered list of up to `MAX_PLAYLIST_ITEMS` programs the clock cycles through;
`iledclock/playlist/set` uploads it, `set_playlist` (the service) does the same. Validation here
is deliberately shallow -- shape and required-key presence, not full value-range checking -- so
a client gets one clear error for "this is structurally not a `text` item" without us duplicating
every protocol-level bound (clock style 1-41, alarm hour 0-23, ...) a second time; those are
enforced once, by the actual content builders in `protocol.programs`/`protocol.commands` when the
item is turned into bytes. This module has no `homeassistant` or `protocol` imports.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping

from .const import (
    DEFAULT_PLAYLIST_DURATION_S,
    MAX_PLAYLIST_ITEMS,
    PLAYLIST_DURATION_MAX_S,
    PLAYLIST_DURATION_MIN_S,
    PLAYLIST_KINDS,
)

# Required `params` keys per kind -- presence only. `scoreboard`/`temperature`/`humidity` have no
# required params: they always render the clock's own live/current values.
_REQUIRED_PARAMS: dict[str, tuple[str, ...]] = {
    "clock": ("style", "color"),
    "date": ("color",),
    "text": ("text",),
    "design": ("design_id",),
    "timer": ("mode",),
    "scoreboard": (),
    "temperature": (),
    "humidity": (),
}


class PlaylistValidationError(ValueError):
    """Raised for any structurally invalid playlist or playlist item. `index` is the offending
    item's position (0-based) when known, so a UI/service caller can point at exactly one row."""

    def __init__(self, message: str, index: int | None = None) -> None:
        super().__init__(message)
        self.index = index


@dataclass(frozen=True, slots=True)
class PlaylistItem:
    kind: str
    params: Mapping[str, Any]
    duration_s: int


def validate_playlist_item(raw: Any, index: int | None = None) -> PlaylistItem:
    """Validate one playlist item dict. Raises `PlaylistValidationError` on any structural
    problem; returns a normalised `PlaylistItem` (defaulted `duration_s`, `params` copied to a
    plain `dict`) otherwise."""
    if not isinstance(raw, Mapping):
        raise PlaylistValidationError("playlist item must be an object", index)

    kind = raw.get("kind")
    if kind not in PLAYLIST_KINDS:
        raise PlaylistValidationError(
            f"kind must be one of {PLAYLIST_KINDS}, got {kind!r}", index
        )

    params = raw.get("params", {})
    if not isinstance(params, Mapping):
        raise PlaylistValidationError("params must be an object", index)
    missing = [key for key in _REQUIRED_PARAMS[kind] if key not in params]
    if missing:
        raise PlaylistValidationError(
            f"{kind!r} params missing required field(s): {missing}", index
        )

    duration_raw = raw.get("duration_s", DEFAULT_PLAYLIST_DURATION_S)
    try:
        duration = int(duration_raw)
    except (TypeError, ValueError) as err:
        raise PlaylistValidationError("duration_s must be an integer", index) from err
    if not (PLAYLIST_DURATION_MIN_S <= duration <= PLAYLIST_DURATION_MAX_S):
        raise PlaylistValidationError(
            f"duration_s must be between {PLAYLIST_DURATION_MIN_S} and "
            f"{PLAYLIST_DURATION_MAX_S}, got {duration}",
            index,
        )

    return PlaylistItem(kind=kind, params=dict(params), duration_s=duration)


def validate_playlist(raw_items: Any) -> list[PlaylistItem]:
    """Validate a whole playlist. Raises `PlaylistValidationError` if `raw_items` isn't a
    non-empty list of at most `MAX_PLAYLIST_ITEMS` valid items."""
    if not isinstance(raw_items, (list, tuple)):
        raise PlaylistValidationError("playlist must be a list")
    if not raw_items:
        raise PlaylistValidationError("playlist must have at least one item")
    if len(raw_items) > MAX_PLAYLIST_ITEMS:
        raise PlaylistValidationError(
            f"playlist supports at most {MAX_PLAYLIST_ITEMS} items on this device, "
            f"got {len(raw_items)}"
        )
    return [validate_playlist_item(item, i) for i, item in enumerate(raw_items)]


def playlist_item_to_json(item: PlaylistItem) -> dict[str, Any]:
    """Mirror of `validate_playlist_item`, for shaping an already-validated item back out over
    the websocket API (`iledclock/playlist/get`)."""
    return {"kind": item.kind, "params": dict(item.params), "duration_s": item.duration_s}
