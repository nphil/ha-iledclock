import { LitElement, css, html, nothing } from "lit";
import { TOKENS_CSS, SURFACES_CSS } from "../styles/tokens.ts";
import { hexToRgb, quantizePreviewRgb, rgbToCss, rgbToHex, type RGB } from "../lib/color.ts";
import { RGB444_SWATCHES } from "./iledclock-editor-color-sheet.ts";

export class IledclockEditorInspector extends LitElement {
  static properties = {
    activeColor: { attribute: false },
    recentColors: { attribute: false },
    brushSize: { type: Number, attribute: "brush-size" },
    onionSkin: { type: Boolean, attribute: "onion-skin" },
    frameDelay: { type: Number, attribute: "frame-delay" },
    clockRegion: { type: Boolean, attribute: "clock-region" },
  };

  declare activeColor: RGB;
  declare recentColors: RGB[];
  declare brushSize: number;
  declare onionSkin: boolean;
  declare frameDelay: number;
  declare clockRegion: boolean;

  constructor() {
    super();
    this.activeColor = [255, 255, 255];
    this.recentColors = [];
    this.brushSize = 1;
    this.onionSkin = true;
    this.frameDelay = 100;
    this.clockRegion = false;
  }

  private _send(name: string, detail: Record<string, unknown>): void {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }

  private _pick(color: RGB): void { this._send("inspector-color-picked", { color }); }

  private _renderSwatch(color: RGB, label: string) {
    const shown = quantizePreviewRgb(color);
    const active = shown.join(",") === quantizePreviewRgb(this.activeColor).join(",");
    return html`<button type="button" class="swatch" style=${`--swatch: ${rgbToCss(shown)}`} aria-label=${label} aria-pressed=${String(active)} @click=${() => this._pick(color)}></button>`;
  }

  render() {
    const recents = this.recentColors.slice(0, 10);
    return html`<aside class="panel" aria-label="Editor inspector">
      <h2>Inspector</h2>
      <section aria-labelledby="colour-heading">
        <div class="section-heading"><h3 id="colour-heading">Colour</h3><button type="button" class="current-color" style=${`--swatch: ${rgbToCss(quantizePreviewRgb(this.activeColor))}`} aria-label="Open colour sheet" @click=${() => this._send("inspector-color-requested", {})}></button></div>
        <div class="swatches" role="group" aria-label="RGB444-safe colour palette">${RGB444_SWATCHES.map((color) => this._renderSwatch(color, `Colour ${rgbToHex(quantizePreviewRgb(color))}`))}</div>
        ${recents.length ? html`<h4>Recent</h4><div class="swatches recent" role="group" aria-label="Recent colours">${recents.map((color, index) => this._renderSwatch(color, `Recent colour ${index + 1}`))}</div>` : nothing}
        <label class="native-picker"><span>Custom colour</span><input type="color" aria-label="Custom drawing colour" .value=${rgbToHex(quantizePreviewRgb(this.activeColor))} @input=${(event: Event) => this._pick(hexToRgb((event.target as HTMLInputElement).value))}></label>
      </section>
      <section aria-labelledby="brush-heading"><h3 id="brush-heading">Brush size</h3><div class="segmented" role="group" aria-label="Brush size">${[1, 2, 3].map((size) => html`<button type="button" aria-pressed=${String(this.brushSize === size)} @click=${() => this._send("inspector-brush-changed", { size })}>${size}px</button>`)}</div></section>
      <section aria-labelledby="frame-heading"><h3 id="frame-heading">Frame</h3><label class="delay-label"><span>Delay</span><span class="delay-control"><input type="number" min="10" max="60000" step="10" aria-label="Frame delay in milliseconds" .value=${String(this.frameDelay)} @change=${(event: Event) => this._send("inspector-delay-changed", { delayMs: Number((event.target as HTMLInputElement).value) })}><span>ms</span></span></label><button type="button" class="toggle-row" aria-pressed=${String(this.onionSkin)} @click=${() => this._send("inspector-onion-changed", { enabled: !this.onionSkin })}><span class="toggle-mark" aria-hidden="true">◉</span><span>Onion skin</span><span class="toggle-state">${this.onionSkin ? "On" : "Off"}</span></button></section>
      <section aria-labelledby="composition-heading"><h3 id="composition-heading">Composition</h3><label class="toggle-row"><span class="toggle-mark" aria-hidden="true">◧</span><span>Clock region</span><input type="checkbox" aria-label="Reserve right half for live clock" .checked=${this.clockRegion} @change=${(event: Event) => this._send("inspector-clock-region-changed", { enabled: (event.target as HTMLInputElement).checked })}></label><p class="hint">Reserves the right half for the live clock.</p></section>
    </aside>`;
  }

  static styles = [TOKENS_CSS, SURFACES_CSS, css`
    :host { display: block; min-width: 0; }
    .panel { display: grid; gap: var(--lu-space-4); align-content: start; min-width: 0; padding: var(--lu-space-4); border: 1px solid var(--lu-edge); border-radius: var(--lu-radius-card); background: var(--lu-card); box-shadow: var(--lu-highlight-rest), var(--lu-shadow-rest); }
    h2 { margin: 0; color: var(--lu-ink); font: 600 var(--lu-type-title)/1.2 var(--lu-font); letter-spacing: -0.01em; }
    section { display: grid; gap: var(--lu-space-2); min-width: 0; }
    h3 { margin: 0; color: var(--lu-ink-2); font: 600 var(--lu-type-label)/1.2 var(--lu-font); }
    h4 { margin: var(--lu-space-2) 0 0; color: var(--lu-ink-3); font: 500 var(--lu-type-caption)/1.2 var(--lu-font); }
    .section-heading { display: flex; align-items: center; justify-content: space-between; gap: var(--lu-space-2); }
    .current-color { width: var(--lu-target); height: var(--lu-target); border: 1px solid var(--lu-edge); border-radius: var(--lu-radius-control); background: var(--swatch); cursor: pointer; }
    .swatches { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: var(--lu-space-1); }
    .swatch { width: 100%; min-width: 48px; min-height: 48px; border: 1px solid var(--lu-edge); border-radius: var(--lu-radius-control); background: var(--swatch); cursor: pointer; }
    .swatch[aria-pressed="true"] { outline: 2px solid var(--lu-accent); outline-offset: 2px; }
    .native-picker, .delay-label, .toggle-row { display: flex; align-items: center; justify-content: space-between; gap: var(--lu-space-2); min-height: var(--lu-target); color: var(--lu-ink); font: 500 var(--lu-type-label)/1.3 var(--lu-font); }
    input[type=color] { width: var(--lu-target); height: var(--lu-target); border: 1px solid var(--lu-edge); border-radius: var(--lu-radius-control); padding: var(--lu-space-1); background: var(--lu-card); cursor: pointer; }
    .segmented { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--lu-space-1); }
    .segmented button { min-height: var(--lu-target); border: 1px solid var(--lu-edge); border-radius: var(--lu-radius-control); background: var(--lu-tile); color: var(--lu-ink); font: 500 var(--lu-type-label)/1.2 var(--lu-font); cursor: pointer; }
    .segmented button[aria-pressed="true"] { border-color: var(--lu-accent); background: var(--lu-accent-soft); color: var(--lu-accent); }
    .delay-control { display: inline-flex; align-items: center; gap: var(--lu-space-1); color: var(--lu-ink-2); font-variant-numeric: tabular-nums; }
    .delay-control input { width: 6rem; min-height: var(--lu-target); border: 1px solid var(--lu-edge); border-radius: var(--lu-radius-control); background: var(--lu-card); color: var(--lu-ink); padding: 0 var(--lu-space-2); text-align: center; font: 500 var(--lu-type-numeral)/1 var(--lu-font); font-variant-numeric: tabular-nums; }
    .toggle-row { width: 100%; padding: 0 var(--lu-space-2); border: 1px solid var(--lu-edge); border-radius: var(--lu-radius-control); background: var(--lu-tile); text-align: left; cursor: pointer; }
    .toggle-row input { width: 24px; height: 24px; accent-color: var(--lu-accent); }
    .toggle-mark { color: var(--lu-accent); font-size: var(--lu-type-numeral); }
    .toggle-state { margin-left: auto; color: var(--lu-ink-3); font: 400 var(--lu-type-caption)/1.2 var(--lu-font); }
    .hint { margin: 0; color: var(--lu-ink-3); font: 400 var(--lu-type-caption)/1.4 var(--lu-font); }
    button:focus-visible, input:focus-visible { outline: 2px solid var(--lu-accent); outline-offset: 2px; }
  `];
}

customElements.define("iledclock-editor-inspector", IledclockEditorInspector);

declare global { interface HTMLElementTagNameMap { "iledclock-editor-inspector": IledclockEditorInspector; } }
