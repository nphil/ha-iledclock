"""Screens A and B: which content the clock's second screen takes.

The clock's power button toggles between two screens and Bluetooth cannot choose one (there is no
"play screen N" command and nothing can be read back), so the only way to change a screen is to
upload into it. Which screen an upload lands in is decided by the kind byte of its start frame:

* **Screen A** = the program list (kind byte 00). Every Home Assistant show goes here by default,
  and `set_playlist` writes it.
* **Screen B** = the clock-page store (kind byte 04): the vendor's Clock tab writes clock, date and
  temperature/humidity pages there (program types 7, 6 and 19, trailer `04 01 <seconds>`).

Proven live (2026-10-01): a kind-04 date program replaced B and left A untouched. NOT proven: that B
takes art; `hardware.SLOT_B_ACCEPTS_ART` stays False until the slot-B art test says otherwise.

This module is pure (no `homeassistant` imports) so the policy is unit-testable on its own.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from . import hardware
from .const import CONTENT_CLASSES, DEFAULT_SLOT, SLOT_A, SLOT_B, SLOTS

#: Page types the vendor itself writes to the clock-page store.
_B_CLOCK_PAGES = ("clock", "date", "temperature", "humidity")


class SlotUnsupportedError(ValueError):
    """The chosen screen cannot take this content. The message is one user-presentable line."""


def check_slot(slot: str) -> str:
    """Return `slot` if it is a screen id, else raise ValueError."""
    if slot not in SLOTS:
        raise ValueError(f"unknown screen {slot!r}; choose one of {', '.join(SLOTS)}")
    return slot


def slot_accepts(slot: str) -> tuple[str, ...]:
    """Content classes (`const.CONTENT_CLASSES`) that `slot` takes right now. Reads the capability
    flags in `hardware` on every call, so flipping a flag takes effect without a restart."""
    check_slot(slot)
    if slot == SLOT_A:
        return CONTENT_CLASSES
    accepted = list(_B_CLOCK_PAGES)
    if hardware.SLOT_B_ACCEPTS_ART_WITH_CLOCK:
        accepted.append("art_clock")
    if hardware.SLOT_B_ACCEPTS_ART:
        accepted.append("art")
    return tuple(accepted)


def slot_unsupported_reason(slot: str, content_class: str) -> str | None:
    """One line saying why `slot` cannot take `content_class`, or None when it can."""
    if content_class not in CONTENT_CLASSES:
        raise ValueError(f"unknown content class {content_class!r}")
    if content_class in slot_accepts(slot):
        return None
    if content_class in ("timer", "scoreboard"):
        return "Timers and scoreboards only work on screen A."
    return "Screen B only takes clock, date and temperature pages for now; pictures go on screen A."


def require_slot_accepts(slot: str, content_class: str) -> None:
    """Raise `SlotUnsupportedError` unless `slot` takes `content_class`."""
    reason = slot_unsupported_reason(slot, content_class)
    if reason is not None:
        raise SlotUnsupportedError(reason)


#: Start-frame kind byte each screen's uploads carry: 00 = the program list, 04 = the clock-page store.
_WIRE_KINDS = {SLOT_A: 0, SLOT_B: 4}

#: What each show type is, for deciding whether a screen takes it. A saved design is decided by whether it has a
#: firmware clock beside its art (`content_class_of`).
_SHOW_TYPE_CLASSES = {
    "clock": "clock",
    "date": "date",
    "temperature": "temperature",
    "humidity": "humidity",
    "timer": "timer",
    "scoreboard": "scoreboard",
    "text": "art",
    "image": "art",
    "generative": "art",
}


def wire_kind(slot: str) -> int:
    """The start-frame kind byte of `slot`'s uploads (0 for screen A, 4 for screen B)."""
    return _WIRE_KINDS[check_slot(slot)]


def content_class_of(show_type: str, *, has_clock_region: bool = False) -> str:
    """The content class (`const.CONTENT_CLASSES`) of a show type (`clock`, `date`, `text`, `image`, `design`, ...).
    A `design` is `art_clock` when it has a firmware clock region, else `art`. Raises ValueError for an unknown type."""
    if show_type == "design":
        return "art_clock" if has_clock_region else "art"
    if not isinstance(show_type, str) or show_type not in _SHOW_TYPE_CLASSES:
        raise ValueError(f"unsupported show type: {show_type!r}")
    return _SHOW_TYPE_CLASSES[show_type]


def require_screen_a_for_timed_show(slot: str) -> None:
    """A show that puts the earlier content back after some seconds (`show_text` with a duration) needs the
    program list to come back to, which only screen A has."""
    if check_slot(slot) != SLOT_A:
        raise SlotUnsupportedError("A message that goes away by itself only works on screen A.")


def descriptor_slot(descriptor: Mapping[str, Any]) -> str:
    """The screen a show descriptor was written to. Descriptors stored before screens existed have no `slot`
    and count as screen A."""
    slot = descriptor.get("slot")
    return slot if slot in SLOTS else DEFAULT_SLOT


def upgrade_text_fields(fields: Mapping[str, Any]) -> dict[str, Any]:
    """The fields of a text show saved before text was drawn as pixels, in today's words: their `speed` was the
    old 0-255 wire speed of the clock's own text engine, which means nothing as a playback speed, so it is dropped
    (the text plays at its own pace), and `color_mode` is now `effect`. Always returns a new dict."""
    upgraded = dict(fields)
    upgraded.pop("speed", None)
    if "color_mode" in upgraded:
        upgraded.setdefault("effect", upgraded.pop("color_mode"))
    return upgraded


def upgrade_descriptor(descriptor: dict[str, Any]) -> dict[str, Any]:
    """A stored show descriptor in today's vocabulary. Only text shows from before screens existed (no `slot`
    key) differ (`upgrade_text_fields`). Returns `descriptor` itself when nothing changes."""
    if "slot" in descriptor or descriptor.get("kind") != "text":
        return descriptor
    upgraded = upgrade_text_fields(descriptor)
    return upgraded if upgraded != descriptor else descriptor
