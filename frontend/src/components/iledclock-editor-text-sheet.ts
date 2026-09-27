import { LitElement, css, html, type PropertyValues } from "lit";
import { TOKENS_CSS, SURFACES_CSS } from "../styles/tokens.ts";
import { rgbToCss, rgbToHex, hexToRgb, type RGB } from "../lib/color.ts";
import "./lu-sheet.ts";
import "./lu-pill-button.ts";

export class IledclockEditorTextSheet extends LitElement {
  static properties = {
    open: { type: Boolean },
    mode: { type: String },
    color: { attribute: false },
    _text: { state: true },
    _color: { state: true },
  };

  declare open: boolean;
  declare mode: "stamp" | "new";
  declare color: RGB;
  declare _text: string;
  declare _color: RGB;

  constructor() {
    super();
    this.open = false;
    this.mode = "stamp";
    this.color = [255, 255, 255];
    this._text = "";
    this._color = this.color;
  }

  protected updated(changed: PropertyValues): void {
    if (changed.has("open") && this.open) {
      this._text = "";
      this._color = this.color;
    }
  }

  private _submit(): void {
    const text = this._text.trim();
    if (!text) return;
    this.dispatchEvent(new CustomEvent("text-ready", { detail: { text, color: this._color, mode: this.mode }, bubbles: true, composed: true }));
  }

  render() {
    const actionLabel = this.mode === "new" ? "Create text design" : "Set text stamp";
    return html`<lu-sheet .open=${this.open} label=${this.mode === "new" ? "New text design" : "Text stamp"} @closed=${() => { this.open = false; this.dispatchEvent(new CustomEvent("close-requested", { bubbles: true, composed: true })); }}>
      <div class="content">
        <label class="field"><span>Message</span><input type="text" maxlength="80" aria-label="Text to draw" placeholder="Type a short message" .value=${this._text} @input=${(event: Event) => (this._text = (event.target as HTMLInputElement).value)} @keydown=${(event: KeyboardEvent) => { if (event.key === "Enter") this._submit(); }}></label>
        <p class="hint">${this.mode === "new" ? "The clock will render this as a new design." : "Choose the text, then tap the canvas where it should begin."}</p>
        <label class="colour-row"><span>Text colour <span class="colour-dot" style=${`--swatch: ${rgbToCss(this._color)}`}></span></span><input type="color" aria-label="Text colour" .value=${rgbToHex(this._color)} @input=${(event: Event) => (this._color = hexToRgb((event.target as HTMLInputElement).value))}></label>
        <lu-pill-button variant="primary" label=${actionLabel} icon="mdi:text" ?disabled=${!this._text.trim()} @lu-press=${this._submit}></lu-pill-button>
      </div>
    </lu-sheet>`;
  }

  static styles = [TOKENS_CSS, SURFACES_CSS, css`
    :host { display: block; }
    .content { display: grid; gap: var(--lu-space-3); }
    .field, .colour-row { display: grid; gap: var(--lu-space-2); color: var(--lu-ink-2); font: 500 var(--lu-type-label)/1.3 var(--lu-font); }
    input[type=text] { width: 100%; min-height: var(--lu-target); box-sizing: border-box; padding: 0 var(--lu-space-3); border: 1px solid var(--lu-edge); border-radius: var(--lu-radius-control); background: var(--lu-card); color: var(--lu-ink); font: 400 var(--lu-type-body)/1.3 var(--lu-font); }
    .hint { margin: 0; color: var(--lu-ink-3); font: 400 var(--lu-type-caption)/1.4 var(--lu-font); }
    .colour-row { display: flex; align-items: center; justify-content: space-between; min-height: var(--lu-target); }
    .colour-row > span { display: inline-flex; align-items: center; gap: var(--lu-space-2); }
    .colour-dot { display: inline-block; width: var(--lu-space-5); height: var(--lu-space-5); border-radius: var(--lu-radius-pill); background: var(--swatch); border: 1px solid var(--lu-edge); }
    input[type=color] { width: var(--lu-target); height: var(--lu-target); border: 1px solid var(--lu-edge); border-radius: var(--lu-radius-control); padding: var(--lu-space-1); background: var(--lu-card); cursor: pointer; }
    lu-pill-button { width: 100%; }
    input:focus-visible { outline: 2px solid var(--lu-accent); outline-offset: 2px; }
  `];
}

customElements.define("iledclock-editor-text-sheet", IledclockEditorTextSheet);

declare global { interface HTMLElementTagNameMap { "iledclock-editor-text-sheet": IledclockEditorTextSheet; } }
