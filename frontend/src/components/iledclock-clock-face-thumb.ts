import { LitElement, css, html, type PropertyValues } from "lit";
import type { HomeAssistant } from "../types.ts";
import type { PixelFrame } from "../lib/grid.ts";
import { clockFaceLabel, clockFacePreviewFrames } from "../lib/clock-faces.ts";
import { GRID_HEIGHT, GRID_WIDTH, createFrame } from "../lib/grid.ts";
import { TOKENS_CSS } from "../styles/tokens.ts";
import "./iledclock-led-preview.ts";

/** A clock face thumbnail is rendered from the firmware geometry only when it enters the picker. */
export class IledclockClockFaceThumb extends LitElement {
  static properties = {
    hass: { attribute: false },
    entryId: { attribute: false },
    faceStyle: { type: Number, attribute: "face-style" },
    color: { attribute: false },
    hours24: { type: Boolean, attribute: "hours24" },
    selected: { type: Boolean, reflect: true },
    _frames: { state: true },
  };

  declare hass: HomeAssistant;
  declare entryId: string | undefined;
  declare faceStyle: number;
  declare color: readonly [number, number, number];
  declare hours24: boolean;
  declare selected: boolean;
  declare _frames: PixelFrame[];

  private _observer: IntersectionObserver | null = null;
  private _visible = typeof IntersectionObserver === "undefined";
  private _loadedKey = "";

  constructor() {
    super();
    this.faceStyle = 1;
    this.color = [255, 255, 255];
    this.hours24 = true;
    this.selected = false;
    this._frames = [createFrame(GRID_WIDTH, GRID_HEIGHT)];
  }

  connectedCallback(): void {
    super.connectedCallback();
    if (typeof IntersectionObserver !== "undefined") {
      this._observer = new IntersectionObserver((entries) => {
        this._visible = entries[0]?.isIntersecting ?? false;
        if (this._visible) this._loadPreview();
      }, { rootMargin: "48px" });
      this._observer.observe(this);
    } else {
      this._loadPreview();
    }
  }

  protected updated(changed: PropertyValues): void {
    if ((changed.has("entryId") || changed.has("faceStyle") || changed.has("color") || changed.has("hours24")) && this._visible) this._loadPreview();
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this._observer?.disconnect();
    this._observer = null;
  }

  private _loadPreview(): void {
    const key = [this.entryId ?? "", this.faceStyle, this.color.join(","), this.hours24 ? "24" : "12"].join("|");
    if (key === this._loadedKey) return;
    this._frames = clockFacePreviewFrames(this.faceStyle, this.color, this.hours24);
    this._loadedKey = key;
  }

  private _select(): void {
    this.dispatchEvent(new CustomEvent("face-selected", { detail: { style: this.faceStyle }, bubbles: true, composed: true }));
  }

  render() {
    return html`<button type="button" class="face" aria-label=${clockFaceLabel(this.faceStyle)} aria-pressed=${this.selected ? "true" : "false"} ?disabled=${!this.entryId} @click=${this._select}>
      <iledclock-led-preview context="thumb" .frames=${this._frames} .playing=${false} label=${clockFaceLabel(this.faceStyle)}></iledclock-led-preview>
      <span>${clockFaceLabel(this.faceStyle)}</span>
    </button>`;
  }

  static styles = [TOKENS_CSS, css`
    :host { display: block; flex: 0 0 96px; min-width: 0; }
    .face { display: flex; width: 100%; min-height: var(--lu-target); flex-direction: column; justify-content: center; gap: var(--lu-space-1); padding: var(--lu-space-1); border: 1px solid var(--lu-edge); border-radius: var(--lu-radius-tile); color: var(--lu-ink-2); background: transparent; font: 500 var(--lu-type-caption)/1.2 var(--lu-font); cursor: pointer; }
    :host([selected]) .face { border-color: var(--lu-accent); color: var(--lu-ink); background: var(--lu-glass-raised); box-shadow: var(--lu-highlight-raised); }
    .face:focus-visible { outline: 2px solid var(--lu-accent); outline-offset: 2px; }
    .face span { text-align: center; }
    iledclock-led-preview { width: 100%; }
  `];
}

customElements.define("iledclock-clock-face-thumb", IledclockClockFaceThumb);

declare global { interface HTMLElementTagNameMap { "iledclock-clock-face-thumb": IledclockClockFaceThumb; } }
