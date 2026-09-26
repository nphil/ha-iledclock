"""Protocol test package (Contract A).

``custom_components/iledclock/__init__.py`` imports ``homeassistant`` (a real dependency of
the *integration*, correctly so -- Contract A only promises ``protocol/`` itself stays pure).
Importing anything under ``custom_components.iledclock.protocol`` via its normal dotted path
would therefore first execute that package ``__init__.py`` and fail here, where
``homeassistant`` is deliberately not installed. Every test in this package instead imports
the protocol package as a *top-level* ``protocol`` module by pointing ``sys.path`` directly at
``custom_components/iledclock/`` (its parent directory) -- below its own parent
(``custom_components/iledclock``), never at ``custom_components/iledclock`` itself, so
``custom_components.iledclock``'s ``__init__.py`` is never imported. Relative imports inside
``protocol/*.py`` (``from . import hexutil``, ...) work identically either way, since they
resolve relative to whatever package they end up loaded under.
"""

from __future__ import annotations

import sys
from pathlib import Path

_INTEGRATION_DIR = Path(__file__).resolve().parents[2] / "custom_components" / "iledclock"
if str(_INTEGRATION_DIR) not in sys.path:
    sys.path.insert(0, str(_INTEGRATION_DIR))
