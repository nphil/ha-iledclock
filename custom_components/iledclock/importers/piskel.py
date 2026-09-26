"""`.piskel` import: the JSON project format written by the Piskel pixel-art editor
(piskelapp.com).

Two things about this format are non-obvious and easy to get backwards, both verified
against a real sample (`test_example.piskel` from github.com/rostislavjadavan/go-piskel)
and that repo's own `types.go`/`loader.go` reference implementation:

1. `piskel.layers` is a list of **strings**, not objects -- each entry is itself a
   complete JSON document (a layer object) that has been serialized a second time into a
   string and embedded in the outer document. It must be `json.loads()`-ed again to get
   at `name`/`opacity`/`frameCount`/`chunks`.
2. Each chunk's `layout` is indexed `layout[col][row]`: the *outer* list runs along the
   spritesheet's X axis (columns) and the *inner* list along its Y axis (rows). A real
   16x16-canvas 2-frame layer had `layout=[[0],[1]]` (2 columns, 1 row each) and its
   spritesheet PNG decoded to exactly 32x16 pixels -- two 16x16 tiles side by side on X,
   frame 0 at box (0,0,16,16) and frame 1 at box (16,0,32,16). Reading `layout[row][col]`
   instead silently transposes single-row/single-column layouts wrong.

A layer's frames may be split across multiple chunks (Piskel does this to keep any one
spritesheet PNG under a size threshold); `layout` values are always absolute frame
indices into that layer's own frame range, never chunk-relative, so all of a layer's
chunks are merged into one frame-index -> tile map before compositing starts.
"""

from __future__ import annotations

import base64
import io
import json

from . import DecodeError, DecodedImage

#: Sanity ceiling on total frame count -- guards against a corrupt/fuzzed
#: `frameCount` (e.g. claiming 10**9 frames) driving an unbounded compositing loop.
#: `adapt.py`'s own decimation handles the normal "too many frames for the device" case.
_MAX_FRAMES = 4096


def load(data: bytes) -> DecodedImage:
    """Decode `data` (the raw bytes of a `.piskel` file) into a `DecodedImage`."""
    from PIL import Image, UnidentifiedImageError

    try:
        doc = json.loads(data.decode("utf-8"))
    except UnicodeDecodeError as err:
        raise DecodeError(f"not valid utf-8: {err}") from err
    except json.JSONDecodeError as err:
        raise DecodeError(f"not valid JSON: {err}") from err

    if not isinstance(doc, dict) or not isinstance(doc.get("piskel"), dict):
        raise DecodeError("missing top-level 'piskel' object")
    piskel = doc["piskel"]

    try:
        width = int(piskel["width"])
        height = int(piskel["height"])
        fps = float(piskel["fps"])
    except (KeyError, TypeError, ValueError) as err:
        raise DecodeError(f"missing/invalid width/height/fps: {err}") from err
    if width <= 0 or height <= 0:
        raise DecodeError(f"invalid canvas size {width}x{height}")
    if fps <= 0:
        raise DecodeError(f"invalid fps {fps!r}")

    raw_hidden = piskel.get("hiddenFrames")
    if raw_hidden is None:
        hidden_frames: set[int] = set()
    elif isinstance(raw_hidden, list):
        hidden_frames = set(raw_hidden)
    else:
        raise DecodeError("'hiddenFrames' is not a list")

    raw_layers = piskel.get("layers") or []
    if not isinstance(raw_layers, list):
        raise DecodeError("'layers' is not a list")

    def scale_alpha(tile, opacity: float):
        if opacity >= 1.0:
            return tile
        red, green, blue, alpha = tile.split()
        factor = max(0.0, opacity)
        alpha = alpha.point(lambda v: min(255, max(0, round(v * factor))))
        return Image.merge("RGBA", (red, green, blue, alpha))

    # Decode each layer into (opacity, {frame_index: tile}), tracking the overall frame
    # count as the largest frameCount declared by any layer.
    layer_tiles: list[tuple[float, dict[int, "Image.Image"]]] = []
    total_frames = 1
    for raw_layer in raw_layers:
        if not isinstance(raw_layer, str):
            raise DecodeError("layer entry is not a JSON-encoded string")
        try:
            layer = json.loads(raw_layer)
        except json.JSONDecodeError as err:
            raise DecodeError(f"layer is not valid JSON: {err}") from err
        if not isinstance(layer, dict):
            raise DecodeError("decoded layer is not an object")

        try:
            opacity = float(layer["opacity"])
            frame_count = int(layer["frameCount"])
        except (KeyError, TypeError, ValueError) as err:
            raise DecodeError(f"invalid layer opacity/frameCount: {err}") from err
        if frame_count < 0:
            raise DecodeError(f"invalid layer frameCount {frame_count}")

        chunks = layer.get("chunks") or []
        if not isinstance(chunks, list):
            raise DecodeError("layer 'chunks' is not a list")

        tiles: dict[int, "Image.Image"] = {}
        for chunk in chunks:
            if not isinstance(chunk, dict):
                raise DecodeError("chunk is not an object")
            layout = chunk.get("layout")
            if not isinstance(layout, list):
                raise DecodeError("chunk 'layout' is not a list")
            raw_png = chunk.get("base64PNG")
            if not isinstance(raw_png, str):
                raise DecodeError("chunk missing 'base64PNG'")

            if raw_png.startswith("data:"):
                comma = raw_png.find(",")
                if comma == -1:
                    raise DecodeError("malformed data: URI in 'base64PNG'")
                payload = raw_png[comma + 1 :]
            else:
                payload = raw_png

            try:
                png_bytes = base64.b64decode(payload)
            except ValueError as err:
                raise DecodeError(f"invalid base64 spritesheet: {err}") from err
            try:
                sheet = Image.open(io.BytesIO(png_bytes))
                sheet.load()
                sheet = sheet.convert("RGBA")
            except (UnidentifiedImageError, OSError, ValueError) as err:
                raise DecodeError(f"invalid spritesheet PNG: {err}") from err
            sheet_w, sheet_h = sheet.size

            for col, column in enumerate(layout):
                if not isinstance(column, list):
                    raise DecodeError("layout column is not a list")
                for row, frame_index in enumerate(column):
                    if frame_index is None:
                        continue
                    if not isinstance(frame_index, int) or isinstance(frame_index, bool):
                        continue
                    if frame_index < 0 or frame_index >= frame_count:
                        continue
                    box = (
                        col * width,
                        row * height,
                        (col + 1) * width,
                        (row + 1) * height,
                    )
                    if box[2] > sheet_w or box[3] > sheet_h:
                        raise DecodeError(
                            f"layout cell ({col},{row}) exceeds spritesheet bounds"
                        )
                    tiles[frame_index] = sheet.crop(box)

        layer_tiles.append((opacity, tiles))
        total_frames = max(total_frames, frame_count)

    if total_frames > _MAX_FRAMES:
        raise DecodeError(f"frame count {total_frames} exceeds max {_MAX_FRAMES}")

    frames: list["Image.Image"] = []
    for index in range(total_frames):
        if index in hidden_frames:
            continue
        canvas = Image.new("RGBA", (width, height), (0, 0, 0, 0))
        for opacity, tiles in layer_tiles:
            tile = tiles.get(index)
            if tile is None:
                continue
            canvas = Image.alpha_composite(canvas, scale_alpha(tile, opacity))
        frames.append(canvas)

    delay = round(1000 / fps)
    delays_ms = [delay] * len(frames)

    return DecodedImage(frames=frames, delays_ms=delays_ms)
