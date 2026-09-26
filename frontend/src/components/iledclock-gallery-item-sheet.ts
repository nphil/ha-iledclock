/** The gallery browser's item detail: a large LED-look preview of the ADAPTED 32x16 result (what
 * the clock will really show, RGB444-quantised, animated -- deliberately not gated by reduced
 * motion the way the browser's own grid tiles are, since this preview IS the content the user
 * asked to see, not decorative chrome), layout pills, an "Adjust" disclosure for power users, a
 * credit line linking back to the original, and "Save to library" / "Show on clock" actions.
 * Controlled overlay -- the parent (`iledclock-gallery-browser.ts`) owns `open`/`item`/`source`,
 * this only ever asks to close, exactly like `iledclock-settings-sheet.ts`'s own contract.
 */

import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import type { HomeAssistant } from "../types.ts";
import { GRID_HEIGHT, GRID_WIDTH, type PixelFrame } from "../lib/grid.ts";
import { base64ToFrame } from "../lib/design-codec.ts";
import { frameIndexAtTime } from "../lib/frame-player.ts";
import { hexToRgb, rgbToHex } from "../lib/color.ts";
import { describeWsError } from "../lib/ws-query.ts";
import { showRequest } from "../lib/ws-api.ts";
import {
  galleryImportRequest,
  galleryItemUrl,
  galleryLayoutLabel,
  galleryPreviewRequest,
  normalizeAdjustOptions,
  type GalleryAdjustOptions,
  type GalleryImportResult,
  type GalleryItem,
  type GalleryLayout,
  type GalleryPreviewResult,
  type GallerySource,
} from "../lib/gallery-api.ts";
import { mdiIcon } from "../lib/mdi-icons.ts";
import { TOKENS_CSS } from "../styles/tokens.ts";
import "./iledclock-matrix-canvas.ts";
import "./iledclock-segmented-picker.ts";
import "./iledclock-hold-button.ts";
import "./iledclock-stepper.ts";

const ADJUST_DEBOUNCE_MS = 250;
const MAX_ADJUST_OFFSET_UI = 64;

export class IledclockGalleryItemSheet extends LitElement {
  static properties = {
    hass: { attribute: false },
    entryId: { attribute: false },
    open: { type: Boolean, reflect: true },
    item: { attribute: false },
    source: { attribute: false },
    _layout: { state: true },
    _adjustOpen: { state: true },
    _adjust: { state: true },
    _preview: { state: true },
    _previewLoading: { state: true },
    _previewError: { state: true },
    _saving: { state: true },
    _actionError: { state: true },
  };

  declare hass: HomeAssistant;
  declare entryId: string | undefined;
  declare open: boolean;
  declare item: GalleryItem | null;
  declare source: GallerySource | undefined;
  declare _layout: GalleryLayout;
  declare _adjustOpen: boolean;
  declare _adjust: GalleryAdjustOptions;
  declare _preview: GalleryPreviewResult | null;
  declare _previewLoading: boolean;
  declare _previewError: string | null;
  declare _saving: "save" | "show" | null;
  declare _actionError: string | null;

  private _pixelFrames: PixelFrame[] = [];
  private _playStartedAt = 0;
  private _rafId: number | null = null;
  private _requestId = 0;
  private _debounceTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    super();
    this.open = false;
    this.item = null;
    this._layout = "auto";
    this._adjustOpen = false;
    this._adjust = {};
    this._preview = null;
    this._previewLoading = false;
    this._previewError = null;
    this._saving = null;
    this._actionError = null;
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this._stopLoop();
    clearTimeout(this._debounceTimer);
  }

  protected updated(changed: PropertyValues): void {
    if (changed.has("open") || changed.has("item")) {
      if (this.open && this.item) {
        this._layout = "auto";
        this._adjustOpen = false;
        this._adjust = {};
        this._preview = null;
        this._previewError = null;
        this._actionError = null;
        this._pixelFrames = [];
        void this._loadPreview();
        this._startLoop();
      } else {
        this._stopLoop();
      }
    }
    if (changed.has("_preview")) {
      this._pixelFrames = this._preview ? this._preview.frames.map((b64, i) => base64ToFrame(b64, GRID_WIDTH, GRID_HEIGHT, this._preview!.delays_ms[i] ?? 100)) : [];
      this._playStartedAt = performance.now();
    }
  }

  private _startLoop(): void {
    if (this._rafId !== null) return;
    this._playStartedAt = performance.now();
    const step = () => {
      this.requestUpdate();
      this._rafId = requestAnimationFrame(step);
    };
    this._rafId = requestAnimationFrame(step);
  }

  private _stopLoop(): void {
    if (this._rafId !== null) cancelAnimationFrame(this._rafId);
    this._rafId = null;
  }

  private _currentFrame(): PixelFrame | null {
    if (this._pixelFrames.length === 0) return null;
    return this._pixelFrames[frameIndexAtTime(this._pixelFrames, performance.now() - this._playStartedAt)]!;
  }

  private _buildOptions(): GalleryAdjustOptions {
    if (!this.item) return {};
    const raw: GalleryAdjustOptions = { ...this._adjust };
    if (this._layout !== "auto") raw.layout = this._layout;
    return normalizeAdjustOptions(raw, this.item.width, this.item.height);
  }

  private async _loadPreview(): Promise<void> {
    if (!this.item || !this.entryId || !this.hass.callWS) return;
    const requestId = ++this._requestId;
    this._previewLoading = true;
    this._previewError = null;
    try {
      const result = await this.hass.callWS<GalleryPreviewResult>(galleryPreviewRequest(this.entryId, this.item.source, this.item.id, this._buildOptions()));
      if (requestId !== this._requestId) return;
      this._preview = result;
    } catch (err) {
      if (requestId !== this._requestId) return;
      this._previewError = describeWsError(err);
      this._preview = null;
    } finally {
      if (requestId === this._requestId) this._previewLoading = false;
    }
  }

  private _selectLayout(layout: GalleryLayout): void {
    this._layout = layout;
    void this._loadPreview();
  }

  private _updateAdjust(patch: Partial<GalleryAdjustOptions>): void {
    this._adjust = { ...this._adjust, ...patch };
    if (this._debounceTimer !== undefined) clearTimeout(this._debounceTimer);
    this._debounceTimer = setTimeout(() => void this._loadPreview(), ADJUST_DEBOUNCE_MS);
  }

  private _clearBackground(): void {
    const { background: _dropped, ...rest } = this._adjust;
    this._adjust = rest;
    void this._loadPreview();
  }

  private async _saveToLibrary(): Promise<void> {
    if (!this.item || !this.entryId || !this.hass.callWS) return;
    this._saving = "save";
    this._actionError = null;
    try {
      await this.hass.callWS(galleryImportRequest(this.entryId, this.item.source, this.item.id, this._buildOptions()));
      this.dispatchEvent(new CustomEvent("iledclock-designs-changed", { bubbles: true, composed: true }));
      this._close();
    } catch (err) {
      this._actionError = describeWsError(err);
    } finally {
      this._saving = null;
    }
  }

  private _showOnClock = async (): Promise<void> => {
    if (!this.item || !this.entryId || !this.hass.callWS) return;
    this._saving = "show";
    this._actionError = null;
    try {
      const imported = await this.hass.callWS<GalleryImportResult>(galleryImportRequest(this.entryId, this.item.source, this.item.id, this._buildOptions()));
      await this.hass.callWS(showRequest(this.entryId, { design_id: imported.design_id }));
      this.dispatchEvent(new CustomEvent("iledclock-designs-changed", { bubbles: true, composed: true }));
      this.dispatchEvent(new CustomEvent("iledclock-open-design", { detail: { design_id: imported.design_id }, bubbles: true, composed: true }));
      this._close();
    } catch (err) {
      this._actionError = describeWsError(err);
    } finally {
      this._saving = null;
    }
  };

  private _close(): void {
    this.dispatchEvent(new CustomEvent("close-requested", { bubbles: true, composed: true }));
  }

  private _onKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") this._close();
  }

  render() {
    if (!this.open || !this.item) return nothing;
    const item = this.item;
    const layouts: GalleryLayout[] = [];
    for (const layout of ["auto", ...(this._preview?.layouts_available ?? [])] as GalleryLayout[]) {
      if (!layouts.includes(layout)) layouts.push(layout);
    }
    return html`
      <div class="backdrop" @click=${this._close}></div>
      <div class="panel" role="dialog" aria-modal="true" aria-label=${item.title} @keydown=${this._onKeydown}>
        <header>
          <h2>${item.title}</h2>
          <button type="button" class="icon-button" @click=${this._close} aria-label="Close">${mdiIcon("close")}</button>
        </header>
        <div class="body">
          ${this._actionError ? html`<p class="error">${this._actionError}</p>` : nothing}
          <div class="preview-plate">
            ${this._pixelFrames.length === 0 && this._previewLoading
              ? html`<div class="skeleton"></div>`
              : html`<iledclock-matrix-canvas .frame=${this._currentFrame()} bloom></iledclock-matrix-canvas>`}
          </div>
          ${this._previewError ? html`<p class="error">${this._previewError}</p>` : nothing}
          <iledclock-segmented-picker
            group-label="Layout"
            content-fit
            .options=${layouts.map((l) => ({ value: l, label: galleryLayoutLabel(l) }))}
            .value=${this._layout}
            @option-selected=${(e: CustomEvent<{ value: string }>) => this._selectLayout(e.detail.value as GalleryLayout)}
          ></iledclock-segmented-picker>
          ${this._layout === "auto" && this._preview ? html`<p class="hint">Auto chose ${galleryLayoutLabel(this._preview.layout).toLowerCase()}.</p>` : nothing}
          <button type="button" class="disclosure" @click=${() => (this._adjustOpen = !this._adjustOpen)}>
            ${mdiIcon(this._adjustOpen ? "chevronUp" : "chevronDown")} Adjust
          </button>
          ${this._adjustOpen ? this._renderAdjust(item) : nothing}
          ${this._renderCredit(item)}
        </div>
        <div class="actions">
          <button type="button" class="secondary-action" ?disabled=${this._saving !== null} @click=${this._saveToLibrary}>
            ${mdiIcon("save")} ${this._saving === "save" ? "Saving…" : "Save to library"}
          </button>
          <iledclock-hold-button label="Hold to show on clock" complete-label="Showing" ?disabled=${this._saving !== null} @confirmed=${this._showOnClock}></iledclock-hold-button>
        </div>
      </div>
    `;
  }

  private _renderCredit(item: GalleryItem) {
    const url = galleryItemUrl(item, this.source);
    const sentence = item.author ? `By ${item.author} on ${this.source?.name ?? item.source}.` : `From ${this.source?.name ?? item.source}.`;
    return html`<p class="credit">${sentence} ${url ? html`<a href=${url} target="_blank" rel="noopener noreferrer">View original</a>` : nothing}</p>`;
  }

  private _renderAdjust(item: GalleryItem) {
    const crop = this._adjust.crop ?? { x: 0, y: 0, w: item.width, h: item.height };
    const scale = this._adjust.scale ?? 1;
    const offset = this._adjust.offset ?? { x: 0, y: 0 };
    const enhance = this._adjust.enhance ?? false;
    return html`
      <div class="adjust">
        <span class="adjust-label">Crop (source pixels)</span>
        <div class="crop-grid">
          <label class="stepper-field">X<iledclock-stepper .value=${crop.x} min="0" .max=${item.width} step="1" @value-selected=${(e: CustomEvent<{ value: number }>) => this._updateAdjust({ crop: { ...crop, x: e.detail.value } })}></iledclock-stepper></label>
          <label class="stepper-field">Y<iledclock-stepper .value=${crop.y} min="0" .max=${item.height} step="1" @value-selected=${(e: CustomEvent<{ value: number }>) => this._updateAdjust({ crop: { ...crop, y: e.detail.value } })}></iledclock-stepper></label>
          <label class="stepper-field">Width<iledclock-stepper .value=${crop.w} min="1" .max=${item.width} step="1" @value-selected=${(e: CustomEvent<{ value: number }>) => this._updateAdjust({ crop: { ...crop, w: e.detail.value } })}></iledclock-stepper></label>
          <label class="stepper-field">Height<iledclock-stepper .value=${crop.h} min="1" .max=${item.height} step="1" @value-selected=${(e: CustomEvent<{ value: number }>) => this._updateAdjust({ crop: { ...crop, h: e.detail.value } })}></iledclock-stepper></label>
        </div>
        <label class="stepper-field">Scale<iledclock-stepper .value=${scale} min="1" max="16" step="1" @value-selected=${(e: CustomEvent<{ value: number }>) => this._updateAdjust({ scale: e.detail.value })}></iledclock-stepper></label>
        <div class="two-up">
          <label class="stepper-field">Offset X<iledclock-stepper .value=${offset.x} min=${-MAX_ADJUST_OFFSET_UI} max=${MAX_ADJUST_OFFSET_UI} step="1" @value-selected=${(e: CustomEvent<{ value: number }>) => this._updateAdjust({ offset: { ...offset, x: e.detail.value } })}></iledclock-stepper></label>
          <label class="stepper-field">Offset Y<iledclock-stepper .value=${offset.y} min=${-MAX_ADJUST_OFFSET_UI} max=${MAX_ADJUST_OFFSET_UI} step="1" @value-selected=${(e: CustomEvent<{ value: number }>) => this._updateAdjust({ offset: { ...offset, y: e.detail.value } })}></iledclock-stepper></label>
        </div>
        <div class="background-row">
          <span class="adjust-label">Background</span>
          <input type="color" .value=${rgbToHex(this._adjust.background ?? [0, 0, 0])} @input=${(e: Event) => this._updateAdjust({ background: hexToRgb((e.target as HTMLInputElement).value) })} />
          ${this._adjust.background ? html`<button type="button" class="link-button" @click=${this._clearBackground}>Clear</button>` : nothing}
        </div>
        <button type="button" class="toggle-row" @click=${() => this._updateAdjust({ enhance: !enhance })}>
          <span class="toggle-label">Enhance colours</span>
          <span class="toggle-pill ${enhance ? "on" : ""}"><span class="toggle-knob"></span></span>
        </button>
      </div>
    `;
  }

  static styles = [
    TOKENS_CSS,
    css`
    :host(:not([open])) {
      display: none;
    }
    :host {
      position: fixed;
      inset: 0;
      z-index: 110;
    }
    .backdrop {
      position: absolute;
      inset: 0;
      background: var(--lu-scrim, rgba(0, 0, 0, 0.5));
    }
    .panel {
      position: absolute;
      right: 0;
      top: 0;
      bottom: 0;
      width: min(480px, 100vw);
      background: var(--lu-card);
      color: var(--lu-ink);
      box-shadow: var(--lu-shadow-raised);
      border-left: 1px solid var(--lu-edge);
      display: flex;
      flex-direction: column;
      overflow-y: auto;
      container-type: inline-size;
    }
    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 16px;
      border-bottom: 1px solid var(--lu-edge);
      position: sticky;
      top: 0;
      background: inherit;
      z-index: 1;
    }
    h2 {
      margin: 0;
      font-size: 17px;
      font-weight: 600;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .icon-button {
      flex: none;
      width: var(--lu-target, 48px);
      height: var(--lu-target, 48px);
      border-radius: 50%;
      border: none;
      background: transparent;
      color: var(--lu-ink);
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .icon-button:hover {
      background: var(--lu-tile);
    }
    .body {
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }
    .error {
      margin: 0;
      font-size: 13px;
      color: var(--lu-danger);
    }
    .hint {
      margin: 0;
      font-size: 13px;
      color: var(--lu-ink-2);
    }
    .preview-plate {
      aspect-ratio: 2 / 1;
      width: 100%;
      border-radius: var(--lu-radius-tile);
      overflow: hidden;
      background: #050607;
      border: 1px solid var(--lu-edge);
    }
    .skeleton {
      width: 100%;
      height: 100%;
      background: linear-gradient(90deg, #0a0b0c 25%, #16181a 37%, #0a0b0c 63%);
      background-size: 400% 100%;
      animation: shimmer 1.4s ease infinite;
    }
    @media (prefers-reduced-motion: reduce) {
      .skeleton {
        animation: none;
        background: #0f1112;
      }
    }
    @keyframes shimmer {
      0% { background-position: 100% 0; }
      100% { background-position: 0 0; }
    }
    .disclosure {
      display: flex;
      align-items: center;
      gap: 6px;
      align-self: flex-start;
      min-height: var(--lu-target, 48px);
      padding: 0 14px;
      border-radius: var(--lu-radius-pill);
      border: 1px solid var(--lu-edge);
      background: var(--lu-tile);
      color: var(--lu-ink);
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
    }
    .adjust {
      display: flex;
      flex-direction: column;
      gap: 12px;
      padding: 12px;
      border-radius: var(--lu-radius-tile);
      background: var(--lu-tile);
    }
    .adjust-label {
      font-size: 13px;
      font-weight: 600;
      color: var(--lu-ink-2);
    }
    .crop-grid {
      display: grid;
      grid-template-columns: 1fr;
      gap: 10px;
    }
    @container (min-width: 360px) {
      .crop-grid,
      .two-up {
        grid-template-columns: repeat(2, 1fr);
      }
    }
    .two-up {
      display: grid;
      grid-template-columns: 1fr;
      gap: 10px;
    }
    .stepper-field {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      color: var(--lu-ink-2);
    }
    .background-row {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .background-row input[type="color"] {
      width: 40px;
      height: 40px;
      border: none;
      border-radius: 50%;
      overflow: hidden;
      padding: 0;
      background: none;
      cursor: pointer;
    }
    .link-button {
      background: none;
      border: none;
      color: var(--lu-accent);
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      padding: 0;
    }
    .toggle-row {
      display: flex;
      align-items: center;
      gap: 10px;
      background: none;
      border: none;
      padding: 6px 0;
      min-height: var(--lu-target, 48px);
      color: var(--lu-ink);
      cursor: pointer;
      text-align: left;
      font-size: 14px;
    }
    .toggle-label {
      flex: 1;
    }
    .toggle-pill {
      flex: none;
      width: 40px;
      height: 24px;
      border-radius: var(--lu-radius-pill);
      background: var(--lu-track-off);
      position: relative;
    }
    .toggle-pill.on {
      background: var(--lu-accent);
    }
    .toggle-knob {
      position: absolute;
      top: 2px;
      left: 2px;
      width: 20px;
      height: 20px;
      border-radius: 50%;
      background: #fff;
      transition: transform var(--lu-motion-focus) var(--lu-ease);
    }
    .toggle-pill.on .toggle-knob {
      transform: translateX(16px);
    }
    .credit {
      margin: 0;
      font-size: 13px;
      color: var(--lu-ink-2);
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .credit a {
      color: var(--lu-accent);
      font-weight: 600;
      text-decoration: none;
    }
    .credit a:hover {
      text-decoration: underline;
    }
    .actions {
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding: 12px 16px 20px;
      border-top: 1px solid var(--lu-edge);
      position: sticky;
      bottom: 0;
      background: inherit;
    }
    .secondary-action {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      min-height: var(--lu-target, 48px);
      border-radius: var(--lu-radius-pill);
      border: 1px solid var(--lu-edge);
      background: var(--lu-tile);
      color: var(--lu-ink);
      cursor: pointer;
      font-size: 14px;
      font-weight: 600;
    }
    .secondary-action:disabled {
      opacity: 0.5;
      cursor: default;
    }
    @media (prefers-reduced-motion: reduce) {
      * {
        transition: none !important;
      }
    }
    `,
  ];
}

customElements.define("iledclock-gallery-item-sheet", IledclockGalleryItemSheet);

declare global {
  interface HTMLElementTagNameMap {
    "iledclock-gallery-item-sheet": IledclockGalleryItemSheet;
  }
}
