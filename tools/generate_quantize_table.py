"""Regenerates the RGB888->nibble quantisation golden fixture from `hardware.py`, so the
TypeScript port in `frontend/src/lib/color.ts` can never silently drift from the Python source
of truth. Writes every quantisable `ContentPath`'s full 256-entry `encode_channel(v, path)`
table (curved `rgb444_transfer` paths and linear `v // 16` paths alike) plus the two path sets
themselves, so `tests/frontend/color.test.ts` can assert equality against real numbers instead
of re-deriving the formula in TypeScript and merely checking it against itself.

Pure stdlib, no network access, no randomness -- running this script twice produces a
byte-identical JSON file (sorted keys, fixed indentation), exactly like `tools/render_brand.py`'s
own determinism guarantee.

Usage (from the repository root):

    python3 tools/generate_quantize_table.py

Writes `tests/frontend/fixtures/quantize-table.json`.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
INTEGRATION_DIR = REPO_ROOT / "custom_components" / "iledclock"
FIXTURE_PATH = REPO_ROOT / "tests" / "frontend" / "fixtures" / "quantize-table.json"

# `hardware.py` promises to stay pure (no `homeassistant` import), but its *package*
# `__init__.py` does depend on `homeassistant` -- so, exactly like `tests/hardware/__init__.py`,
# import it as a top-level module with `custom_components/iledclock/` on `sys.path` rather than
# via its normal dotted package path.
if str(INTEGRATION_DIR) not in sys.path:
    sys.path.insert(0, str(INTEGRATION_DIR))

import hardware  # noqa: E402  (must follow the sys.path fixup above)


def build_table() -> dict[str, object]:
    quantizable_paths = sorted(hardware.CURVED_PATHS | hardware.LINEAR_PATHS)
    channels = {path: [hardware.encode_channel(v, path) for v in range(256)] for path in quantizable_paths}
    return {
        "curved_paths": sorted(hardware.CURVED_PATHS),
        "linear_paths": sorted(hardware.LINEAR_PATHS),
        "channels": channels,
    }


def main() -> None:
    table = build_table()
    FIXTURE_PATH.parent.mkdir(parents=True, exist_ok=True)
    FIXTURE_PATH.write_text(json.dumps(table, indent=2, sort_keys=True) + "\n")
    print(f"Wrote {FIXTURE_PATH.relative_to(REPO_ROOT)} ({len(table['channels'])} content paths x 256 values)")


if __name__ == "__main__":
    main()
