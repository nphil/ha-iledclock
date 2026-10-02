import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import type { ContentClass, HomeAssistant } from "../types.ts";
import { GRID_HEIGHT, GRID_WIDTH, type PixelFrame } from "../lib/grid.ts";
import { base64ToFrame, frameToBase64 } from "../lib/design-codec.ts";
import type { PlaybackPreviewResult } from "../types.ts";
import { PlaybackSession } from "../lib/playback-session.ts";
import { designsSetPlaybackRequest, playbackPreviewRequest } from "../lib/ws-api.ts";
import { hexToRgb, rgbToHex } from "../lib/color.ts";
import {
  describeAutoFit,
  galleryImportRequest,
  galleryPreviewRequest,
  normalizeAdjustOptions,
  type GalleryAdjustOptions,
  type GalleryImportResult,
  type GalleryLayout,
  type GalleryPreviewResult,
} from "../lib/gallery-api.ts";
import { GalleryImportCache } from "../lib/gallery-import-cache.ts";
import { itemKey } from "../lib/gallery-browse-state.ts";
import { exploreLayoutLabel, exploreLayoutOptions, type ExploreGalleryItem, type ExploreSource } from "../lib/gallery-explore-api.ts";
import { describeWsError } from "../lib/ws-query.ts";
import { resolveShowTarget, showWithUndo } from "../lib/show-with-undo.ts";
import { SLOT_CHECK_FAILED } from "../lib/slots.ts";
import { TOKENS_CSS } from "../styles/tokens.ts";
import "./iledclock-led-preview.ts";
import "./iledclock-playback-control.ts";
import "./iledclock-segmented-picker.ts";
import "./iledclock-stepper.ts";
import "./lu-error.ts";
import "./lu-icon-button.ts";
import "./lu-pill-button.ts";
import "./iledclock-slot-choice.ts";
import "./lu-sheet.ts";

const ADJUST_DEBOUNCE_MS = 250;
const MAX_ADJUST_OFFSET_UI = 64;

export class IledclockExploreItemSheet extends LitElement {
  static properties = {
    hass: { attribute: false },
    entryId: { attribute: false },
    open: { type: Boolean },
    item: { attribute: false },
    source: { attribute: false },
    imageUrl: { type: String, attribute: "image-url" },
    items: { attribute: false },
    importCache: { attribute: false },
    _layout: { state: true },
    _adjustOpen: { state: true },
    _adjust: { state: true },
    _preview: { state: true },
    _previewLoading: { state: true },
    _previewError: { state: true },
    _saving: { state: true },
    _actionError: { state: true },
    _originalFailed: { state: true },
  };

  declare hass: HomeAssistant;
  declare entryId: string | undefined;
  declare open: boolean;
  declare item: ExploreGalleryItem | null;
  declare source: ExploreSource | undefined;
  declare imageUrl: string;
  declare items: readonly ExploreGalleryItem[];
  declare importCache: GalleryImportCache;
  declare _layout: GalleryLayout;
  declare _adjustOpen: boolean;
  declare _adjust: GalleryAdjustOptions;
  declare _preview: GalleryPreviewResult | null;
  declare _previewLoading: boolean;
  declare _previewError: string | null;
  declare _saving: "save" | "show" | "edit" | null;
  declare _actionError: string | null;
  declare _originalFailed: boolean;

  private _pixelFrames: PixelFrame[] = [];
  private _requestId = 0;
  private _debounceTimer: ReturnType<typeof setTimeout> | undefined;
  private _swipeStartX: number | null = null;
  private _playback = this._makePlayback();
  private _playbackDisposed = false;

  private _makePlayback(): PlaybackSession {
    return new PlaybackSession({
      callWS: (request) => this.hass.callWS!<PlaybackPreviewResult>(request as never),
      buildRequest: (state, authored) => playbackPreviewRequest({ frames: authored.map(frameToBase64), delays: authored.map((frame) => frame.durationMs) }, state),
      onChange: () => this.requestUpdate(),
    });
  }

  constructor() {
    super();
    this.open = false;
    this.item = null;
    this.imageUrl = "";
    this.items = [];
    this.importCache = new GalleryImportCache();
    this._layout = "auto";
    this._adjustOpen = false;
    this._adjust = {};
    this._preview = null;
    this._previewLoading = false;
    this._previewError = null;
    this._saving = null;
    this._actionError = null;
    this._originalFailed = false;
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    clearTimeout(this._debounceTimer);
    this._requestId++;
    this._playback.dispose();
    this._playbackDisposed = true;
  }

  connectedCallback(): void {
    super.connectedCallback();
    if (this._playbackDisposed) {
      this._playbackDisposed = false;
      this._playback = this._makePlayback();
      if (this._pixelFrames.length > 0) this._playback.setSource(this._pixelFrames);
    }
  }

  protected willUpdate(changed: PropertyValues): void {
    if (changed.has("_preview")) {
      this._pixelFrames = this._preview
        ? this._preview.frames.map((frame, index) => base64ToFrame(frame, GRID_WIDTH, GRID_HEIGHT, this._preview!.delays_ms[index] ?? 100))
        : [];
      // Keep the session (and so the control and the chosen speed) while a new preview is on its way.
      if (this._preview) this._playback.setSource(this._pixelFrames);
    }
  }

  protected updated(changed: PropertyValues): void {
    if (changed.has("imageUrl") || changed.has("item")) this._originalFailed = false;
    if (changed.has("open") || changed.has("item")) {
      clearTimeout(this._debounceTimer);
      this._requestId++;
      if (this.open && this.item) {
        this._layout = "auto";
        this._adjustOpen = false;
        this._adjust = {};
        this._preview = null;
        this._previewError = null;
        this._actionError = null;
        this._pixelFrames = [];
        this._playback.setSource([], { state: { speed: null, smooth: null } });
        void this._loadPreview();
      }
    }
  }
  private _updateAdjust(patch: Partial<GalleryAdjustOptions>): void {
    this._adjust = { ...this._adjust, ...patch };
    this._requestId++;
    this._preview = null;
    this._previewLoading = true;
    this._previewError = null;
    clearTimeout(this._debounceTimer);
    this._debounceTimer = setTimeout(() => void this._loadPreview(), ADJUST_DEBOUNCE_MS);
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

  private _selectLayout(layout: string): void {
    this._layout = layout as GalleryLayout;
    void this._loadPreview();
  }


  private _clearBackground(): void {
    const { background: _background, ...rest } = this._adjust;
    this._adjust = rest;
    void this._loadPreview();
  }

  private _canUseAction(): boolean {
    return Boolean(this._preview) && !this._previewLoading && this._saving === null;
  }

  /** An "icon with clock" layout imports a design with a clock region; everything else is plain art. */
  private _contentClass(): ContentClass {
    return this._layout === "icon_with_clock" || this._preview?.layout === "icon_with_clock" ? "art_clock" : "art";
  }

  /** Imports `item` as a library design with `options`. Both are passed in, decided at the click: the import takes a while and the
   * layout controls stay live meanwhile, so nothing about the artwork is read from the sheet's state again afterwards. */
  private async _importDesign(item: ExploreGalleryItem, options: GalleryAdjustOptions): Promise<string> {
    const entryId = this.entryId;
    const callWS = this.hass.callWS?.bind(this.hass);
    if (!entryId || !callWS) throw new Error("The gallery item is no longer available.");
    const designId = await this.importCache.getOrImport(item.source, item.id, options, async () => {
      const result = await callWS<GalleryImportResult>(galleryImportRequest(entryId, item.source, item.id, options));
      return result.design_id;
    });
    // A cached design may still carry the choice from an earlier visit: always write the current one.
    if (this._playback.hasMotion) await callWS(designsSetPlaybackRequest(designId, { speed: this._playback.speed, smooth: this._playback.smooth }));
    return designId;
  }

  private async _saveToLibrary(): Promise<void> {
    if (!this.item || !this._canUseAction()) return;
    const item = this.item;
    this._saving = "save";
    this._actionError = null;
    try {
      const designId = await this._importDesign(item, this._buildOptions());
      this.dispatchEvent(new CustomEvent("iledclock-designs-changed", { bubbles: true, composed: true }));
      this.dispatchEvent(new CustomEvent("lu-toast", {
        detail: { message: `Saved ${item.title} to your library`, actionLabel: "Open", action: () => this._openDesign(designId), timeoutMs: 5000 },
        bubbles: true,
        composed: true,
      }));
      this._close();
    } catch (err) {
      this._actionError = describeWsError(err);
    } finally {
      this._saving = null;
    }
  }

  private async _showOnClock(): Promise<void> {
    if (!this.item || !this.entryId || !this._canUseAction()) return;
    const item = this.item;
    const entryId = this.entryId;
    // Fixed now, at the click, and used as is: what the A | B control showed is where this goes, and the imported artwork is the one
    // chosen now, whatever the layout buttons are turned to while the import runs.
    const options = this._buildOptions();
    const contentClass = this._contentClass();
    this._saving = "show";
    this._actionError = null;
    try {
      const target = await resolveShowTarget(this.hass, entryId, contentClass);
      if (!target) {
        this._actionError = SLOT_CHECK_FAILED;
        return;
      }
      const designId = await this._importDesign(item, options);
      const shown = await showWithUndo(this, this.hass, entryId, { design_id: designId }, item.title, { target });
      if (shown) {
        this.dispatchEvent(new CustomEvent("iledclock-designs-changed", { bubbles: true, composed: true }));
        this._close();
      }
    } catch (err) {
      this._actionError = describeWsError(err);
    } finally {
      this._saving = null;
    }
  }

  private async _editDesign(): Promise<void> {
    if (!this.item || !this._canUseAction()) return;
    const item = this.item;
    this._saving = "edit";
    this._actionError = null;
    try {
      const designId = await this._importDesign(item, this._buildOptions());
      this.dispatchEvent(new CustomEvent("iledclock-designs-changed", { bubbles: true, composed: true }));
      this._openDesign(designId);
    } catch (err) {
      this._actionError = describeWsError(err);
    } finally {
      this._saving = null;
    }
  }

  private _openDesign(designId: string): void {
    this.dispatchEvent(new CustomEvent("iledclock-open-design", { detail: { design_id: designId }, bubbles: true, composed: true }));
  }

  private _close(): void {
    this.dispatchEvent(new CustomEvent("close-requested", { bubbles: true, composed: true }));
  }

  private _retryOriginal(): void {
    if (!this.item) return;
    this.dispatchEvent(new CustomEvent("media-retry-request", {
      detail: { itemId: itemKey(this.item), mediaPath: this.item.media_path },
      bubbles: true,
      composed: true,
    }));
  }

  private _navigate(delta: -1 | 1): void {
    this.dispatchEvent(new CustomEvent("item-navigate", { detail: { delta }, bubbles: true, composed: true }));
  }

  private _onKeydown(event: KeyboardEvent): void {
    const target = event.composedPath()[0] ?? event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement || (target instanceof HTMLElement && target.isContentEditable)) return;
    if (event.key === "ArrowLeft" && this._hasPrevious()) {
      event.preventDefault();
      this._navigate(-1);
    } else if (event.key === "ArrowRight" && this._hasNext()) {
      event.preventDefault();
      this._navigate(1);
    }
  }

  private _hasPrevious(): boolean {
    return this.items.findIndex((item) => itemKey(item) === (this.item ? itemKey(this.item) : "")) > 0;
  }

  private _hasNext(): boolean {
    const index = this.items.findIndex((item) => itemKey(item) === (this.item ? itemKey(this.item) : ""));
    return index >= 0 && index < this.items.length - 1;
  }

  private _onSwipeStart(event: PointerEvent): void {
    this._swipeStartX = event.clientX;
  }

  private _onSwipeEnd(event: PointerEvent): void {
    if (this._swipeStartX === null) return;
    const delta = event.clientX - this._swipeStartX;
    this._swipeStartX = null;
    if (delta > 72 && this._hasPrevious()) this._navigate(-1);
    else if (delta < -72 && this._hasNext()) this._navigate(1);
  }

  render() {
    if (!this.open || !this.item) return nothing;
    const item = this.item;
    const layouts = exploreLayoutOptions(this._preview?.layouts_available ?? []);
    const layoutOptions = layouts.map((layout) => ({ value: layout, label: exploreLayoutLabel(layout) }));
    const canUseAction = this._canUseAction();
    const scale = this._adjust.scale ?? 1;
    const offset = this._adjust.offset ?? { x: 0, y: 0 };
    const enhance = this._adjust.enhance ?? false;
    const previewDelays = this._preview?.delays_ms ?? [];
    const playback = this._playback;
    const motion = playback.hasMotion && this._pixelFrames.length > 1;
    const creditUrl = item.url ?? this.source?.homepage;
    const metadata = item.author ? `By ${item.author} on ${this.source?.name ?? item.source}.` : `From ${this.source?.name ?? item.source}.`;
    return html`<lu-sheet ?open=${this.open} .label=${item.title} @closed=${this._close} @keydown=${(event: KeyboardEvent) => this._onKeydown(event)}>
      <div slot="header" class="sheet-heading">
        <div class="heading-text"><h2>${item.title}</h2><p>${this.source?.name ?? item.source}</p></div>
        <div class="item-nav">
          <lu-icon-button icon="mdi:chevron-left" tooltip="Previous design" aria-label="Previous design" ?disabled=${!this._hasPrevious()} @lu-press=${() => this._navigate(-1)}></lu-icon-button>
          <lu-icon-button icon="mdi:chevron-right" tooltip="Next design" aria-label="Next design" ?disabled=${!this._hasNext()} @lu-press=${() => this._navigate(1)}></lu-icon-button>
        </div>
      </div>
      <div class="content">
        ${this._actionError ? html`<p class="action-error" role="alert">${this._actionError}</p>` : nothing}
        <div class="preview-row" @pointerdown=${(event: PointerEvent) => this._onSwipeStart(event)} @pointerup=${(event: PointerEvent) => this._onSwipeEnd(event)} @pointercancel=${() => (this._swipeStartX = null)}>
          <div class="hero-preview" aria-label="Adapted clock preview">
            ${this._pixelFrames.length > 0
              ? html`<iledclock-led-preview context="hero" .frames=${motion ? playback.frames : this._pixelFrames} .delays=${motion ? playback.delays : previewDelays} .rate=${motion ? playback.rate : 1} .playing=${motion ? playback.playing : this._pixelFrames.length > 1} label=${`${item.title}, adapted for the clock`}></iledclock-led-preview>`
              : this._previewLoading
                ? html`<div class="preview-skeleton" role="status" aria-label="Preparing adapted preview"></div>`
                : html`<div class="preview-placeholder" aria-hidden="true">▦</div>`}
          </div>
          <figure class="original-preview">
            ${this.imageUrl && !this._originalFailed
              ? html`<img src=${this.imageUrl} alt=${`Original ${item.title}`} loading="lazy" decoding="async" @error=${() => (this._originalFailed = true)} />`
              : this._originalFailed
                ? html`<div class="original-placeholder"><span aria-hidden="true">▦</span><lu-icon-button icon="mdi:refresh" tooltip="Retry original image" aria-label="Retry original image" @lu-press=${this._retryOriginal}></lu-icon-button></div>`
                : html`<div class="original-placeholder" aria-hidden="true">▦</div>`}
            <figcaption>Original</figcaption>
          </figure>
        </div>
        ${this._previewError
          ? html`<lu-error title="The adapted preview couldn’t load" .message=${this._previewError} retry-label="Retry preview" @retry=${() => void this._loadPreview()}></lu-error>`
          : nothing}
        ${this._preview && this._layout === "auto" && describeAutoFit(this._preview.report.notes)
          ? html`<p class="fit-note">${describeAutoFit(this._preview.report.notes)}</p>`
          : nothing}
        ${this._pixelFrames.length > 1 ? html`<iledclock-playback-control .session=${playback}></iledclock-playback-control>` : nothing}
        <section class="settings" aria-label="Preview settings">
          <h3>Layout</h3>
          ${this._previewLoading && !this._preview
            ? html`<lu-skeleton variant="line" width="220px" label="Loading layout choices"></lu-skeleton>`
            : this._preview
              ? html`<iledclock-segmented-picker group-label="Layout" content-fit .options=${layoutOptions} .value=${this._layout} @option-selected=${(event: CustomEvent<{ value: string }>) => this._selectLayout(event.detail.value)}></iledclock-segmented-picker>`
              : nothing}
          <button class="disclosure" type="button" aria-expanded=${this._adjustOpen} @click=${() => (this._adjustOpen = !this._adjustOpen)}>
            <span>${this._adjustOpen ? "Hide" : "Adjust"}</span><span aria-hidden="true">${this._adjustOpen ? "−" : "+"}</span>
          </button>
          ${this._adjustOpen
            ? html`<div class="adjust">
                <label class="control">Scale<iledclock-stepper .value=${scale} min="1" max="16" step="1" @value-selected=${(event: CustomEvent<{ value: number }>) => this._updateAdjust({ scale: event.detail.value })}></iledclock-stepper></label>
                <div class="offset-row">
                  <label class="control">Offset X<iledclock-stepper .value=${offset.x} min=${-MAX_ADJUST_OFFSET_UI} max=${MAX_ADJUST_OFFSET_UI} step="1" @value-selected=${(event: CustomEvent<{ value: number }>) => this._updateAdjust({ offset: { ...offset, x: event.detail.value } })}></iledclock-stepper></label>
                  <label class="control">Offset Y<iledclock-stepper .value=${offset.y} min=${-MAX_ADJUST_OFFSET_UI} max=${MAX_ADJUST_OFFSET_UI} step="1" @value-selected=${(event: CustomEvent<{ value: number }>) => this._updateAdjust({ offset: { ...offset, y: event.detail.value } })}></iledclock-stepper></label>
                </div>
                <div class="background-row"><label for="background-color">Background</label><input id="background-color" type="color" .value=${rgbToHex(this._adjust.background ?? [0, 0, 0])} @input=${(event: Event) => this._updateAdjust({ background: hexToRgb((event.target as HTMLInputElement).value) })} />${this._adjust.background ? html`<button type="button" class="clear-background" @click=${this._clearBackground}>Clear</button>` : nothing}</div>
                <button class="enhance-row" type="button" aria-pressed=${enhance} @click=${() => this._updateAdjust({ enhance: !enhance })}><span>Enhance colours</span><span class="toggle ${enhance ? "on" : ""}" aria-hidden="true"><span></span></span></button>
              </div>`
            : nothing}
        </section>
        <p class="credit">${metadata} ${creditUrl ? html`<a href=${creditUrl} target="_blank" rel="noopener noreferrer">View original</a>` : nothing}</p>
      </div>
      <div slot="footer" class="footer">
        <iledclock-slot-choice .hass=${this.hass} .entryId=${this.entryId} content-class=${this._contentClass()} ?disabled=${this._saving !== null}></iledclock-slot-choice>
        <div class="actions">
          <lu-pill-button variant="primary" .label=${this._saving === "show" ? "Showing…" : "Show on clock"} ?disabled=${!canUseAction} @lu-press=${this._showOnClock}></lu-pill-button>
          <lu-pill-button variant="secondary" .label=${this._saving === "save" ? "Saving…" : "Save to library"} ?disabled=${!canUseAction} @lu-press=${this._saveToLibrary}></lu-pill-button>
          <lu-pill-button variant="quiet" .label=${this._saving === "edit" ? "Opening…" : "Edit"} ?disabled=${!canUseAction} @lu-press=${this._editDesign}></lu-pill-button>
        </div>
      </div>
    </lu-sheet>`;
  }

  static styles = [TOKENS_CSS, css`
    :host { display: block; }
    .sheet-heading { display: flex; align-items: center; gap: var(--lu-space-2); min-width: 0; flex: 1; }
    .heading-text { min-width: 0; flex: 1; }
    h2 { overflow: hidden; margin: 0; color: var(--lu-ink); font: 600 var(--lu-type-title)/1.2 var(--lu-font); letter-spacing: -.01em; text-overflow: ellipsis; white-space: nowrap; }
    .heading-text p { margin: var(--lu-space-1) 0 0; color: var(--lu-ink-3); font: 400 var(--lu-type-caption)/1.3 var(--lu-font); }
    .item-nav { display: flex; gap: var(--lu-space-1); flex: none; }
    .content { display: flex; min-width: 0; flex-direction: column; gap: var(--lu-space-3); color: var(--lu-ink); }
    .action-error { margin: 0; color: var(--lu-danger); font: 500 var(--lu-type-body)/1.4 var(--lu-font); }
    .preview-row { display: grid; grid-template-columns: minmax(0, 1fr) clamp(64px, 23cqi, 112px); gap: var(--lu-space-2); align-items: center; touch-action: pan-y; }
    .hero-preview { display: grid; place-items: center; min-width: 0; overflow: hidden; aspect-ratio: 2 / 1; border: 1px solid var(--lu-edge); border-radius: var(--lu-radius-tile); background: #050607; }
    iledclock-led-preview { width: 100%; max-width: 384px; }
    .preview-skeleton, .preview-placeholder { display: grid; place-items: center; width: 100%; height: 100%; color: var(--lu-ink-3); background: var(--lu-tile); }
    .preview-placeholder { font: 300 var(--lu-type-display)/1 var(--lu-font); }
    .original-preview { display: flex; flex-direction: column; gap: var(--lu-space-1); min-width: 0; margin: 0; align-items: center; }
    .original-preview img, .original-placeholder { display: grid; place-items: center; width: 100%; aspect-ratio: 1; border: 1px solid var(--lu-edge); border-radius: var(--lu-radius-control); background: #050607; object-fit: contain; image-rendering: pixelated; }
    .original-placeholder { position: relative; color: var(--lu-ink-3); font-size: 24px; }
    .original-placeholder lu-icon-button { position: absolute; right: 0; bottom: 0; }
    figcaption { color: var(--lu-ink-3); font: 400 var(--lu-type-caption)/1.3 var(--lu-font); }
    .fit-note { margin: 0; color: var(--lu-ink-2); font: 400 var(--lu-type-caption)/1.4 var(--lu-font); }
    .settings { display: flex; flex-direction: column; gap: var(--lu-space-2); }
    h3 { margin: 0; color: var(--lu-ink); font: 600 var(--lu-type-label)/1.25 var(--lu-font); }
    .disclosure { display: flex; justify-content: space-between; align-items: center; min-height: var(--lu-target, 48px); padding: 0 var(--lu-space-3); border: 1px solid var(--lu-edge); border-radius: var(--lu-radius-control); background: var(--lu-tile); color: var(--lu-ink-2); text-align: left; font: 500 var(--lu-type-label)/1 var(--lu-font); cursor: pointer; }
    .adjust { display: flex; flex-direction: column; gap: var(--lu-space-3); padding: var(--lu-space-3); border: 1px solid var(--lu-edge); border-radius: var(--lu-radius-tile); background: var(--lu-tile); }
    .control { display: flex; flex-direction: column; align-items: center; gap: var(--lu-space-1); color: var(--lu-ink-2); font: 500 var(--lu-type-caption)/1.3 var(--lu-font); }
    .offset-row { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--lu-space-2); }
    .background-row { display: flex; align-items: center; gap: var(--lu-space-2); min-height: var(--lu-target, 48px); color: var(--lu-ink-2); font: 500 var(--lu-type-label)/1.3 var(--lu-font); }
    .background-row input { width: var(--lu-target, 48px); height: var(--lu-target, 48px); padding: 0; border: 0; border-radius: 50%; background: transparent; }
    .clear-background { min-height: var(--lu-target, 48px); padding: 0 var(--lu-space-2); border: 0; background: transparent; color: var(--lu-accent); font: 500 var(--lu-type-label)/1 var(--lu-font); }
    .enhance-row { display: flex; align-items: center; justify-content: space-between; min-height: var(--lu-target, 48px); padding: 0; border: 0; background: transparent; color: var(--lu-ink); text-align: left; font: 500 var(--lu-type-label)/1.3 var(--lu-font); cursor: pointer; }
    .toggle { display: grid; align-items: center; justify-content: start; width: 42px; height: 26px; padding: 2px; border-radius: var(--lu-radius-pill); background: var(--lu-track-off); }
    .toggle.on { justify-content: end; background: var(--lu-accent); }
    .toggle span { width: 22px; height: 22px; border-radius: 50%; background: var(--lu-card); }
    .credit { display: flex; flex-wrap: wrap; gap: var(--lu-space-1); margin: 0; color: var(--lu-ink-2); font: 400 var(--lu-type-caption)/1.4 var(--lu-font); }
    .credit a { color: var(--lu-accent); font-weight: 600; text-decoration: none; }
    .credit a:hover { text-decoration: underline; }
    .footer { display: grid; gap: var(--lu-space-3); min-width: 0; }
    .actions { display: flex; flex-wrap: wrap; gap: var(--lu-space-2); }
    @media (prefers-reduced-motion: reduce) { * { scroll-behavior: auto !important; transition-duration: var(--lu-motion-layer) !important; } }
  `];
}

customElements.define("iledclock-explore-item-sheet", IledclockExploreItemSheet);

declare global { interface HTMLElementTagNameMap { "iledclock-explore-item-sheet": IledclockExploreItemSheet; } }
