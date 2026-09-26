"""Importers for the user's own pixel art: animated GIF/PNG/JPEG/WebP (Pillow),
`.aseprite`/`.ase`, and `.piskel`. Pure modules (no `homeassistant` imports); each
module's `load(data: bytes) -> DecodedImage` decodes a whole file already read into
memory (the HA layer is responsible for size limits and running this off the event
loop). Output feeds directly into `adapt.adapt()`.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

if TYPE_CHECKING:  # pragma: no cover - typing only, Pillow imported lazily by callers
    from PIL.Image import Image


class DecodeError(ValueError):
    """Raised when a file cannot be decoded: corrupt data, unsupported variant, or a
    structurally invalid container. Never raised for merely unusual-but-valid content
    (e.g. a 1x1 image, a 0-frame-delay GIF) -- decode leniently, adapt.py deals with
    the pixels."""


@dataclass(frozen=True, slots=True)
class DecodedImage:
    """One decoded source image or animation, ready for `adapt.adapt()`.

    `frames`: one or more Pillow `Image` objects, every one mode "RGBA" and exactly the
    same `(width, height)` -- importers normalise this themselves (e.g. APNG frames that
    change size are composited onto the canvas) so `adapt.py` never has to.
    `delays_ms`: per-frame delay in milliseconds, `len(delays_ms) == len(frames)`; a
    still image is a single frame with delay `0`.
    """

    frames: list["Image"]
    delays_ms: list[int]

    def __post_init__(self) -> None:
        if not self.frames:
            raise DecodeError("DecodedImage must have at least one frame")
        if len(self.frames) != len(self.delays_ms):
            raise DecodeError(
                f"frames/delays_ms length mismatch: {len(self.frames)} vs {len(self.delays_ms)}"
            )
        size = self.frames[0].size
        for index, frame in enumerate(self.frames):
            if frame.size != size:
                raise DecodeError(
                    f"frame {index} size {frame.size} != frame 0 size {size}"
                )
            if frame.mode != "RGBA":
                raise DecodeError(f"frame {index} mode {frame.mode!r} != 'RGBA'")


def load_by_filename(filename: str, data: bytes) -> DecodedImage:
    """Dispatch to the right importer by `filename`'s extension (case-insensitive).
    Raises `DecodeError` for an unrecognised extension, or whatever the chosen
    importer itself raises for bad content."""
    from . import aseprite, gif, piskel

    suffix = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    modules = {
        "gif": gif, "png": gif, "jpg": gif, "jpeg": gif, "webp": gif,
        "ase": aseprite, "aseprite": aseprite,
        "piskel": piskel,
    }
    module = modules.get(suffix)
    if module is None:
        raise DecodeError(
            f"unsupported file extension {suffix!r}; expected one of {sorted(set(modules))}"
        )
    return module.load(data)
