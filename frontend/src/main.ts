/** Bundle entry point: importing each module registers its custom element(s) as a side effect
 * (`customElements.define(...)` at the bottom of every component file), exactly like the
 * reference Kibble card's own `kibble-card.ts` entry. This file adds no logic of its own.
 */

import "./components/iledclock-matrix-canvas.ts";
import "./components/iledclock-segmented-picker.ts";
import "./components/iledclock-stepper.ts";
import "./components/iledclock-hold-button.ts";
import "./components/iledclock-settings-sheet.ts";
import "./components/iledclock-card-editor.ts";
import "./components/iledclock-card.ts";
import "./components/iledclock-pixel-editor.ts";
import "./components/iledclock-frame-timeline.ts";
import "./components/iledclock-library-panel.ts";
import "./components/iledclock-playlist-editor.ts";
import "./components/iledclock-studio-panel.ts";
