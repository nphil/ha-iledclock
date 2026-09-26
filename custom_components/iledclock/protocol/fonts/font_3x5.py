"""Original compact 3x5 pixel font -- digits and a minimal punctuation set, for small badges
and tight layouts (e.g. a temperature/humidity value squeezed next to its icon). Uppercase
letters map to a simple blocky shape; not every character is legible at this size, which is
an inherent 3x5 limitation, not a font bug. See the ``fonts`` package docstring."""

from __future__ import annotations

_ROWS: dict[str, tuple[str, ...]] = {
    " ": ("...", "...", "...", "...", "..."),
    "-": ("...", "...", "###", "...", "..."),
    ".": ("...", "...", "...", "...", ".#."),
    ":": (".#.", "...", "...", ".#.", "..."),
    "0": ("###", "#.#", "#.#", "#.#", "###"),
    "1": (".#.", "##.", ".#.", ".#.", "###"),
    "2": ("###", "..#", "###", "#..", "###"),
    "3": ("###", "..#", "###", "..#", "###"),
    "4": ("#.#", "#.#", "###", "..#", "..#"),
    "5": ("###", "#..", "###", "..#", "###"),
    "6": ("###", "#..", "###", "#.#", "###"),
    "7": ("###", "..#", "..#", "..#", "..#"),
    "8": ("###", "#.#", "###", "#.#", "###"),
    "9": ("###", "#.#", "###", "..#", "###"),
    "%": ("#.#", "..#", ".#.", "#..", "#.#"),
    "\u00b0": (".#.", "#.#", ".#.", "...", "..."),  # degree sign
}

FONT_3X5 = {
    char: tuple(
        tuple(rows[row][col] == "#" for row in range(len(rows))) for col in range(len(rows[0]))
    )
    for char, rows in _ROWS.items()
}
for _char in list(FONT_3X5):
    if _char.isupper() and _char.isalpha():
        FONT_3X5[_char.lower()] = FONT_3X5[_char]
