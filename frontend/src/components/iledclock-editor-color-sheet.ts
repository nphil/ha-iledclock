import { LitElement, css, html } from "lit";
import { TOKENS_CSS, SURFACES_CSS } from "../styles/tokens.ts";
import { hexToRgb, quantizePreviewRgb, rgbToCss, rgbToHex, type RGB } from "../lib/color.ts";
import "./lu-sheet.ts";

const NIBBLE_COLORS: readonly (readonly [number, number, number])[] = [
  [15, 15, 15], [10, 10, 10], [5, 5, 5], [0, 0, 0],
  [15, 0, 0], [15, 5, 0], [15, 10, 0], [10, 5, 0],
  [15, 15, 0], [10, 15, 0], [5, 15, 0], [0, 15, 0],
  [0, 15, 10], [0, 15, 15], [0, 10, 15], [0, 5, 15],
  [0, 0, 15], [5, 0, 15], [10, 0, 15], [15, 0, 15],
  [15, 0, 10], [15, 5, 5], [10, 10, 15], [5, 10, 15],
];

/** Curated swatches use input values that map to exact RGB444 outputs on the editor's curved path. */
function rawChannelForNibble(nibble: number): number {
  if (nibble === 0) return 0;
  if (nibble === 15) return 238;
  return 47 + (nibble - 1) * 14 + 7;
}
export const RGB444_SWATCHES: readonly RGB[] = NIBBLE_COLORS.map(([r, g, b]) => [rawChannelForNibble(r), rawChannelForNibble(g), rawChannelForNibble(b)]);

export class IledclockEditorColorSheet extends LitElement {
  static properties = {
    open: { type: Boolean },
    color: { attribute: false },
    recent: { attribute: false },
  };

  declare open: boolean;
  declare color: RGB;
  declare recent: RGB[];

  constructor() {
    super();
    this.open = false;
    this.color = [255, 255, 255];
    this.recent = [];
  }

  private _pick(color: RGB): void {
    this.dispatchEvent(new CustomEvent("color-selected", { detail: { color }, bubbles: true, composed: true }));
  }

  render() {
    const uniqueRecent = this.recent.filter((color, index, colors) => colors.findIndex((item) => item.join(",") === color.join(",")) === index);
    return html`<lu-sheet .open=${this.open} label="Choose drawing colour" @closed=${() => { this.open = false; this.dispatchEvent(new CustomEvent("close-requested", { bubbles: true, composed: true })); }}>
      <div class="body">
        <label class="picker-row">
          <span>Custom colour</span>
          <input type="color" aria-label="Custom drawing colour" .value=${rgbToHex(this.color)} @input=${(event: Event) => this._pick(hexToRgb((event.target as HTMLInputElement).value))}>
        </label>
        <section aria-labelledby="palette-title">
          <h3 id="palette-title">LED-safe palette</h3>
          <div class="swatches" role="group" aria-label="RGB444 colour palette">
            ${RGB444_SWATCHES.map((color) => html`<button type="button" class="swatch" style=${`--swatch: ${rgbToCss(quantizePreviewRgb(color))}`} aria-label=${rgbToHex(quantizePreviewRgb(color))} aria-pressed=${String(color.join(",") === this.color.join(","))} @click=${() => this._pick(color)}></button>`)}
          </div>
        </section>
        ${uniqueRecent.length ? html`<section aria-labelledby="recent-title"><h3 id="recent-title">Recent colours</h3><div class="swatches" role="group" aria-label="Recent colours">${uniqueRecent.map((color) => html`<button type="button" class="swatch" style=${`--swatch: ${rgbToCss(quantizePreviewRgb(color))}`} aria-label=${`Recent ${rgbToHex(quantizePreviewRgb(color))}`} @click=${() => this._pick(color)}></button>`)}</div></section>` : html`<p class="hint">Your selected colours will appear here.</p>`}
      </div>
    </lu-sheet>`;
  }

  static styles = [TOKENS_CSS, SURFACES_CSS, css`
    :host { display: block; }
    .body { display: grid; gap: var(--lu-space-4); }
    section { display: grid; gap: var(--lu-space-2); }
    h3 { margin: 0; color: var(--lu-ink-2); font: 600 var(--lu-type-label)/1.2 var(--lu-font); }
    .picker-row { display: flex; align-items: center; justify-content: space-between; gap: var(--lu-space-3); min-height: var(--lu-target); color: var(--lu-ink); font: 500 var(--lu-type-body)/1.3 var(--lu-font); }
    input[type=color] { width: var(--lu-target); height: var(--lu-target); border: 1px solid var(--lu-edge); border-radius: var(--lu-radius-control); padding: var(--lu-space-1); background: var(--lu-card); cursor: pointer; }
    .swatches { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: var(--lu-space-1); }
    .swatch { min-width: var(--lu-target); min-height: var(--lu-target); border: 1px solid var(--lu-edge); border-radius: var(--lu-radius-control); background: var(--swatch); cursor: pointer; box-shadow: inset 0 1px 0 color-mix(in srgb, var(--lu-ink) 18%, transparent); }
    .swatch[aria-pressed="true"] { outline: 2px solid var(--lu-accent); outline-offset: 2px; }
    .hint { margin: 0; color: var(--lu-ink-3); font: 400 var(--lu-type-caption)/1.4 var(--lu-font); }
    button:focus-visible, input:focus-visible { outline: 2px solid var(--lu-accent); outline-offset: 2px; }
  `];
}

customElements.define("iledclock-editor-color-sheet", IledclockEditorColorSheet);

declare global { interface HTMLElementTagNameMap { "iledclock-editor-color-sheet": IledclockEditorColorSheet; } }
