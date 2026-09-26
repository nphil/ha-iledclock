"""Test-only setup: makes `custom_components.iledclock`'s pure modules importable through
their normal package-relative imports, without ever executing the real
`custom_components/iledclock/__init__.py` (which imports `homeassistant`, deliberately not
installed in this repo). Same approach as `tests/integration/__init__.py`; see that
module's docstring for the full rationale.

`custom_components.iledclock.gallery` gets the same treatment as `iledclock` itself:
its real `__init__.py` is the thin HA WS/HTTP layer (imports `homeassistant`), while
every source/decoder/cache/adapt module tests import is pure. Stubbing the `gallery`
package too means `from custom_components.iledclock.gallery import lametric` resolves
`lametric` as a submodule via the stub's `__path__` without ever executing that real
`__init__.py`.
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
_stub_package("custom_components.iledclock.gallery", _PKG_DIR / "gallery")
