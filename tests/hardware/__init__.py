"""Hardware capability-profile test package.

``custom_components/iledclock/__init__.py`` imports ``homeassistant`` (a real dependency of
the *integration*, correctly so -- ``hardware.py`` itself promises to stay pure, exactly
like ``protocol/``). Importing anything under ``custom_components.iledclock.hardware`` via
its normal dotted path would therefore first execute that package ``__init__.py`` and fail
here, where ``homeassistant`` is deliberately not installed. Every test in this package
instead imports ``hardware`` as a *top-level* module by pointing ``sys.path`` directly at
``custom_components/iledclock/`` (its parent directory) -- exactly the same trick
``tests/protocol/__init__.py`` uses, for the same reason.
"""

from __future__ import annotations

import sys
from pathlib import Path

_INTEGRATION_DIR = Path(__file__).resolve().parents[2] / "custom_components" / "iledclock"
if str(_INTEGRATION_DIR) not in sys.path:
    sys.path.insert(0, str(_INTEGRATION_DIR))
