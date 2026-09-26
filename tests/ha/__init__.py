"""Real-Home-Assistant tests for iLedClock's HA-glue modules.

Everything else under `tests/` exercises pure logic; this package runs the modules that only
make sense inside a real `homeassistant` (config flow, entry setup, entity platforms, the
websocket API, services, the gallery media view, diagnostics) against a scripted fake clock --
see `fake_clock.py` and `conftest.py`.
"""
