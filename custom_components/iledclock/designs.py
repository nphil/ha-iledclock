"""Design library records: a saved still image or short animation a user can drop onto the
clock or into a playlist slot (Contract D `iledclock/designs/*`).

Pure module (no `homeassistant` imports) so validation/(de)serialisation is unit-testable
directly; `store.py` is the thin `homeassistant.helpers.storage.Store`-backed wrapper around it.
"""

from __future__ import annotations

import base64
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Mapping

from .const import (
    DESIGN_KINDS,
    DESIGN_MAX_DELAY_MS,
    DESIGN_MAX_FRAMES,
    DESIGN_MIN_DELAY_MS,
    DESIGN_NAME_MAX_LENGTH,
    DISPLAY_HEIGHT,
    DISPLAY_WIDTH,
)
from .retime import validate_smooth, validate_speed

#: Contract D decision: frames travel as base64 of raw RGB888, row-major, top-to-bottom,
#: left-to-right -- 32*16*3 bytes per frame.
FRAME_BYTES = DISPLAY_WIDTH * DISPLAY_HEIGHT * 3


class DesignValidationError(ValueError):
    """Raised for any structurally invalid design payload. `field` names the offending key when
    known."""

    def __init__(self, message: str, field: str | None = None) -> None:  # noqa: A002 - shadow ok
        super().__init__(message)
        self.field = field


@dataclass(frozen=True, slots=True)
class DesignOrigin:
    """Credit metadata for a design saved from the online gallery (docs/GALLERY.md
    `iledclock/gallery/import`: "saves to the design library with origin: {source, id, title,
    author, url} for credit"). `None` on a hand-drawn design or one imported from a local
    file/URL via `iledclock/import/file`, which carries no gallery listing to credit."""

    source: str
    id: str
    title: str | None = None
    author: str | None = None
    url: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "source": self.source,
            "id": self.id,
            "title": self.title,
            "author": self.author,
            "url": self.url,
        }

    @classmethod
    def from_dict(cls, data: Mapping[str, Any]) -> "DesignOrigin":
        return cls(
            source=str(data["source"]),
            id=str(data["id"]),
            title=data.get("title"),
            author=data.get("author"),
            url=data.get("url"),
        )


@dataclass(frozen=True, slots=True)
class Design:
    id: str
    name: str
    kind: str
    width: int
    height: int
    frames: tuple[bytes, ...]  # each exactly FRAME_BYTES raw RGB888
    delays_ms: tuple[int, ...]  # same length as `frames`
    created: float
    updated: float
    tags: tuple[str, ...] = field(default_factory=tuple)
    origin: DesignOrigin | None = None
    #: (x, y, w, h) reserved for the firmware's own live clock (the gallery's "Icon with clock"
    #: layout). None for ordinary full-screen art.
    clock_region: tuple[int, int, int, int] | None = None
    #: How fast the clock plays this design (`retime.py`): None = Original, the delays as authored;
    #: 0 = Still, one picture; 1..100 = the Speed slider. The frames and `delays_ms` above stay exactly
    #: as authored; the pace and the in-between frames are worked out from them each time.
    speed: float | int | None = None
    #: Smooth motion (`retime.py`): None = auto (same as "on"), "on", or "off".
    smooth: str | None = None

    def to_storage(self) -> dict[str, Any]:
        """JSON-safe dict for `homeassistant.helpers.storage.Store`."""
        return {
            "id": self.id,
            "name": self.name,
            "kind": self.kind,
            "width": self.width,
            "height": self.height,
            "frames": [base64.b64encode(frame).decode("ascii") for frame in self.frames],
            "delays_ms": list(self.delays_ms),
            "created": self.created,
            "updated": self.updated,
            "tags": list(self.tags),
            "origin": self.origin.to_dict() if self.origin is not None else None,
            "clock_region": list(self.clock_region) if self.clock_region else None,
            "speed": self.speed,
            "smooth": self.smooth,
        }

    def to_json(self) -> dict[str, Any]:
        """Contract D `designs/list` shape: `{id, name, kind, width, height, frames, delays,
        created, updated, tags}`, frames as base64 RGB888 strings, delays in ms."""
        return {
            "id": self.id,
            "name": self.name,
            "kind": self.kind,
            "width": self.width,
            "height": self.height,
            "frames": [base64.b64encode(frame).decode("ascii") for frame in self.frames],
            "delays": list(self.delays_ms),
            "created": self.created,
            "updated": self.updated,
            "tags": list(self.tags),
            "origin": self.origin.to_dict() if self.origin is not None else None,
            "clock_region": _region_json(self.clock_region),
            "speed": self.speed,
            "smooth": self.smooth,
        }

    @classmethod
    def from_storage(cls, data: Mapping[str, Any]) -> "Design":
        return cls(
            id=data["id"],
            name=data["name"],
            kind=data["kind"],
            width=data.get("width", DISPLAY_WIDTH),
            height=data.get("height", DISPLAY_HEIGHT),
            frames=tuple(base64.b64decode(frame) for frame in data["frames"]),
            delays_ms=tuple(data["delays_ms"]),
            created=data.get("created", 0.0),
            updated=data.get("updated", 0.0),
            tags=tuple(data.get("tags", ())),
            origin=DesignOrigin.from_dict(data["origin"]) if data.get("origin") else None,
            clock_region=tuple(data["clock_region"]) if data.get("clock_region") else None,
            speed=_stored_setting(validate_speed, data.get("speed")),
            smooth=_stored_setting(validate_smooth, data.get("smooth")),
        )


def _stored_setting(validate: Any, value: Any) -> Any:
    """A playback setting read back from storage; a value that is no longer valid (an old or hand-edited
    file) falls back to the default instead of making the whole design unreadable."""
    try:
        return validate(value)
    except ValueError:
        return None


def _region_json(region: tuple[int, int, int, int] | None) -> dict[str, int] | None:
    if not region:
        return None
    x, y, w, h = region
    return {"x": x, "y": y, "w": w, "h": h}


def validate_clock_region(raw: Any) -> tuple[int, int, int, int] | None:
    """`{x, y, w, h}` (or [x, y, w, h]) inside the display, at least 16x7 so HH:MM fits."""
    if raw is None:
        return None
    if isinstance(raw, Mapping):
        values = [raw.get(k) for k in ("x", "y", "w", "h")]
    elif isinstance(raw, (list, tuple)) and len(raw) == 4:
        values = list(raw)
    else:
        raise DesignValidationError("clock_region must be {x, y, w, h}", "clock_region")
    if not all(isinstance(v, int) and not isinstance(v, bool) for v in values):
        raise DesignValidationError("clock_region values must be integers", "clock_region")
    x, y, w, h = values
    if x < 0 or y < 0 or w < 16 or h < 7 or x + w > DISPLAY_WIDTH or y + h > DISPLAY_HEIGHT:
        raise DesignValidationError("clock_region must lie inside the display and fit HH:MM (16x7)", "clock_region")
    return (x, y, w, h)


def decode_frame(raw: Any, index: int) -> bytes:
    if not isinstance(raw, str):
        raise DesignValidationError(f"frames[{index}] must be a base64 string", "frames")
    try:
        frame = base64.b64decode(raw, validate=True)
    except (ValueError, TypeError) as err:
        raise DesignValidationError(f"frames[{index}] is not valid base64", "frames") from err
    if len(frame) != FRAME_BYTES:
        raise DesignValidationError(
            f"frames[{index}] must decode to exactly {FRAME_BYTES} bytes "
            f"({DISPLAY_WIDTH}x{DISPLAY_HEIGHT} RGB888), got {len(frame)}",
            "frames",
        )
    return frame


def validate_design_payload(raw: Any, *, existing_id: str | None = None) -> Design:
    """Validate a `designs/save` websocket payload (Contract D) and return a normalised
    `Design`. `id` is preserved from `raw` (an edit) or `existing_id`, or freshly minted (a new
    design) when neither is present."""
    if not isinstance(raw, Mapping):
        raise DesignValidationError("design must be an object")

    name = raw.get("name")
    if not isinstance(name, str) or not name.strip():
        raise DesignValidationError("name must be a non-empty string", "name")
    if len(name) > DESIGN_NAME_MAX_LENGTH:
        raise DesignValidationError(
            f"name must be at most {DESIGN_NAME_MAX_LENGTH} characters", "name"
        )

    kind = raw.get("kind")
    if kind not in DESIGN_KINDS:
        raise DesignValidationError(f"kind must be one of {DESIGN_KINDS}, got {kind!r}", "kind")

    width = raw.get("width", DISPLAY_WIDTH)
    height = raw.get("height", DISPLAY_HEIGHT)
    if (width, height) != (DISPLAY_WIDTH, DISPLAY_HEIGHT):
        raise DesignValidationError(
            f"width/height must be {DISPLAY_WIDTH}x{DISPLAY_HEIGHT}, got {width}x{height}"
        )

    frames_raw = raw.get("frames")
    if not isinstance(frames_raw, (list, tuple)) or not frames_raw:
        raise DesignValidationError("frames must be a non-empty list", "frames")
    if len(frames_raw) > DESIGN_MAX_FRAMES:
        raise DesignValidationError(
            f"at most {DESIGN_MAX_FRAMES} frames are supported, got {len(frames_raw)}", "frames"
        )
    frames = tuple(decode_frame(f, i) for i, f in enumerate(frames_raw))

    if kind == "image":
        delays_ms: tuple[int, ...] = (0,) * len(frames)
    else:
        delays_raw = raw.get("delays") if "delays" in raw else raw.get("delays_ms")
        if not isinstance(delays_raw, (list, tuple)) or len(delays_raw) != len(frames):
            raise DesignValidationError(
                "delays must be a list the same length as frames", "delays"
            )
        try:
            delays_ints = [int(d) for d in delays_raw]
        except (TypeError, ValueError) as err:
            raise DesignValidationError("delays must be integers", "delays") from err
        for i, delay in enumerate(delays_ints):
            if not (DESIGN_MIN_DELAY_MS <= delay <= DESIGN_MAX_DELAY_MS):
                raise DesignValidationError(
                    f"delays[{i}] must be between {DESIGN_MIN_DELAY_MS} and "
                    f"{DESIGN_MAX_DELAY_MS}ms, got {delay}",
                    "delays",
                )
        delays_ms = tuple(delays_ints)

    tags_raw = raw.get("tags", ())
    if not isinstance(tags_raw, (list, tuple)) or not all(isinstance(t, str) for t in tags_raw):
        raise DesignValidationError("tags must be a list of strings", "tags")

    origin_raw = raw.get("origin")
    origin: DesignOrigin | None = None
    if origin_raw is not None:
        if not isinstance(origin_raw, Mapping):
            raise DesignValidationError("origin must be an object or null", "origin")
        origin_source = origin_raw.get("source")
        origin_id = origin_raw.get("id")
        if not isinstance(origin_source, str) or not origin_source:
            raise DesignValidationError("origin.source must be a non-empty string", "origin")
        if not isinstance(origin_id, str) or not origin_id:
            raise DesignValidationError("origin.id must be a non-empty string", "origin")
        for key in ("title", "author", "url"):
            value = origin_raw.get(key)
            if value is not None and not isinstance(value, str):
                raise DesignValidationError(f"origin.{key} must be a string or null", "origin")
        origin = DesignOrigin(
            source=origin_source,
            id=origin_id,
            title=origin_raw.get("title"),
            author=origin_raw.get("author"),
            url=origin_raw.get("url"),
        )

    try:
        speed = validate_speed(raw.get("speed"))
    except ValueError as err:
        raise DesignValidationError(str(err), "speed") from err
    try:
        smooth = validate_smooth(raw.get("smooth"))
    except ValueError as err:
        raise DesignValidationError(str(err), "smooth") from err

    design_id = raw.get("id") or existing_id or uuid.uuid4().hex
    now = time.time()
    created = raw.get("created", now) if existing_id or raw.get("id") else now

    return Design(
        id=design_id,
        name=name.strip(),
        kind=kind,
        width=DISPLAY_WIDTH,
        height=DISPLAY_HEIGHT,
        frames=frames,
        delays_ms=delays_ms,
        created=created,
        updated=now,
        tags=tuple(tags_raw),
        origin=origin,
        clock_region=validate_clock_region(raw.get("clock_region")),
        speed=speed,
        smooth=smooth,
    )
