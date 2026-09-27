"""Regenerates `custom_components/iledclock/clock_backgrounds.py`, the bundled 32x16 background
animation the vendor app pairs with every firmware clock style (`ic_clock_style_bg{N}_1632_
iledclock.gif`, styles 1-41) and with the date companion screen (`ic_clock_style_date_bg_1632_
iledclock.gif`, one shared background for every style) -- see
`ILedClockClockTimeActivity.java`'s `CLockStyleItem` constructor calls (`clockBgImageId`/
`dateBgImageId`) and `ILedClockClockTimeFragment.getClockCombineProgram` (lines ~1170-1216),
which layer this animation as a full-panel `ILedClockAnimationProgramContent` *underneath* the
live clock/date digits for every style -- our own upload only ever sent the bare digits.

Each background GIF plays at one uniform per-frame delay (confirmed by inspecting every
style's actual frame delays: each style's own frames all share a single duration, matching the
vendor's `DecoderAnimationItem.speed` -- a single int, not a per-frame list, for a resource-
backed animation). Frames are stored zlib-compressed (simple flat-colour/gradient LED art
compresses ~38x) as raw row-major RGB888, concatenated per style, so the generated module stays
small and dependency-free at import time (stdlib `zlib` only -- Pillow, needed to *read* the
source GIFs, is a generation-time-only dependency of this script, not of the integration).

Pure stdlib beyond Pillow, no network access; running this script twice against the same source
GIFs produces a byte-identical module (styles emitted in sorted order, fixed repr formatting).

Usage (from the repository root, with the decompiled vendor assets extracted somewhere):

    python3 tools/generate_clock_backgrounds.py --src /data/home/tmp/faces

Writes `custom_components/iledclock/clock_backgrounds.py`. `--src` defaults to
`/data/home/tmp/faces` (where this repo's reverse-engineering session extracted the vendor
APK's `ic_clock_style_bg*_1632_iledclock.gif`/`ic_clock_style_date_bg_1632_iledclock.gif`
drawables); that directory is a scratch extraction, not part of this repo, so this script is
not expected to run in CI -- like `clock_styles.py`, the *generated output* is what's committed.
"""

from __future__ import annotations

import argparse
import sys
import zlib
from pathlib import Path

try:
    from PIL import Image
except ImportError:  # pragma: no cover - generation-time-only dependency
    print("This script needs Pillow: pip install Pillow", file=sys.stderr)
    raise

REPO_ROOT = Path(__file__).resolve().parent.parent
OUTPUT_PATH = REPO_ROOT / "custom_components" / "iledclock" / "clock_backgrounds.py"
DEFAULT_SRC = Path("/data/home/tmp/faces")
WIDTH = 32
HEIGHT = 16
STYLE_MIN = 1
STYLE_MAX = 41


def _read_gif_frames(path: Path) -> tuple[list[bytes], list[int]]:
    """Every frame as raw row-major RGB888 bytes (matching `protocol.models.Frame.pixels`'
    flattened layout) plus each frame's own GIF delay in ms. Pillow composites disposal methods
    correctly across `.seek()`, so this is the true rendered frame, not a raw sub-rectangle."""
    with Image.open(path) as im:
        if im.size != (WIDTH, HEIGHT):
            raise ValueError(f"{path.name}: expected {WIDTH}x{HEIGHT}, got {im.size[0]}x{im.size[1]}")
        frame_count = getattr(im, "n_frames", 1)
        frames: list[bytes] = []
        delays: list[int] = []
        for index in range(frame_count):
            im.seek(index)
            frames.append(im.convert("RGB").tobytes())
            delays.append(int(im.info.get("duration") or 0))
    return frames, delays


def _uniform_delay(path: Path, delays: list[int]) -> int:
    """Every style's background plays at one constant per-frame delay on the real device
    (`ILedClockAnimationProgramContent.speed`, a single int -- see module docstring); a still
    (1-frame) background's own GIF delay is frequently 0 (meaningless for a single frame,
    since there's nothing to advance to), so fall back to a sane default instead of encoding a
    0ms wire delay."""
    distinct = sorted(set(delays))
    if len(distinct) > 1:
        raise ValueError(f"{path.name}: expected one uniform frame delay, found {distinct}")
    delay = distinct[0] if distinct else 0
    return delay if delay > 0 else 200


def _compress(frames: list[bytes]) -> bytes:
    return zlib.compress(b"".join(frames), level=9)


def _format_bytes_literal(data: bytes) -> str:
    return repr(data)


def _emit_entry(name: str, frame_count: int, delay_ms: int, blob: bytes) -> str:
    return (
        f"    {name}: ({frame_count}, {delay_ms}, {_format_bytes_literal(blob)}),\n"
    )


def build_module(src: Path) -> str:
    style_lines = []
    for style in range(STYLE_MIN, STYLE_MAX + 1):
        path = src / f"ic_clock_style_bg{style}_1632_iledclock.gif"
        if not path.exists():
            raise FileNotFoundError(f"missing vendor background asset: {path}")
        frames, delays = _read_gif_frames(path)
        delay_ms = _uniform_delay(path, delays)
        style_lines.append(_emit_entry(str(style), len(frames), delay_ms, _compress(frames)))

    date_path = src / "ic_clock_style_date_bg_1632_iledclock.gif"
    if not date_path.exists():
        raise FileNotFoundError(f"missing vendor date background asset: {date_path}")
    date_frames, date_delays = _read_gif_frames(date_path)
    date_delay_ms = _uniform_delay(date_path, date_delays)
    date_count = len(date_frames)
    date_blob = _compress(date_frames)

    styles_block = "".join(style_lines)
    return f'''"""Bundled 32x16 background animations the vendor app pairs with every firmware clock
style, plus the shared date-companion background -- so our own uploads can layer a background
under the clock/date digits exactly like the vendor app does, instead of sending bare digits on
a blank panel.

Source: the vendor APK's `ic_clock_style_bg{{N}}_1632_iledclock.gif` (N=1-{STYLE_MAX}, one full
32x16 animation per firmware clock style -- see `clock_styles.py` for that style's digit
geometry) and `ic_clock_style_date_bg_1632_iledclock.gif` (one background shared by every
style's date-companion screen). See `ILedClockClockTimeFragment.getClockCombineProgram`
(~line 1170: `if (cLockStyleItem.clockBgImageId > 0) {{ ... }}`, ~line 1201 for the date
counterpart): the vendor always layers this animation as a full-panel (`startRow=0,
startColumn=0, showWidth=DEVICE_COLUMN, showHeight=DEVICE_ROW`) `ILedClockAnimationProgramContent`
*before* (underneath) the clock/date digit layer in the same combine-program.

Frames are zlib-compressed raw row-major RGB888 (`protocol.models.Frame.pixels`' flattened
layout), concatenated per style/date, decompressed once at import time. `delay_ms` is the one
uniform per-frame delay the vendor's own `DecoderAnimationItem.speed` field carries for a
resource-backed animation (confirmed: every style's own GIF frames share a single delay).

Generated by tools/generate_clock_backgrounds.py from the decompiled vendor APK's drawables;
do not hand-edit -- regenerate instead.
"""
from __future__ import annotations

import zlib
from typing import NamedTuple

from .const import DISPLAY_HEIGHT, DISPLAY_WIDTH

_FRAME_BYTES = DISPLAY_WIDTH * DISPLAY_HEIGHT * 3


class ClockBackground(NamedTuple):
    width: int
    height: int
    delay_ms: int
    frames: tuple[bytes, ...]


def _inflate(frame_count: int, delay_ms: int, blob: bytes) -> ClockBackground:
    raw = zlib.decompress(blob)
    frames = tuple(raw[i * _FRAME_BYTES : (i + 1) * _FRAME_BYTES] for i in range(frame_count))
    return ClockBackground(width=DISPLAY_WIDTH, height=DISPLAY_HEIGHT, delay_ms=delay_ms, frames=frames)


#: (frame_count, delay_ms, zlib-compressed concatenated RGB888 frames), keyed by clock style.
_COMPRESSED_STYLES: dict[int, tuple[int, int, bytes]] = {{
{styles_block}}}

#: Shared by the date-companion screen for every style (vendor: one `dateBgImageId` resource).
_COMPRESSED_DATE: tuple[int, int, bytes] = ({date_count}, {date_delay_ms}, {_format_bytes_literal(date_blob)})

CLOCK_BACKGROUNDS: dict[int, ClockBackground] = {{
    style: _inflate(*entry) for style, entry in _COMPRESSED_STYLES.items()
}}
DATE_BACKGROUND: ClockBackground = _inflate(*_COMPRESSED_DATE)
'''


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--src", type=Path, default=DEFAULT_SRC, help="directory with the extracted vendor GIFs")
    args = parser.parse_args()

    module_source = build_module(args.src)
    OUTPUT_PATH.write_text(module_source)
    style_count = STYLE_MAX - STYLE_MIN + 1
    print(f"Wrote {OUTPUT_PATH.relative_to(REPO_ROOT)} ({style_count} clock styles + 1 date background)")


if __name__ == "__main__":
    main()
