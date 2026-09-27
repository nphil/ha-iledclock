import { LitElement, css, html, type PropertyValues } from "lit";
import type { HomeAssistant, RenderResult } from "../types.ts";
import type { PixelFrame } from "../lib/grid.ts";
import { buildClockRenderSpec, renderRequest } from "../lib/ws-api.ts";
import { CLOCK_FACE_COUNT, clockFaceLabel } from "../lib/clock-faces.ts";
import { GRID_HEIGHT, GRID_WIDTH, createFrame } from "../lib/grid.ts";
import { TOKENS_CSS } from "../styles/tokens.ts";
import "./iledclock-led-preview.ts";

/** A clock face thumbnail requests its preview only after it enters the horizontal picker viewport. */
export class IledclockClockFaceThumb extends LitElement {
  static properties = {
    hass: { attribute: false },
    entryId: { attribute: false },
    faceStyle: { type: Number, attribute: "face-style" },
    color: { attribute: false },
    hours24: { type: Boolean, attribute: "hours24" },
    selected: { type: Boolean, reflect: true },
    _frames: { state: true },
    _loading: { state: true },
  };

  declare hass: HomeAssistant;
  declare entryId: string | undefined;
  declare faceStyle: number;
  declare color: readonly [number, number, number];
  declare hours24: boolean;
  declare selected: boolean;
  declare _frames: PixelFrame[];
  declare _loading: boolean;

  private _observer: IntersectionObserver | null = null;
  private _visible = typeof IntersectionObserver === "undefined";
  private _loadedKey = "";
  private _revision = 0;
  private _inFlight = false;
  private _loadQueued = false;

  constructor() {
    super();
    this.faceStyle = 1;
    this.color = [255, 255, 255];
    this.hours24 = true;
    this.selected = false;
    this._frames = [createFrame(GRID_WIDTH, GRID_HEIGHT)];
    this._loading = false;
  }

  connectedCallback(): void {
    super.connectedCallback();
    if (typeof IntersectionObserver !== "undefined") {
      this._observer = new IntersectionObserver((entries) => {
        this._visible = entries[0]?.isIntersecting ?? false;
        if (this._visible) void this._loadPreview();
      }, { rootMargin: "48px" });
    }
  }

  protected firstUpdated(): void {
    this._observer?.observe(this);
    if (this._visible) void this._loadPreview();
  }

  protected updated(changed: PropertyValues): void {
    if ((changed.has("entryId") || changed.has("faceStyle") || changed.has("color") || changed.has("hours24")) && this._visible) void this._loadPreview();
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this._revision++;
    this._observer?.disconnect();
    this._observer = null;
  }

  private async _loadPreview(): Promise<void> {
    if (!this.entryId || !this.hass?.callWS) return;
    const key = [this.entryId, this.faceStyle, this.color.join(","), this.hours24 ? "24" : "12"].join("|");
    if (key === this._loadedKey) return;
    if (this._inFlight) {
      this._loadQueued = true;
      return;
    }
    const revision = ++this._revision;
    this._inFlight = true;
    this._loading = true;
    try {
      const result = await this.hass.callWS<RenderResult>(renderRequest(this.entryId, buildClockRenderSpec(this.faceStyle, this.color, this.hours24, CLOCK_FACE_COUNT)));
      if (revision !== this._revision) return;
      this._frames = result.frames.map((encoded, index) => {
        const binary = atob(encoded);
        const pixels = new Uint8Array(GRID_WIDTH * GRID_HEIGHT * 3);
        for (let i = 0; i < Math.min(binary.length, pixels.length); i++) pixels[i] = binary.charCodeAt(i);
        return { width: GRID_WIDTH, height: GRID_HEIGHT, pixels, durationMs: result.delays[index] ?? 100 };
      });
      if (!this._frames.length) this._frames = [createFrame(GRID_WIDTH, GRID_HEIGHT)];
      this._loadedKey = key;
    } catch {
      // Keep the last thumbnail; a face choice must remain usable if preview rendering is unavailable.
      this._loadedKey = "";
    } finally {
      this._inFlight = false;
      if (revision === this._revision) this._loading = false;
      if (this._loadQueued) {
        this._loadQueued = false;
        void this._loadPreview();
      }
    }
  }

  private _select(): void {
    this.dispatchEvent(new CustomEvent("face-selected", { detail: { style: this.faceStyle }, bubbles: true, composed: true }));
  }

  render() {
    return html`<button type="button" class="face" aria-label=${clockFaceLabel(this.faceStyle)} aria-pressed=${this.selected ? "true" : "false"} ?disabled=${!this.entryId} @click=${this._select}>
      <iledclock-led-preview context="thumb" .frames=${this._frames} .playing=${false} label=${clockFaceLabel(this.faceStyle)}></iledclock-led-preview>
      <span>${clockFaceLabel(this.faceStyle)}</span>
      ${this._loading ? html`<span class="loading" role="status">Loading preview</span>` : ""}
    </button>`;
  }

  static styles = [TOKENS_CSS, css`
    :host { display: block; flex: 0 0 96px; min-width: 0; }
    .face { display: flex; width: 100%; min-height: var(--lu-target); flex-direction: column; justify-content: center; gap: var(--lu-space-1); padding: var(--lu-space-1); border: 1px solid var(--lu-edge); border-radius: var(--lu-radius-tile); color: var(--lu-ink-2); background: transparent; font: 500 var(--lu-type-caption)/1.2 var(--lu-font); cursor: pointer; }
    :host([selected]) .face { border-color: var(--lu-accent); color: var(--lu-ink); background: var(--lu-glass-raised); box-shadow: var(--lu-highlight-raised); }
    .face:focus-visible { outline: 2px solid var(--lu-accent); outline-offset: 2px; }
    .face span { text-align: center; }
    .loading { color: var(--lu-ink-3); font-size: var(--lu-type-caption); }
    iledclock-led-preview { width: 100%; }
  `];
}

customElements.define("iledclock-clock-face-thumb", IledclockClockFaceThumb);

declare global { interface HTMLElementTagNameMap { "iledclock-clock-face-thumb": IledclockClockFaceThumb; } }
