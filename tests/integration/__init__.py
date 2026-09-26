"""Test-only setup: makes `custom_components.iledclock`'s pure modules importable through their
normal package-relative imports, without ever executing the real
`custom_components/iledclock/__init__.py` -- which, like every Home Assistant integration's,
imports `homeassistant` at module level, and `homeassistant` is deliberately not installed in
this repo (see the project's own constraints: HA-dependent modules stay thin, logic lives in
pure modules tested here).

This installs two bare stand-in package objects into `sys.modules` -- `custom_components` and
`custom_components.iledclock` -- each carrying only a `__path__` that points at the real
directory. Python's import machinery only ever needs a parent package's `__path__` to resolve
`from .const import ...`-style relative imports and to locate a submodule by dotted name; it
never needs that parent's own `__init__.py` to have actually run to do either. So any test file
in this package can just write `from custom_components.iledclock import state` (or `playlist`,
`options`, `designs`, `chunking`, `ws_shapes`, ...) and get the real module, with its own
`.const`/`.designs`/... imports resolved exactly as they are inside Home Assistant -- while
`iledclock/__init__.py` (and anything else that imports `homeassistant` or `bleak`) is never
touched by these tests.
"""

from __future__ import annotations

import sys
import types
from pathlib import Path

_PKG_DIR = Path(__file__).resolve().parents[2] / "custom_components" / "iledclock"


def _stub_package(name: str, path: Path) -> None:
    if name in sys.modules:
        return
    module = types.ModuleType(name)
    module.__path__ = [str(path)]  # type: ignore[attr-defined]
    sys.modules[name] = module


_stub_package("custom_components", _PKG_DIR.parent)
_stub_package("custom_components.iledclock", _PKG_DIR)
