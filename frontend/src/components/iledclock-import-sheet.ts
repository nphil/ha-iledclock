/** Import the user's own GIF/PNG/JPEG/WebP/.aseprite/.piskel file, or a pasted image URL: drop/
 * pick a file or paste a URL, a draggable crop box over the RAW source image (browser-decodable
 * raster formats only -- `.aseprite`/`.piskel` can't be rasterised client-side, so those skip
 * straight to the adapted preview with numeric-only crop, same as the gallery item sheet), the
 * same layout pills + Adjust disclosure + LED-look adapted preview as
 * `iledclock-gallery-item-sheet.ts`, and Save / Show actions. Controlled overlay -- the host
 * panel owns `open`, this only ever asks to close, exactly like `iledclock-settings-sheet.ts`.
 *
 * A pasted URL is fetched client-side (`fetch`) rather than server-side: `iledclock/import/file`
 * only accepts `data_b64`, no `url` field, so this sheet is what turns either a picked file or a
 * fetched URL into the same base64 payload before calling it. Many third-party image hosts block
 * cross-origin `fetch` reads (CORS); that failure surfaces as an honest, actionable message
 * rather than a silent/blank failure -- see `_fetchUrl`.
 */

import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { createRef, ref } from "lit/directives/ref.js";
import type { HomeAssistant } from "../types.ts";
import { GRID_HEIGHT, GRID_WIDTH, type PixelFrame } from "../lib/grid.ts";
import { base64ToFrame } from "../lib/design-codec.ts";
import { frameIndexAtTime } from "../lib/frame-player.ts";
import { hexToRgb, rgbToHex } from "../lib/color.ts";
import { describeWsError } from "../lib/ws-query.ts";
import { showRequest } from "../lib/ws-api.ts";
import {
  availableLayoutOptions,
  filenameForUrl,
  galleryLayoutLabel,
  importFileRequest,
  isImportFileSaved,
  isRasterImportFile,
  normalizeAdjustOptions,
  validateImportFile,
  type GalleryAdjustOptions,
  type GalleryLayout,
  type GalleryPreviewResult,
  type ImportFileResult,
} from "../lib/gallery-api.ts";
import { ALL_CROP_HANDLES, centeredCropBox, moveCropBox, resizeCropBox, screenDeltaToImageDelta, type CropBox, type CropHandle } from "../lib/gallery-crop.ts";
import { mdiIcon } from "../lib/mdi-icons.ts";
import { TOKENS_CSS } from "../styles/tokens.ts";
import "./iledclock-matrix-canvas.ts";
import "./iledclock-segmented-picker.ts";
import "./iledclock-hold-button.ts";
import "./iledclock-stepper.ts";

const ADJUST_DEBOUNCE_MS = 250;
const MAX_ADJUST_OFFSET_UI = 64;

interface SourceDimensions {
  width: number;
  height: number;
}

export class IledclockImportSheet extends LitElement {
  static properties = {
    hass: { attribute: false },
    entryId: { attribute: false },
    open: { type: Boolean, reflect: true },
    _stage: { state: true },
    _sourceDataUrl: { state: true },
    _naturalWidth: { state: true },
    _naturalHeight: { state: true },
    _cropBox: { state: true },
    _cropTouched: { state: true },
    _urlInput: { state: true },
    _fetchingUrl: { state: true },
    _pickError: { state: true },
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
  declare _stage: "pick" | "preview";
  declare _sourceDataUrl: string | null;
  declare _naturalWidth: number;
  declare _naturalHeight: number;
  declare _cropBox: CropBox | null;
  declare _cropTouched: boolean;
  declare _urlInput: string;
  declare _fetchingUrl: boolean;
  declare _pickError: string | null;
  declare _layout: GalleryLayout;
  declare _adjustOpen: boolean;
  declare _adjust: GalleryAdjustOptions;
  declare _preview: GalleryPreviewResult | null;
  declare _previewLoading: boolean;
  declare _previewError: string | null;
  declare _saving: "save" | "show" | null;
  declare _actionError: string | null;

  private _filename = "";
  private _dataB64 = "";
  private _fileSizeBytes = 0;
  private _pixelFrames: PixelFrame[] = [];
  private _playStartedAt = 0;
  private _rafId: number | null = null;
  private _requestId = 0;
  private _debounceTimer: ReturnType<typeof setTimeout> | undefined;

  private readonly _sourceImgRef = createRef<HTMLImageElement>();
  private _dragMode: "move" | CropHandle | null = null;
  private _dragStartClientX = 0;
  private _dragStartClientY = 0;
  private _dragStartBox: CropBox | null = null;
  private _dragRenderedWidth = 0;
  private _dragRenderedHeight = 0;

  constructor() {
    super();
    this.open = false;
    this._stage = "pick";
    this._sourceDataUrl = null;
    this._naturalWidth = 0;
    this._naturalHeight = 0;
    this._cropBox = null;
    this._cropTouched = false;
    this._urlInput = "";
    this._fetchingUrl = false;
    this._pickError = null;
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
    this._teardownDrag();
  }

  protected updated(changed: PropertyValues): void {
    if (changed.has("open") && this.open) this._resetState();
    if (changed.has("_preview")) {
      this._pixelFrames = this._preview ? this._preview.frames.map((b64, i) => base64ToFrame(b64, GRID_WIDTH, GRID_HEIGHT, this._preview!.delays_ms[i] ?? 100)) : [];
      this._playStartedAt = performance.now();
    }
  }

  private _resetState(): void {
    this._stage = "pick";
    this._filename = "";
    this._dataB64 = "";
    this._fileSizeBytes = 0;
    this._sourceDataUrl = null;
    this._naturalWidth = 0;
    this._naturalHeight = 0;
    this._cropBox = null;
    this._cropTouched = false;
    this._urlInput = "";
    this._fetchingUrl = false;
    this._pickError = null;
    this._layout = "auto";
    this._adjustOpen = false;
    this._adjust = {};
    this._preview = null;
    this._previewError = null;
    this._actionError = null;
    this._pixelFrames = [];
    this._stopLoop();
  }

  // ---- playback loop (own adapted preview; deliberately not gated by reduced motion -- see
  // iledclock-gallery-item-sheet.ts's header comment for the same reasoning) ----

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

  // ---- pick stage: file / drop / URL ----

  private _onFileInputChange = async (event: Event): Promise<void> => {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (file) await this._acceptFile(file);
  };

  private _onDrop = async (event: DragEvent): Promise<void> => {
    event.preventDefault();
    const file = event.dataTransfer?.files?.[0];
    if (file) await this._acceptFile(file);
  };

  private _onDragOver = (event: DragEvent): void => {
    event.preventDefault();
  };

  private async _acceptFile(file: File): Promise<void> {
    const error = validateImportFile(file.name, file.size);
    if (error) {
      this._pickError = error;
      return;
    }
    const dataUrl = await this._readAsDataUrl(file);
    const b64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
    this._beginPreviewStage(file.name, b64, file.size, isRasterImportFile(file.name) ? dataUrl : null);
  }

  private _readAsDataUrl(source: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(source);
    });
  }

  private _fetchUrl = async (): Promise<void> => {
    const url = this._urlInput.trim();
    if (!url) return;
    this._fetchingUrl = true;
    this._pickError = null;
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Server responded ${response.status}`);
      const blob = await response.blob();
      const filename = filenameForUrl(url, blob.type);
      const error = validateImportFile(filename, blob.size);
      if (error) {
        this._pickError = error;
        return;
      }
      const dataUrl = await this._readAsDataUrl(blob);
      const b64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
      this._beginPreviewStage(filename, b64, blob.size, isRasterImportFile(filename) ? dataUrl : null);
    } catch {
      this._pickError = "Couldn't load that image directly (many sites block this). Try saving it to your device and picking the file instead.";
    } finally {
      this._fetchingUrl = false;
    }
  };

  private _beginPreviewStage(filename: string, dataB64: string, sizeBytes: number, sourceDataUrl: string | null): void {
    this._filename = filename;
    this._dataB64 = dataB64;
    this._fileSizeBytes = sizeBytes;
    this._sourceDataUrl = sourceDataUrl;
    this._naturalWidth = 0;
    this._naturalHeight = 0;
    this._cropBox = null;
    this._cropTouched = false;
    this._layout = "auto";
    this._adjust = {};
    this._adjustOpen = false;
    this._pickError = null;
    this._stage = "preview";
    void this._loadPreview();
    this._startLoop();
  }

  private _backToPick(): void {
    this._resetState();
  }

  private _onSourceImageLoad = (): void => {
    const img = this._sourceImgRef.value;
    if (!img) return;
    this._naturalWidth = img.naturalWidth;
    this._naturalHeight = img.naturalHeight;
    this._cropBox = centeredCropBox(img.naturalWidth, img.naturalHeight);
  };

  // ---- preview / adjust ----

  private _sourceDimensions(): SourceDimensions {
    if (this._naturalWidth > 0 && this._naturalHeight > 0) return { width: this._naturalWidth, height: this._naturalHeight };
    if (this._preview) return { width: this._preview.report.native_size[0], height: this._preview.report.native_size[1] };
    return { width: GRID_WIDTH, height: GRID_HEIGHT };
  }

  private _buildOptions(): GalleryAdjustOptions {
    const raw: GalleryAdjustOptions = { ...this._adjust };
    if (this._layout !== "auto") raw.layout = this._layout;
    if (this._sourceDataUrl && this._cropTouched && this._cropBox) raw.crop = this._cropBox;
    const dims = this._sourceDimensions();
    return normalizeAdjustOptions(raw, dims.width, dims.height);
  }

  private async _loadPreview(): Promise<void> {
    if (!this.entryId || !this.hass.callWS || !this._filename) return;
    const requestId = ++this._requestId;
    this._previewLoading = true;
    this._previewError = null;
    try {
      const result = await this.hass.callWS<GalleryPreviewResult>(
        importFileRequest(this.entryId, { filename: this._filename, dataB64: this._dataB64, options: this._buildOptions(), save: false }),
      );
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
    clearTimeout(this._debounceTimer);
    this._debounceTimer = setTimeout(() => void this._loadPreview(), ADJUST_DEBOUNCE_MS);
  }

  private _clearBackground = (): void => {
    const { background: _dropped, ...rest } = this._adjust;
    this._adjust = rest;
    void this._loadPreview();
  };

  private _resetCrop = (): void => {
    this._cropTouched = false;
    if (this._naturalWidth > 0) this._cropBox = centeredCropBox(this._naturalWidth, this._naturalHeight);
    void this._loadPreview();
  };

  // ---- draggable crop box (raster sources only) ----

  private _startDrag(event: PointerEvent, mode: "move" | CropHandle): void {
    if (!this._cropBox) return;
    event.preventDefault();
    event.stopPropagation();
    const img = this._sourceImgRef.value;
    if (!img) return;
    const rect = img.getBoundingClientRect();
    this._dragMode = mode;
    this._dragStartClientX = event.clientX;
    this._dragStartClientY = event.clientY;
    this._dragStartBox = this._cropBox;
    this._dragRenderedWidth = rect.width;
    this._dragRenderedHeight = rect.height;
    window.addEventListener("pointermove", this._onDragMove);
    window.addEventListener("pointerup", this._onDragEnd);
    window.addEventListener("pointercancel", this._onDragEnd);
  }

  private _onDragMove = (event: PointerEvent): void => {
    if (!this._dragMode || !this._dragStartBox) return;
    const { dx, dy } = screenDeltaToImageDelta(
      event.clientX - this._dragStartClientX,
      event.clientY - this._dragStartClientY,
      this._dragRenderedWidth,
      this._dragRenderedHeight,
      this._naturalWidth,
      this._naturalHeight,
    );
    this._cropBox =
      this._dragMode === "move"
        ? moveCropBox(this._dragStartBox, dx, dy, this._naturalWidth, this._naturalHeight)
        : resizeCropBox(this._dragStartBox, this._dragMode, dx, dy, this._naturalWidth, this._naturalHeight);
    this._cropTouched = true;
  };

  private _onDragEnd = (): void => {
    if (!this._dragMode) return;
    this._teardownDrag();
    void this._loadPreview();
  };

  private _teardownDrag(): void {
    this._dragMode = null;
    this._dragStartBox = null;
    window.removeEventListener("pointermove", this._onDragMove);
    window.removeEventListener("pointerup", this._onDragEnd);
    window.removeEventListener("pointercancel", this._onDragEnd);
  }

  // ---- actions ----

  private async _finishImport(showAfter: boolean): Promise<void> {
    if (!this.entryId || !this.hass.callWS) return;
    this._saving = showAfter ? "show" : "save";
    this._actionError = null;
    try {
      const result = await this.hass.callWS<ImportFileResult>(
        importFileRequest(this.entryId, { filename: this._filename, dataB64: this._dataB64, options: this._buildOptions(), save: true }),
      );
      if (!isImportFileSaved(result)) throw new Error("Save didn't return a design id.");
      if (showAfter) await this.hass.callWS(showRequest(this.entryId, { design_id: result.design_id }));
      this.dispatchEvent(new CustomEvent("iledclock-designs-changed", { bubbles: true, composed: true }));
      this.dispatchEvent(new CustomEvent("iledclock-open-design", { detail: { design_id: result.design_id }, bubbles: true, composed: true }));
      this._close();
    } catch (err) {
      this._actionError = describeWsError(err);
    } finally {
      this._saving = null;
    }
  }

  private _save = (): Promise<void> => this._finishImport(false);
  private _show = (): Promise<void> => this._finishImport(true);

  private _close(): void {
    this.dispatchEvent(new CustomEvent("close-requested", { bubbles: true, composed: true }));
  }

  private _onKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") this._close();
  }

  // ---- render ----

  render() {
    if (!this.open) return nothing;
    return html`
      <div class="backdrop" @click=${this._close}></div>
      <div class="panel" role="dialog" aria-modal="true" aria-label="Import" @keydown=${(e: KeyboardEvent) => this._onKeydown(e)}>
        <header>
          <h2>Import</h2>
          <button type="button" class="icon-button" @click=${this._close} aria-label="Close">${mdiIcon("close")}</button>
        </header>
        <div class="body">${this._stage === "pick" ? this._renderPick() : this._renderPreviewStage()}</div>
      </div>
    `;
  }

  private _renderPick() {
    return html`
      <div class="drop-zone" @dragover=${this._onDragOver} @drop=${this._onDrop}>
        <span class="drop-icon">${mdiIcon("upload")}</span>
        <p>Drop a GIF, PNG, JPEG, WebP, .aseprite or .piskel file</p>
        <label class="pick-button">
          Choose a file
          <input type="file" accept=".gif,.png,.jpg,.jpeg,.webp,.aseprite,.ase,.piskel" hidden @change=${this._onFileInputChange} />
        </label>
      </div>
      <div class="url-row">
        <input
          class="url-input"
          type="text"
          placeholder="Or paste an image URL"
          .value=${this._urlInput}
          @input=${(e: Event) => (this._urlInput = (e.target as HTMLInputElement).value)}
        />
        <button type="button" class="secondary-action" ?disabled=${this._fetchingUrl || !this._urlInput.trim()} @click=${this._fetchUrl}>
          ${this._fetchingUrl ? "Fetching…" : "Fetch"}
        </button>
      </div>
      ${this._pickError ? html`<p class="error">${this._pickError}</p>` : nothing}
    `;
  }

  private _renderPreviewStage() {
    const dims = this._sourceDimensions();
    return html`
      ${this._actionError ? html`<p class="error">${this._actionError}</p>` : nothing}
      ${this._sourceDataUrl
        ? html`
            <div class="crop-stage">
              <img class="source-img" ${ref(this._sourceImgRef)} src=${this._sourceDataUrl} @load=${this._onSourceImageLoad} alt="" />
              ${this._cropBox ? this._renderCropOverlay(this._cropBox) : nothing}
            </div>
            <div class="crop-controls">
              <p class="hint">Drag the box to crop, or drag a handle to resize.</p>
              ${this._cropTouched ? html`<button type="button" class="link-button" @click=${this._resetCrop}>Reset crop</button>` : nothing}
            </div>
          `
        : html`<p class="hint">${this._filename} can't be shown directly here (only the server can decode it) -- showing the adapted preview below.</p>`}
      <div class="preview-plate">
        ${this._pixelFrames.length === 0 && this._previewLoading
          ? html`<div class="skeleton"></div>`
          : html`<iledclock-matrix-canvas .frame=${this._currentFrame()} bloom></iledclock-matrix-canvas>`}
      </div>
      ${this._previewError ? html`<p class="error">${this._previewError}</p>` : nothing}
      <iledclock-segmented-picker
        group-label="Layout"
        content-fit
        .options=${availableLayoutOptions(this._preview?.layouts_available ?? []).map((l) => ({ value: l, label: galleryLayoutLabel(l) }))}
        .value=${this._layout}
        @option-selected=${(e: CustomEvent<{ value: string }>) => this._selectLayout(e.detail.value as GalleryLayout)}
      ></iledclock-segmented-picker>
      ${this._layout === "auto" && this._preview ? html`<p class="hint">Auto chose ${galleryLayoutLabel(this._preview.layout).toLowerCase()}.</p>` : nothing}
      <button type="button" class="disclosure" @click=${() => (this._adjustOpen = !this._adjustOpen)}>${mdiIcon(this._adjustOpen ? "chevronUp" : "chevronDown")} Adjust</button>
      ${this._adjustOpen ? this._renderAdjust(dims) : nothing}
      <button type="button" class="link-row" @click=${() => this._backToPick()}>${mdiIcon("chevronLeft")} Choose a different file</button>
      <div class="actions">
        <button type="button" class="secondary-action" ?disabled=${this._saving !== null} @click=${this._save}>${mdiIcon("save")} ${this._saving === "save" ? "Saving…" : "Save"}</button>
        <iledclock-hold-button label="Hold to show on clock" complete-label="Showing" ?disabled=${this._saving !== null} @confirmed=${this._show}></iledclock-hold-button>
      </div>
    `;
  }

  private _renderCropOverlay(box: CropBox) {
    const w = this._naturalWidth || 1;
    const h = this._naturalHeight || 1;
    const style = `left:${(box.x / w) * 100}%; top:${(box.y / h) * 100}%; width:${(box.w / w) * 100}%; height:${(box.h / h) * 100}%;`;
    return html`
      <div class="crop-box" style=${style} @pointerdown=${(e: PointerEvent) => this._startDrag(e, "move")}>
        ${ALL_CROP_HANDLES.map((handle) => html`<span class="handle handle-${handle}" @pointerdown=${(e: PointerEvent) => this._startDrag(e, handle)}></span>`)}
      </div>
    `;
  }

  private _renderAdjust(dims: SourceDimensions) {
    const scale = this._adjust.scale ?? 1;
    const offset = this._adjust.offset ?? { x: 0, y: 0 };
    const enhance = this._adjust.enhance ?? false;
    return html`
      <div class="adjust">
        ${!this._sourceDataUrl ? this._renderNumericCrop(dims) : nothing}
        <label class="stepper-field">
          Scale<iledclock-stepper .value=${scale} min="1" max="16" step="1" @value-selected=${(e: CustomEvent<{ value: number }>) => this._updateAdjust({ scale: e.detail.value })}></iledclock-stepper>
        </label>
        <div class="two-up">
          <label class="stepper-field">
            Offset X<iledclock-stepper
              .value=${offset.x}
              min=${-MAX_ADJUST_OFFSET_UI}
              max=${MAX_ADJUST_OFFSET_UI}
              step="1"
              @value-selected=${(e: CustomEvent<{ value: number }>) => this._updateAdjust({ offset: { ...offset, x: e.detail.value } })}
            ></iledclock-stepper>
          </label>
          <label class="stepper-field">
            Offset Y<iledclock-stepper
              .value=${offset.y}
              min=${-MAX_ADJUST_OFFSET_UI}
              max=${MAX_ADJUST_OFFSET_UI}
              step="1"
              @value-selected=${(e: CustomEvent<{ value: number }>) => this._updateAdjust({ offset: { ...offset, y: e.detail.value } })}
            ></iledclock-stepper>
          </label>
        </div>
        <div class="background-row">
          <span class="adjust-label">Background</span>
          <input
            type="color"
            .value=${rgbToHex(this._adjust.background ?? [0, 0, 0])}
            @input=${(e: Event) => this._updateAdjust({ background: hexToRgb((e.target as HTMLInputElement).value) })}
          />
          ${this._adjust.background ? html`<button type="button" class="link-button" @click=${this._clearBackground}>Clear</button>` : nothing}
        </div>
        <button type="button" class="toggle-row" @click=${() => this._updateAdjust({ enhance: !enhance })}>
          <span class="toggle-label">Enhance colours</span>
          <span class="toggle-pill ${enhance ? "on" : ""}"><span class="toggle-knob"></span></span>
        </button>
      </div>
    `;
  }

  private _renderNumericCrop(dims: SourceDimensions) {
    const crop = this._adjust.crop ?? { x: 0, y: 0, w: dims.width, h: dims.height };
    return html`
      <span class="adjust-label">Crop (source pixels)</span>
      <div class="crop-grid">
        <label class="stepper-field">
          X<iledclock-stepper .value=${crop.x} min="0" .max=${dims.width} step="1" @value-selected=${(e: CustomEvent<{ value: number }>) => this._updateAdjust({ crop: { ...crop, x: e.detail.value } })}></iledclock-stepper>
        </label>
        <label class="stepper-field">
          Y<iledclock-stepper .value=${crop.y} min="0" .max=${dims.height} step="1" @value-selected=${(e: CustomEvent<{ value: number }>) => this._updateAdjust({ crop: { ...crop, y: e.detail.value } })}></iledclock-stepper>
        </label>
        <label class="stepper-field">
          Width<iledclock-stepper .value=${crop.w} min="1" .max=${dims.width} step="1" @value-selected=${(e: CustomEvent<{ value: number }>) => this._updateAdjust({ crop: { ...crop, w: e.detail.value } })}></iledclock-stepper>
        </label>
        <label class="stepper-field">
          Height<iledclock-stepper .value=${crop.h} min="1" .max=${dims.height} step="1" @value-selected=${(e: CustomEvent<{ value: number }>) => this._updateAdjust({ crop: { ...crop, h: e.detail.value } })}></iledclock-stepper>
        </label>
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
    .drop-zone {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 10px;
      padding: 32px 16px;
      border-radius: var(--lu-radius-tile);
      border: 2px dashed var(--lu-edge);
      text-align: center;
    }
    .drop-zone p {
      margin: 0;
      font-size: 14px;
      color: var(--lu-ink-2);
    }
    .drop-icon {
      display: inline-flex;
      color: var(--lu-ink-2);
      font-size: 28px;
    }
    .pick-button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: var(--lu-target, 48px);
      padding: 0 20px;
      border-radius: var(--lu-radius-pill);
      background: var(--lu-accent);
      color: var(--lu-accent-ink);
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
    }
    .url-row {
      display: flex;
      gap: 8px;
    }
    .url-input {
      flex: 1;
      min-height: var(--lu-target, 48px);
      border-radius: var(--lu-radius-control);
      border: 1px solid var(--lu-edge);
      background: var(--lu-card);
      color: var(--lu-ink);
      padding: 0 12px;
      box-sizing: border-box;
      font-size: 14px;
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
      padding: 0 16px;
    }
    .secondary-action:disabled {
      opacity: 0.5;
      cursor: default;
    }
    .crop-stage {
      position: relative;
      border-radius: var(--lu-radius-tile);
      overflow: hidden;
      background: #050607;
      touch-action: none;
    }
    .source-img {
      display: block;
      width: 100%;
      height: auto;
      max-height: 320px;
      object-fit: contain;
    }
    .crop-box {
      position: absolute;
      border: 2px solid var(--lu-accent);
      box-shadow: 0 0 0 2000px rgba(0, 0, 0, 0.45);
      touch-action: none;
      cursor: move;
    }
    .handle {
      position: absolute;
      width: 16px;
      height: 16px;
      margin: -8px;
      background: #fff;
      border: 2px solid var(--lu-accent);
      border-radius: 50%;
      touch-action: none;
    }
    .handle-nw { top: 0; left: 0; cursor: nwse-resize; }
    .handle-n { top: 0; left: 50%; cursor: ns-resize; }
    .handle-ne { top: 0; left: 100%; cursor: nesw-resize; }
    .handle-e { top: 50%; left: 100%; cursor: ew-resize; }
    .handle-se { top: 100%; left: 100%; cursor: nwse-resize; }
    .handle-s { top: 100%; left: 50%; cursor: ns-resize; }
    .handle-sw { top: 100%; left: 0; cursor: nesw-resize; }
    .handle-w { top: 50%; left: 0; cursor: ew-resize; }
    .crop-controls {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
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
      animation: import-shimmer 1.4s ease infinite;
    }
    @keyframes import-shimmer {
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
    .link-row {
      display: flex;
      align-items: center;
      gap: 4px;
      align-self: flex-start;
      background: none;
      border: none;
      color: var(--lu-ink-2);
      font-size: 13px;
      cursor: pointer;
      padding: 4px 0;
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
    .actions {
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding-top: 4px;
    }
    @media (prefers-reduced-motion: reduce) {
      * {
        transition: none !important;
      }
      .skeleton {
        animation: none;
        background: #0f1112;
      }
    }
    `,
  ];
}

customElements.define("iledclock-import-sheet", IledclockImportSheet);

declare global {
  interface HTMLElementTagNameMap {
    "iledclock-import-sheet": IledclockImportSheet;
  }
}
