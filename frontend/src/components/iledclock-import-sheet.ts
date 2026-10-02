/** Import a local artwork file or a pasted image URL, adapt it to the clock, then save or show it. */
import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { createRef, ref } from "lit/directives/ref.js";
import type { ContentClass, HomeAssistant } from "../types.ts";
import type { PixelFrame } from "../lib/grid.ts";
import { GRID_HEIGHT, GRID_WIDTH } from "../lib/grid.ts";
import { base64ToFrame, frameToBase64 } from "../lib/design-codec.ts";
import type { PlaybackPreviewResult } from "../types.ts";
import { PlaybackSession } from "../lib/playback-session.ts";
import { designsSetPlaybackRequest, playbackPreviewRequest } from "../lib/ws-api.ts";
import { describeWsError } from "../lib/ws-query.ts";
import { resolveShowTarget, showWithUndo, type ShowTarget } from "../lib/show-with-undo.ts";
import { SLOT_CHECK_FAILED } from "../lib/slots.ts";
import {
  availableLayoutOptions,
  describeAutoFit,
  filenameForUrl,
  galleryLayoutLabel,
  importFileRequest,
  isImportFileSaved,
  isRasterImportFile,
  MAX_IMPORT_FILE_BYTES,
  normalizeAdjustOptions,
  validateImportFile,
  type GalleryAdjustOptions,
  type GalleryLayout,
  type GalleryPreviewResult,
  type ImportFileResult,
} from "../lib/gallery-api.ts";
import { ALL_CROP_HANDLES, centeredCropBox, clampCropBox, moveCropBox, resizeCropBox, screenDeltaToImageDelta, type CropBox, type CropHandle } from "../lib/gallery-crop.ts";
import { hexToRgb, rgbToHex } from "../lib/color.ts";
import type { LuToastRequest } from "./lu-toast.ts";
import { mdiIcon } from "../lib/mdi-icons.ts";
import { SURFACES_CSS, TOKENS_CSS } from "../styles/tokens.ts";
import "./iledclock-led-preview.ts";
import "./iledclock-playback-control.ts";
import "./iledclock-segmented-picker.ts";
import "./iledclock-stepper.ts";
import "./lu-error.ts";
import "./lu-skeleton.ts";
import "./lu-pill-button.ts";
import "./iledclock-slot-choice.ts";
import "./lu-sheet.ts";

const ADJUST_DEBOUNCE_MS = 250;
const MAX_ADJUST_OFFSET_UI = 64;

interface SourceDimensions { width: number; height: number; }

const PREVIEW_FRAME_CACHE = new WeakMap<GalleryPreviewResult, PixelFrame[]>();

function previewFrames(preview: GalleryPreviewResult): PixelFrame[] {
  let frames = PREVIEW_FRAME_CACHE.get(preview);
  if (!frames) {
    frames = preview.frames.map((encoded, index) => base64ToFrame(encoded, GRID_WIDTH, GRID_HEIGHT, preview.delays_ms[index] ?? 100));
    PREVIEW_FRAME_CACHE.set(preview, frames);
  }
  return frames;
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
  declare _layout: string;
  declare _adjustOpen: boolean;
  declare _adjust: GalleryAdjustOptions;
  declare _preview: GalleryPreviewResult | null;
  declare _previewLoading: boolean;
  declare _previewError: string | null;
  declare _saving: "save" | "show" | null;
  declare _actionError: string | null;

  private _playback = this._makePlayback();
  private _playbackDisposed = false;
  private _filename = "";
  private _dataB64 = "";
  private _requestId = 0;
  private _debounceTimer: number | undefined;
  private readonly _sourceImgRef = createRef<HTMLImageElement>();
  private _dragMode: "move" | CropHandle | null = null;
  private _dragStartX = 0;
  private _dragStartY = 0;
  private _dragStartBox: CropBox | null = null;
  private _dragImageWidth = 0;
  private _dragImageHeight = 0;

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

  private _makePlayback(): PlaybackSession {
    return new PlaybackSession({
      callWS: (request) => this.hass.callWS!<PlaybackPreviewResult>(request as never),
      buildRequest: (state, authored) => playbackPreviewRequest({ frames: authored.map(frameToBase64), delays: authored.map((frame) => frame.durationMs) }, state),
      onChange: () => this.requestUpdate(),
    });
  }

  /** Back to Original with no frames: a new file starts from the artwork's own pace. */
  private _resetPlayback(): void {
    this._playback.setSource([], { state: { speed: null, smooth: null } });
  }

  connectedCallback(): void {
    super.connectedCallback();
    if (this._playbackDisposed) {
      this._playbackDisposed = false;
      this._playback = this._makePlayback();
      if (this._preview) this._playback.setSource(previewFrames(this._preview));
    }
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this._playback.dispose();
    this._playbackDisposed = true;
    window.clearTimeout(this._debounceTimer);
    this._debounceTimer = undefined;
    this._teardownCropDrag();
  }

  protected willUpdate(changed: PropertyValues): void {
    // Keep the session (and the chosen speed) while a new preview is on its way.
    if (changed.has("_preview") && this._preview) this._playback.setSource(previewFrames(this._preview));
  }

  protected updated(changed: PropertyValues): void {
    if (changed.has("open") && this.open) this._resetState();
  }

  private _resetState(): void {
    window.clearTimeout(this._debounceTimer);
    this._debounceTimer = undefined;
    this._stage = "pick";
    this._filename = "";
    this._dataB64 = "";
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
    this._actionError = null;
    this._requestId++;
    this._resetPlayback();
  }

  private _onFileInputChange = async (event: Event): Promise<void> => {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (file) await this._acceptFile(file);
  };

  private _onDrop = async (event: DragEvent): Promise<void> => {
    event.preventDefault();
    const file = event.dataTransfer?.files?.[0];
    if (file) await this._acceptFile(file);
  };

  private _onDragOver(event: DragEvent): void {
    event.preventDefault();
  }

  private async _acceptFile(file: File): Promise<void> {
    const validation = validateImportFile(file.name, file.size);
    if (validation) {
      this._pickError = validation;
      return;
    }
    try {
      const dataUrl = await this._readAsDataUrl(file);
      this._beginPreviewStage(file.name, dataUrl.slice(dataUrl.indexOf(",") + 1), isRasterImportFile(file.name) ? dataUrl : null);
    } catch {
      this._pickError = "That file couldn't be read. Try choosing it again.";
    }
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
      const contentType = response.headers.get("content-type") ?? "";
      const filename = filenameForUrl(url, contentType);
      const advertisedBytes = Number(response.headers.get("content-length"));
      if (Number.isFinite(advertisedBytes) && advertisedBytes > MAX_IMPORT_FILE_BYTES) {
        this._pickError = validateImportFile(filename, advertisedBytes);
        return;
      }
      const chunks: Uint8Array[] = [];
      let size = 0;
      const reader = response.body?.getReader();
      if (reader) {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          if (!part.value) continue;
          size += part.value.byteLength;
          if (size > MAX_IMPORT_FILE_BYTES) {
            await reader.cancel();
            this._pickError = validateImportFile(filename, size);
            return;
          }
          chunks.push(part.value);
        }
      }
      let blob: Blob;
      if (reader) {
        const merged = new ArrayBuffer(size);
        const bytes = new Uint8Array(merged);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.byteLength;
        }
        blob = new Blob([merged], { type: contentType });
      } else {
        blob = await response.blob();
      }
      const validation = validateImportFile(filename, blob.size);
      if (validation) {
        this._pickError = validation;
        return;
      }
      const dataUrl = await this._readAsDataUrl(blob);
      this._beginPreviewStage(filename, dataUrl.slice(dataUrl.indexOf(",") + 1), isRasterImportFile(filename) ? dataUrl : null);
    } catch {
      this._pickError = "Couldn't load that image directly. Many sites block image imports; save it to your device and pick the file instead.";
    } finally {
      this._fetchingUrl = false;
    }
  };

  private _beginPreviewStage(filename: string, dataB64: string, sourceDataUrl: string | null): void {
    this._filename = filename;
    this._dataB64 = dataB64;
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
    this._resetPlayback();
    void this._loadPreview();
  }

  private _backToPick(): void {
    window.clearTimeout(this._debounceTimer);
    this._debounceTimer = undefined;
    this._requestId++;
    this._stage = "pick";
    this._sourceDataUrl = null;
    this._preview = null;
    this._previewError = null;
    this._actionError = null;
    this._resetPlayback();
  }

  private _onSourceImageLoad = (): void => {
    const img = this._sourceImgRef.value;
    if (!img) return;
    this._naturalWidth = img.naturalWidth;
    this._naturalHeight = img.naturalHeight;
    const crop = this._cropTouched && this._cropBox ? this._cropBox : centeredCropBox(img.naturalWidth, img.naturalHeight);
    this._cropBox = clampCropBox(crop, img.naturalWidth, img.naturalHeight);
  };

  private _sourceDimensions(): SourceDimensions {
    if (this._naturalWidth > 0 && this._naturalHeight > 0) return { width: this._naturalWidth, height: this._naturalHeight };
    const size = this._preview?.report.native_size;
    if (size) return { width: size[0], height: size[1] };
    return { width: GRID_WIDTH, height: GRID_HEIGHT };
  }

  private _buildOptions(): GalleryAdjustOptions {
    const raw: GalleryAdjustOptions = { ...this._adjust };
    if (this._layout !== "auto") raw.layout = this._layout as GalleryLayout;
    if (this._sourceDataUrl && this._cropTouched && this._cropBox) raw.crop = this._cropBox;
    const dimensions = this._sourceDimensions();
    return normalizeAdjustOptions(raw, dimensions.width, dimensions.height);
  }

  private async _loadPreview(): Promise<void> {
    if (!this.entryId || !this.hass?.callWS || !this._filename) return;
    const requestId = ++this._requestId;
    this._previewLoading = true;
    this._previewError = null;
    try {
      const preview = await this.hass.callWS<GalleryPreviewResult>(importFileRequest(this.entryId, {
        filename: this._filename,
        dataB64: this._dataB64,
        options: this._buildOptions(),
      }));
      if (requestId === this._requestId) this._preview = preview;
    } catch (error) {
      if (requestId !== this._requestId) return;
      this._previewError = describeWsError(error);
      this._preview = null;
    } finally {
      if (requestId === this._requestId) this._previewLoading = false;
    }
  }

  private _selectLayout(layout: string): void {
    this._layout = layout;
    void this._loadPreview();
  }

  private _updateAdjust(patch: Partial<GalleryAdjustOptions>): void {
    this._adjust = { ...this._adjust, ...patch };
    window.clearTimeout(this._debounceTimer);
    this._debounceTimer = window.setTimeout(() => void this._loadPreview(), ADJUST_DEBOUNCE_MS);
  }

  private _clearBackground = (): void => {
    const { background: _unused, ...rest } = this._adjust;
    this._adjust = rest;
    void this._loadPreview();
  };

  private _resetCrop = (): void => {
    this._cropTouched = false;
    if (this._naturalWidth > 0) this._cropBox = centeredCropBox(this._naturalWidth, this._naturalHeight);
    const next = { ...this._adjust };
    delete next.crop;
    this._adjust = next;
    window.clearTimeout(this._debounceTimer);
    this._debounceTimer = undefined;
    void this._loadPreview();
  };

  private _startCropDrag(event: PointerEvent, mode: "move" | CropHandle): void {
    if (!this._cropBox) return;
    event.preventDefault();
    event.stopPropagation();
    const image = this._sourceImgRef.value;
    if (!image) return;
    const rect = image.getBoundingClientRect();
    this._dragMode = mode;
    this._dragStartX = event.clientX;
    this._dragStartY = event.clientY;
    this._dragStartBox = this._cropBox;
    this._dragImageWidth = rect.width;
    this._dragImageHeight = rect.height;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    window.addEventListener("pointermove", this._onCropDragMove);
    window.addEventListener("pointerup", this._onCropDragEnd);
    window.addEventListener("pointercancel", this._onCropDragEnd);
  }

  private _onCropDragMove = (event: PointerEvent): void => {
    if (!this._dragMode || !this._dragStartBox) return;
    const delta = screenDeltaToImageDelta(event.clientX - this._dragStartX, event.clientY - this._dragStartY, this._dragImageWidth, this._dragImageHeight, this._naturalWidth, this._naturalHeight);
    this._cropBox = this._dragMode === "move"
      ? moveCropBox(this._dragStartBox, delta.dx, delta.dy, this._naturalWidth, this._naturalHeight)
      : resizeCropBox(this._dragStartBox, this._dragMode, delta.dx, delta.dy, this._naturalWidth, this._naturalHeight);
    this._cropTouched = true;
  };

  private _onCropDragEnd = (): void => {
    if (!this._dragMode) return;
    this._teardownCropDrag();
    void this._loadPreview();
  };

  private _teardownCropDrag(): void {
    this._dragMode = null;
    this._dragStartBox = null;
    window.removeEventListener("pointermove", this._onCropDragMove);
    window.removeEventListener("pointerup", this._onCropDragEnd);
    window.removeEventListener("pointercancel", this._onCropDragEnd);
  }

  /** An "icon with clock" layout saves a design with a clock region; everything else is plain art. */
  private _contentClass(): ContentClass {
    return this._layout === "icon_with_clock" || this._preview?.layout === "icon_with_clock" ? "art_clock" : "art";
  }

  private async _finishImport(showAfter: boolean): Promise<void> {
    if (!this.entryId || !this.hass?.callWS || !this._preview || this._previewLoading) return;
    const entryId = this.entryId;
    this._saving = showAfter ? "show" : "save";
    this._actionError = null;
    try {
      // Fixed now, at the click, before anything is awaited: the artwork as it is adjusted, its title, and the kind of content (which
      // decides screen B). Saving takes a while and the layout and crop controls stay live meanwhile.
      const filename = this._filename;
      const contentClass = this._contentClass();
      const request = importFileRequest(entryId, { filename, dataB64: this._dataB64, options: this._buildOptions(), save: true });
      let target: ShowTarget | undefined;
      if (showAfter) {
        // Decided before anything is saved: if screen B is remembered but cannot be checked, nothing happens and the sheet says why.
        const resolved = await resolveShowTarget(this.hass, entryId, contentClass);
        if (!resolved) throw new Error(SLOT_CHECK_FAILED);
        target = resolved;
      }
      const result = await this.hass.callWS<ImportFileResult>(request);
      if (!isImportFileSaved(result)) throw new Error("The save did not return a design id.");
      // A fresh design is Original with auto smoothing already; only write a different choice.
      if (this._playback.hasMotion && (this._playback.speed !== null || this._playback.smooth !== null)) {
        await this.hass.callWS(designsSetPlaybackRequest(result.design_id, { speed: this._playback.speed, smooth: this._playback.smooth }));
      }
      const title = filename.replace(/\.[^.]+$/, "") || "Imported design";
      this.dispatchEvent(new CustomEvent("iledclock-designs-changed", { bubbles: true, composed: true }));
      if (target) {
        await showWithUndo(this, this.hass, entryId, { design_id: result.design_id }, title, { target });
      } else {
        this._toast({
          message: `${title} saved to Library`,
          actionLabel: "Open",
          action: () => {
            this.dispatchEvent(new CustomEvent("iledclock-open-design", { detail: { design_id: result.design_id }, bubbles: true, composed: true }));
          },
        });
      }
      this._close();
    } catch (error) {
      this._actionError = describeWsError(error);
    } finally {
      this._saving = null;
    }
  }

  private _toast(request: LuToastRequest): void {
    this.dispatchEvent(new CustomEvent<LuToastRequest>("lu-toast", { detail: request, bubbles: true, composed: true }));
  }

  private _save = (): Promise<void> => this._finishImport(false);
  private _show = (): Promise<void> => this._finishImport(true);

  private _close(): void {
    this.open = false;
    this._notifyClosed();
  }

  private _onSheetClosed = (): void => {
    this.open = false;
    this._notifyClosed();
  };

  private _notifyClosed(): void {
    this.dispatchEvent(new CustomEvent("close-requested", { bubbles: true, composed: true }));
  }

  render() {
    return html`<lu-sheet .open=${this.open} label="Import file" @closed=${this._onSheetClosed}>
      <div slot="header" class="sheet-heading">
        <div><h2>Import file</h2><p>Adapt artwork for the 32 × 16 clock.</p></div>
      </div>
      ${this._stage === "pick" ? this._renderPick() : this._renderPreviewStage()}
      ${this._stage === "pick" ? nothing : this._renderFooter()}
    </lu-sheet>`;
  }

  private _renderPick() {
    return html`
      <section class="pick-content" aria-label="Choose artwork">
        <div class="drop-zone" @dragover=${this._onDragOver} @drop=${this._onDrop}>
          <span class="drop-icon" aria-hidden="true">${mdiIcon("upload")}</span>
          <p>Drop a file here, or choose one. Supported: GIF, PNG, JPEG, WebP, .aseprite, .ase, .piskel. Maximum size: 8 MB.</p>
          <label class="file-picker">Choose a file<input type="file" accept=".gif,.png,.jpg,.jpeg,.webp,.aseprite,.ase,.piskel" @change=${this._onFileInputChange} /></label>
        </div>
        <div class="url-row">
          <label class="url-label">Or paste an image URL<input class="url-input" type="url" autocomplete="url" placeholder="https://example.com/art.gif" .value=${this._urlInput} @input=${(event: Event) => (this._urlInput = (event.currentTarget as HTMLInputElement).value)} /></label>
          <lu-pill-button variant="secondary" .label=${this._fetchingUrl ? "Fetching…" : "Fetch"} ?loading=${this._fetchingUrl} ?disabled=${this._fetchingUrl || !this._urlInput.trim()} @lu-press=${this._fetchUrl}></lu-pill-button>
        </div>
        ${this._pickError ? html`<p class="error" role="alert">${this._pickError}</p>` : nothing}
      </section>
    `;
  }

  private _renderPreviewStage() {
    const dims = this._sourceDimensions();
    const frames = this._preview ? previewFrames(this._preview) : [];
    const playback = this._playback;
    const motion = playback.hasMotion && frames.length > 1;
    const layoutOptions = availableLayoutOptions(this._preview?.layouts_available ?? []).map((layout) => ({ value: layout, label: galleryLayoutLabel(layout) }));
    return html`
      <section class="preview-content" aria-label="Preview imported artwork">
        ${this._actionError ? html`<p class="error" role="alert">${this._actionError}</p>` : nothing}
        ${this._sourceDataUrl ? html`
          <div class="crop-wrap">
            <div class="crop-stage">
              <img class="source-image" ${ref(this._sourceImgRef)} src=${this._sourceDataUrl} @load=${this._onSourceImageLoad} alt="Original artwork to crop" />
              ${this._cropBox ? this._renderCropOverlay(this._cropBox) : nothing}
            </div>
            <div class="crop-tools"><p>Use the crop fields below, or drag the box and its corners.</p></div>
          </div>
        ` : html`<p class="hint">${this._filename} is decoded on the clock server. The preview below shows the adapted result.</p>`}
        <div class="adapted-preview" aria-label="Adapted clock preview">
          ${frames.length > 0 ? html`<iledclock-led-preview context="hero" .frames=${motion ? playback.frames : frames} .delays=${motion ? playback.delays : this._preview?.delays_ms ?? []} .rate=${motion ? playback.rate : 1} .playing=${motion ? playback.playing : frames.length > 1} label="Adapted preview"></iledclock-led-preview>` : this._previewError ? nothing : html`<lu-skeleton variant="card" label="Loading adapted preview"></lu-skeleton>`}
        </div>
        ${this._previewError ? html`<lu-error title="Preview unavailable" .message=${this._previewError} @retry=${() => void this._loadPreview()}></lu-error>` : nothing}
        ${frames.length > 1 ? html`<iledclock-playback-control .session=${playback}></iledclock-playback-control>` : nothing}
        <iledclock-segmented-picker group-label="Layout" content-fit .options=${layoutOptions} .value=${this._layout} @option-selected=${(event: CustomEvent<{ value: string }>) => this._selectLayout(event.detail.value)}></iledclock-segmented-picker>
        ${this._layout === "auto" && this._preview ? html`<p class="hint">${describeAutoFit(this._preview.report.notes) ?? "Auto keeps pixel artwork crisp and adapts photos for the LEDs."}</p>` : nothing}
        <button type="button" class="disclosure" aria-expanded=${this._adjustOpen} @click=${() => (this._adjustOpen = !this._adjustOpen)}>${mdiIcon(this._adjustOpen ? "chevronUp" : "chevronDown")} Adjust</button>
        ${this._adjustOpen ? this._renderAdjust(dims) : nothing}
        <button type="button" class="text-button choose-again" @click=${() => this._backToPick()}>${mdiIcon("chevronLeft")} Choose a different file</button>
      </section>
    `;
  }

  /** Save / Show stay in view while the adjust controls scroll. */
  private _renderFooter() {
    const busy = this._saving !== null;
    return html`
      <div slot="footer" class="footer">
        <iledclock-slot-choice .hass=${this.hass} .entryId=${this.entryId} content-class=${this._contentClass()} ?disabled=${busy}></iledclock-slot-choice>
        <div class="actions">
          <lu-pill-button variant="secondary" label="Save" icon="mdi:content-save-outline" ?loading=${this._saving === "save"} ?disabled=${busy || !this._preview || this._previewLoading} @lu-press=${this._save}></lu-pill-button>
          <lu-pill-button variant="primary" label="Show on clock" icon="mdi:television-play" ?loading=${this._saving === "show"} ?disabled=${busy || !this._preview || this._previewLoading} @lu-press=${this._show}></lu-pill-button>
        </div>
      </div>
    `;
  }

  private _renderCropOverlay(box: CropBox) {
    const width = this._naturalWidth || 1;
    const height = this._naturalHeight || 1;
    const style = `left:${(box.x / width) * 100}%;top:${(box.y / height) * 100}%;width:${(box.w / width) * 100}%;height:${(box.h / height) * 100}%;`;
    return html`<div class="crop-box" style=${style} aria-hidden="true" @pointerdown=${(event: PointerEvent) => this._startCropDrag(event, "move")}>
      ${ALL_CROP_HANDLES.map((handle) => html`<span class="crop-handle handle-${handle}" aria-hidden="true" @pointerdown=${(event: PointerEvent) => this._startCropDrag(event, handle)}></span>`)}
    </div>`;
  }

  private _renderAdjust(dimensions: SourceDimensions) {
    const scale = this._adjust.scale ?? 1;
    const offset = this._adjust.offset ?? { x: 0, y: 0 };
    const enhance = this._adjust.enhance ?? false;
    return html`<div class="adjust-panel">
      ${this._renderNumericCrop(dimensions)}
      <label class="stepper-field">Scale <iledclock-stepper .value=${scale} min="1" max="16" step="1" label="scale" @value-selected=${(event: CustomEvent<{ value: number }>) => this._updateAdjust({ scale: event.detail.value })}></iledclock-stepper></label>
      <div class="offset-grid">
        <label class="stepper-field">Offset X <iledclock-stepper .value=${offset.x} min=${-MAX_ADJUST_OFFSET_UI} max=${MAX_ADJUST_OFFSET_UI} step="1" label="offset X" @value-selected=${(event: CustomEvent<{ value: number }>) => this._updateAdjust({ offset: { ...offset, x: event.detail.value } })}></iledclock-stepper></label>
        <label class="stepper-field">Offset Y <iledclock-stepper .value=${offset.y} min=${-MAX_ADJUST_OFFSET_UI} max=${MAX_ADJUST_OFFSET_UI} step="1" label="offset Y" @value-selected=${(event: CustomEvent<{ value: number }>) => this._updateAdjust({ offset: { ...offset, y: event.detail.value } })}></iledclock-stepper></label>
      </div>
      <div class="background-row"><label for="import-background">Background</label><input id="import-background" type="color" .value=${rgbToHex(this._adjust.background ?? [0, 0, 0])} @input=${(event: Event) => this._updateAdjust({ background: hexToRgb((event.currentTarget as HTMLInputElement).value) })}>${this._adjust.background ? html`<button type="button" class="text-button" @click=${this._clearBackground}>Clear</button>` : nothing}</div>
      <label class="enhance-row"><input type="checkbox" .checked=${enhance} @change=${(event: Event) => this._updateAdjust({ enhance: (event.currentTarget as HTMLInputElement).checked })}><span>Enhance colours for the LEDs</span></label>
    </div>`;
  }

  private _renderNumericCrop(dimensions: SourceDimensions) {
    const crop = this._sourceDataUrl
      ? this._cropBox ?? centeredCropBox(dimensions.width, dimensions.height)
      : this._adjust.crop ?? { x: 0, y: 0, w: dimensions.width, h: dimensions.height };
    const maxX = Math.max(0, dimensions.width - crop.w);
    const maxY = Math.max(0, dimensions.height - crop.h);
    const maxWidth = Math.max(1, dimensions.width - crop.x);
    const maxHeight = Math.max(1, dimensions.height - crop.y);
    const updateCrop = (patch: Partial<CropBox>) => {
      const current = this._sourceDataUrl ? this._cropBox ?? crop : this._adjust.crop ?? crop;
      const next = clampCropBox({
        x: patch.x ?? current.x,
        y: patch.y ?? current.y,
        w: patch.w ?? current.w,
        h: patch.h ?? current.h,
      }, dimensions.width, dimensions.height);
      if (this._sourceDataUrl) {
        this._cropBox = next;
        this._cropTouched = true;
      }
      this._updateAdjust({ crop: next });
    };
    return html`<fieldset class="crop-fields"><legend>Crop (source pixels)</legend>
      <label class="stepper-field">X <iledclock-stepper .value=${crop.x} min="0" .max=${maxX} step="1" label="crop X" @value-selected=${(event: CustomEvent<{ value: number }>) => updateCrop({ x: event.detail.value })}></iledclock-stepper></label>
      <label class="stepper-field">Y <iledclock-stepper .value=${crop.y} min="0" .max=${maxY} step="1" label="crop Y" @value-selected=${(event: CustomEvent<{ value: number }>) => updateCrop({ y: event.detail.value })}></iledclock-stepper></label>
      <label class="stepper-field">Width <iledclock-stepper .value=${crop.w} min="1" .max=${maxWidth} step="1" label="crop width" @value-selected=${(event: CustomEvent<{ value: number }>) => updateCrop({ w: event.detail.value })}></iledclock-stepper></label>
      <label class="stepper-field">Height <iledclock-stepper .value=${crop.h} min="1" .max=${maxHeight} step="1" label="crop height" @value-selected=${(event: CustomEvent<{ value: number }>) => updateCrop({ h: event.detail.value })}></iledclock-stepper></label>
      ${this._cropTouched || this._adjust.crop ? html`<button type="button" class="text-button reset-crop" @click=${this._resetCrop}>Reset crop</button>` : nothing}
    </fieldset>`
  }


  static styles = [TOKENS_CSS, SURFACES_CSS, css`
    :host { display: block; min-width: 0; }
    :host(:not([open])) { display: none; }
    .sheet-heading h2 { margin: 0; color: var(--lu-ink); font: 600 var(--lu-type-title)/1.25 var(--lu-font); }
    .sheet-heading p { margin: var(--lu-space-1) 0 0; color: var(--lu-ink-2); font: 400 var(--lu-type-caption)/1.4 var(--lu-font); }
    .pick-content, .preview-content { display: grid; gap: var(--lu-space-3); min-width: 0; padding-bottom: var(--lu-space-2); }
    .drop-zone { display: grid; justify-items: center; gap: var(--lu-space-3); padding: var(--lu-space-6) var(--lu-space-4); border: 1px dashed var(--lu-edge-raised); border-radius: var(--lu-radius-tile); text-align: center; }
    .drop-zone p { max-width: 48ch; margin: 0; color: var(--lu-ink-2); font: 400 var(--lu-type-body)/1.5 var(--lu-font); }
    .drop-icon { color: var(--lu-ink-3); font: 400 var(--lu-type-display)/1 var(--lu-font); }
    .drop-icon svg { display: block; width: var(--lu-space-8); height: var(--lu-space-8); }
    .file-picker { position: relative; display: inline-flex; align-items: center; justify-content: center; min-height: var(--lu-target); padding: 0 var(--lu-space-5); overflow: hidden; border: 1px solid var(--lu-edge-raised); border-radius: var(--lu-radius-pill); color: var(--lu-ink); background: var(--lu-glass-raised); font: 600 var(--lu-type-label)/1.2 var(--lu-font); cursor: pointer; }
    .file-picker input { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; }
    .file-picker:focus-within { outline: 2px solid var(--lu-accent); outline-offset: 2px; }
    .url-row { display: flex; flex-wrap: wrap; align-items: flex-end; gap: var(--lu-space-2); }
    .url-label { display: grid; flex: 1 1 12rem; gap: var(--lu-space-1); color: var(--lu-ink-2); font: 500 var(--lu-type-caption)/1.2 var(--lu-font); }
    .url-input { box-sizing: border-box; width: 100%; min-width: 0; min-height: var(--lu-target); padding: 0 var(--lu-space-3); border: 1px solid var(--lu-edge); border-radius: var(--lu-radius-control); color: var(--lu-ink); background: var(--lu-card); font: 400 var(--lu-type-body)/1.2 var(--lu-font); }
    .url-input:focus-visible { outline: 2px solid var(--lu-accent); outline-offset: 2px; }
    .error { margin: 0; color: var(--lu-danger); font: 500 var(--lu-type-label)/1.4 var(--lu-font); }
    .hint { margin: 0; color: var(--lu-ink-2); font: 400 var(--lu-type-caption)/1.45 var(--lu-font); }
    .crop-wrap { display: grid; gap: var(--lu-space-2); }
    .crop-stage { position: relative; display: grid; place-items: center; min-width: 0; max-height: 280px; overflow: hidden; border-radius: var(--lu-radius-tile); background: var(--lu-tile); }
    .source-image { display: block; width: 100%; height: auto; max-height: 280px; object-fit: contain; image-rendering: pixelated; }
    .crop-box { position: absolute; box-sizing: border-box; border: 2px solid var(--lu-accent); background: color-mix(in srgb, var(--lu-accent) 12%, transparent); touch-action: none; cursor: move; }
    .crop-handle { position: absolute; width: var(--lu-target); height: var(--lu-target); border: 0; border-radius: var(--lu-radius-pill); background: transparent; touch-action: none; }
    .crop-handle::before { content: ""; position: absolute; display: block; left: 50%; top: 50%; width: var(--lu-space-5); height: var(--lu-space-5); box-sizing: border-box; transform: translate(-50%,-50%); border: 2px solid var(--lu-accent-ink); border-radius: var(--lu-radius-pill); background: var(--lu-accent); }
    .handle-nw { left: 0; top: 0; transform: translate(-50%,-50%); cursor: nwse-resize; }
    .handle-ne { right: 0; top: 0; transform: translate(50%,-50%); cursor: nesw-resize; }
    .handle-sw { left: 0; bottom: 0; transform: translate(-50%,50%); cursor: nesw-resize; }
    .handle-se { right: 0; bottom: 0; transform: translate(50%,50%); cursor: nwse-resize; }
    .handle-n { left: 50%; top: 0; transform: translate(-50%,-50%); cursor: ns-resize; }
    .handle-e { right: 0; top: 50%; transform: translate(50%,-50%); cursor: ew-resize; }
    .handle-s { left: 50%; bottom: 0; transform: translate(-50%,50%); cursor: ns-resize; }
    .handle-w { left: 0; top: 50%; transform: translate(-50%,-50%); cursor: ew-resize; }
    .crop-tools { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: var(--lu-space-2); }
    .crop-tools p { margin: 0; color: var(--lu-ink-2); font: 400 var(--lu-type-caption)/1.4 var(--lu-font); }
    .adapted-preview { display: grid; place-items: center; min-width: 0; border-radius: var(--lu-radius-tile); overflow: hidden; }
    .adapted-preview iledclock-led-preview { width: 100%; }
    .disclosure, .text-button { display: inline-flex; align-items: center; justify-content: center; gap: var(--lu-space-2); min-height: var(--lu-target); padding: 0 var(--lu-space-3); border: 0; border-radius: var(--lu-radius-pill); color: var(--lu-ink-2); background: transparent; font: 500 var(--lu-type-label)/1.2 var(--lu-font); cursor: pointer; }
    .disclosure { justify-content: flex-start; border: 1px solid var(--lu-edge); }
    .disclosure:focus-visible, .text-button:focus-visible { outline: 2px solid var(--lu-accent); outline-offset: 2px; }
    .adjust-panel { display: grid; gap: var(--lu-space-3); padding: var(--lu-space-3); border: 1px solid var(--lu-edge); border-radius: var(--lu-radius-tile); }
    .stepper-field { display: grid; justify-items: center; gap: var(--lu-space-2); min-width: 0; color: var(--lu-ink-2); font: 500 var(--lu-type-caption)/1.2 var(--lu-font); }
    .offset-grid, .crop-fields { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: var(--lu-space-3); }
    .crop-fields { margin: 0; padding: var(--lu-space-3); border: 1px solid var(--lu-edge); border-radius: var(--lu-radius-control); }
    .crop-fields .reset-crop { grid-column: 1 / -1; justify-self: start; }
    .crop-fields legend { padding-inline: var(--lu-space-2); color: var(--lu-ink-2); font: 500 var(--lu-type-caption)/1.2 var(--lu-font); }
    .background-row { display: flex; align-items: center; gap: var(--lu-space-2); color: var(--lu-ink-2); font: 500 var(--lu-type-label)/1.2 var(--lu-font); }
    .background-row input { width: var(--lu-target); height: var(--lu-target); border: 1px solid var(--lu-edge); border-radius: var(--lu-radius-control); background: transparent; }
    .enhance-row { display: flex; align-items: center; gap: var(--lu-space-2); min-height: var(--lu-target); color: var(--lu-ink-2); font: 500 var(--lu-type-label)/1.3 var(--lu-font); }
    .enhance-row input { width: var(--lu-space-5); height: var(--lu-space-5); accent-color: var(--lu-accent); }
    .choose-again { justify-self: start; }
    .footer { display: grid; gap: var(--lu-space-3); min-width: 0; }
    .actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: var(--lu-space-2); }
    .actions > * { flex: 1 1 10rem; }
    @container (max-width: 420px) { .actions { justify-content: stretch; } .offset-grid, .crop-fields { grid-template-columns: 1fr; } }
    @media (prefers-reduced-motion: reduce) { .crop-box { transition: none; } }
  `];
}

customElements.define("iledclock-import-sheet", IledclockImportSheet);

declare global { interface HTMLElementTagNameMap { "iledclock-import-sheet": IledclockImportSheet; } }
