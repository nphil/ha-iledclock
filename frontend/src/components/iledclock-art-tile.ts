import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { createRef, ref } from "lit/directives/ref.js";
import type { PixelFrame } from "../lib/grid.ts";
import { ledSizeFor, type LedSize } from "../lib/led-size.ts";
import { SURFACES_CSS, TOKENS_CSS } from "../styles/tokens.ts";
import { posterFrameIndex, tileAnimationBudget, tileAutoRetryDelay, tileRetryUrl } from "../lib/tile-policy.ts";
import "./iledclock-led-preview.ts";
import "./lu-icon-button.ts";

export type ArtTileAspect = "square" | "design";
let nextTileId = 0;

export class IledclockArtTile extends LitElement {
  static properties = {
    itemId: { type: String, attribute: "item-id" },
    imageUrl: { type: String, attribute: "image-url" },
    mediaPath: { type: String, attribute: "media-path" },
    frames: { attribute: false },
    delays: { attribute: false },
    animated: { type: Boolean },
    aspect: { type: String },
    pixelWidth: { type: Number, attribute: "pixel-width" },
    pixelHeight: { type: Number, attribute: "pixel-height" },
    title: { type: String },
    subtitle: { type: String },
    _failed: { state: true },
    _retryUrl: { state: true },
    _granted: { state: true },
    _imageSize: { state: true },
    _active: { state: true },
    _posterReady: { state: true },
  };

  declare itemId: string;
  declare imageUrl: string;
  declare mediaPath: string;
  declare frames: PixelFrame[];
  declare delays: number[];
  declare animated: boolean;
  declare aspect: ArtTileAspect;
  declare pixelWidth: number;
  declare pixelHeight: number;
  declare title: string;
  declare subtitle: string;
  declare _failed: boolean;
  declare _retryUrl: string;
  declare _granted: boolean;
  declare _imageSize: LedSize | null;
  declare _active: boolean;
  declare _posterReady: boolean;

  private readonly _surfaceRef = createRef<HTMLDivElement>();
  private readonly _posterRef = createRef<HTMLCanvasElement>();
  private _resizeObserver: ResizeObserver | null = null;
  private _motionQuery: MediaQueryList | null = null;
  private _hoverQuery: MediaQueryList | null = null;
  private _tileKey = "";
  private _attempts = 0;
  private _autoRetryTimer: ReturnType<typeof setTimeout> | undefined;
  private _reducedMotion = false;
  private _hoverCapable = false;
  private _pointerActive = false;
  private _focusActive = false;
  constructor() {
    super();
    this.itemId = "";
    this.imageUrl = "";
    this.mediaPath = "";
    this.frames = [];
    this.delays = [];
    this.animated = false;
    this.aspect = "square";
    this.pixelWidth = 32;
    this.pixelHeight = 16;
    this.title = "";
    this.subtitle = "";
    this._failed = false;
    this._retryUrl = "";
    this._granted = false;
    this._imageSize = null;
    this._active = false;
    this._posterReady = false;
  }

  connectedCallback(): void {
    super.connectedCallback();
    this._tileKey = "art-tile-" + (++nextTileId);
    tileAnimationBudget.register(this._tileKey, this._onBudgetChanged);
    if (typeof ResizeObserver !== "undefined") this._resizeObserver = new ResizeObserver(() => this._measureImage());
    this._motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    this._reducedMotion = this._motionQuery.matches;
    this._motionQuery.addEventListener("change", this._onMotionChanged);
    this._hoverQuery = window.matchMedia("(hover: hover) and (pointer: fine)");
    this._hoverCapable = this._hoverQuery.matches;
    this._hoverQuery.addEventListener("change", this._onHoverChanged);
  }

  protected firstUpdated(): void {
    if (this._surfaceRef.value) this._resizeObserver?.observe(this._surfaceRef.value);
    this._measureImage();
  }

  protected willUpdate(changed: PropertyValues): void {
    if (changed.has("imageUrl") || changed.has("mediaPath") || changed.has("itemId")) {
      clearTimeout(this._autoRetryTimer);
      const itemChanged = changed.has("itemId") && changed.get("itemId") !== this.itemId;
      const mediaPathChanged = changed.has("mediaPath") && changed.get("mediaPath") !== this.mediaPath;
      if (itemChanged || mediaPathChanged || (changed.has("imageUrl") && !this.mediaPath)) this._attempts = 0;
      this._failed = false;
      this._retryUrl = this.imageUrl;
      this._imageSize = null;
      this._posterReady = false;
    }
    if (changed.has("animated") || changed.has("frames") || changed.has("imageUrl")) this._syncBudget();
  }

  protected updated(changed: PropertyValues): void {
    if (changed.has("imageUrl") || changed.has("aspect") || changed.has("pixelWidth") || changed.has("pixelHeight")) this._measureImage();
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    clearTimeout(this._autoRetryTimer);
    this._resizeObserver?.disconnect();
    this._motionQuery?.removeEventListener("change", this._onMotionChanged);
    this._hoverQuery?.removeEventListener("change", this._onHoverChanged);
    this._resizeObserver = null;
    this._motionQuery = null;
    this._hoverQuery = null;
    if (this._tileKey) tileAnimationBudget.unregister(this._tileKey);
  }

  private _isAnimated(): boolean {
    return this.animated || this.frames.length > 1;
  }

  private _syncBudget(): void {
    const active = this._hoverCapable && !this._reducedMotion && (this._pointerActive || this._focusActive);
    if (this._active !== active) this._active = active;
    if (this._tileKey) tileAnimationBudget.setActive(this._tileKey, active && this._isAnimated());
  }

  private _onBudgetChanged = (granted: boolean): void => {
    if (this._granted === granted) return;
    this._granted = granted;
    this.requestUpdate();
  };

  private _onMotionChanged = (event: MediaQueryListEvent): void => {
    this._reducedMotion = event.matches;
    this._syncBudget();
  };

  private _onHoverChanged = (event: MediaQueryListEvent): void => {
    this._hoverCapable = event.matches;
    this._syncBudget();
  };
  private _onPointerEnter = (): void => {
    if (!this._hoverCapable) return;
    this._pointerActive = true;
    this._syncBudget();
  };

  private _onPointerLeave = (): void => {
    this._pointerActive = false;
    this._syncBudget();
  };

  private _onFocusIn = (): void => {
    this._focusActive = true;
    this._syncBudget();
  };

  private _onFocusOut = (event: FocusEvent): void => {
    const target = event.relatedTarget;
    if (target instanceof Node && this.renderRoot.contains(target)) return;
    this._focusActive = false;
    this._syncBudget();
  };

   private _measureImage(): void {
    const box = this._surfaceRef.value?.getBoundingClientRect();
    if (!box || box.width <= 0 || box.height <= 0) return;
    const image = this.renderRoot.querySelector<HTMLImageElement>("img.art-image");
    const artWidth = this.pixelWidth > 0 ? this.pixelWidth : image?.naturalWidth || 32;
    const artHeight = this.pixelHeight > 0 ? this.pixelHeight : image?.naturalHeight || 16;
    const size = ledSizeFor("tile", box.width, box.height, { artWidth, artHeight });
    if (this._imageSize?.pitch === size.pitch && this._imageSize.width === size.width && this._imageSize.height === size.height) return;
    this._imageSize = size;
  }

  private _onImageError = (): void => {
    this._failed = true;
    const delay = tileAutoRetryDelay(this._attempts);
    if (delay === null) return;
    this._autoRetryTimer = setTimeout(() => this._retry(), delay);
  };

  private _onImageLoad = (): void => {
    this._failed = false;
    this._attempts = 0;
    clearTimeout(this._autoRetryTimer);
    this._measureImage();
  };

  private _onPosterLoad = (event: Event): void => {
    const image = event.currentTarget as HTMLImageElement;
    const canvas = this._posterRef.value;
    const context = canvas?.getContext("2d");
    if (!canvas || !context || image.naturalWidth === 0 || image.naturalHeight === 0) return;
    if (canvas.width !== image.naturalWidth) canvas.width = image.naturalWidth;
    if (canvas.height !== image.naturalHeight) canvas.height = image.naturalHeight;
    context.drawImage(image, 0, 0);
    this._posterReady = true;
    this._onImageLoad();
  };

  private _retry = (event?: Event): void => {
    event?.stopPropagation();
    if (!this.imageUrl) return;
    clearTimeout(this._autoRetryTimer);
    this._attempts += 1;
    this._failed = false;
    if (this.mediaPath) {
      this.dispatchEvent(new CustomEvent("media-retry-request", {
        detail: { itemId: this.itemId, mediaPath: this.mediaPath },
        bubbles: true,
        composed: true,
      }));
      return;
    }
    this._retryUrl = tileRetryUrl(this.imageUrl, this._attempts, Date.now());
  };

  private _select = (): void => {
    this.dispatchEvent(new CustomEvent("tile-selected", { detail: { itemId: this.itemId }, bubbles: true, composed: true }));
  };

  private _onKeydown = (event: KeyboardEvent): void => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    this._select();
  };

  private _posterSource: readonly PixelFrame[] | null = null;
  private _posterCache: PixelFrame[] = [];

  /** One stable still frame (memoised per frames array so the canvas does not repaint on re-render). */
  private _posterFrames(): PixelFrame[] {
    if (this._posterSource !== this.frames) {
      this._posterSource = this.frames;
      this._posterCache = this.frames.length ? [this.frames[posterFrameIndex(this.frames)]!] : [];
    }
    return this._posterCache;
  }

  render() {
    const useFrames = this.frames.length > 0;
    const animatedImage = this.animated && !useFrames;
    const imageUrl = this._retryUrl || this.imageUrl;
    const sizeStyle = this._imageSize ? "width:" + this._imageSize.width + "px;height:" + this._imageSize.height + "px" : "";
    const imageVisible = !this._failed && Boolean(imageUrl);
    const playing = this._active && this._granted && !this._reducedMotion;
    return html`<article class="tile" @pointerenter=${this._onPointerEnter} @pointerleave=${this._onPointerLeave} @focusin=${this._onFocusIn} @focusout=${this._onFocusOut}>
      <div class="plate ${this.aspect === "design" ? "design" : "square"}" ${ref(this._surfaceRef)} @click=${this._select}>
        ${useFrames
          ? html`<iledclock-led-preview context="tile" max-pitch="4" .frames=${playing ? this.frames : this._posterFrames()} .delays=${this.delays} .playing=${playing} label=${this.title || "Pixel art"}></iledclock-led-preview>`
          : animatedImage
            ? imageVisible
              ? html`<canvas class="poster" ${ref(this._posterRef)} width=${Math.max(1, this.pixelWidth)} height=${Math.max(1, this.pixelHeight)} style=${sizeStyle} ?hidden=${!this._posterReady || playing} aria-hidden="true"></canvas>
                  ${this._posterReady ? nothing : html`<img class="art-image poster-source" src=${imageUrl} alt="" style=${sizeStyle} @load=${this._onPosterLoad} @error=${this._onImageError}>`}
                  ${this._posterReady && playing ? html`<img class="art-image live-image" src=${imageUrl} alt="" style=${sizeStyle} @load=${this._onImageLoad} @error=${this._onImageError}>` : nothing}`
              : html`<div class="placeholder" aria-hidden="true"><span class="glyph">${this._failed ? "▧" : "▦"}</span></div>`
            : imageVisible
              ? html`<img class="art-image" src=${imageUrl} alt="" style=${sizeStyle} @load=${this._onImageLoad} @error=${this._onImageError}>`
              : html`<div class="placeholder" aria-hidden="true"><span class="glyph">${this._failed ? "▧" : "▦"}</span></div>`}
        <div class="badges"><slot name="badges"></slot></div>
        ${this._failed && this.imageUrl ? html`<lu-icon-button class="retry" icon="mdi:refresh" tooltip="Retry image" aria-label="Retry loading image" @lu-press=${this._retry}></lu-icon-button>` : nothing}
      </div>
      <button type="button" class="text" aria-label=${this.title ? "Open " + this.title : "Open artwork"} @click=${this._select} @keydown=${this._onKeydown}>
        <span class="title">${this.title}</span>
        ${this.subtitle ? html`<span class="subtitle">${this.subtitle}</span>` : nothing}
      </button>
    </article>`;
  }

  static styles = [TOKENS_CSS, SURFACES_CSS, css`
    :host { display: block; min-width: 0; }
    .tile { display: flex; min-width: 0; flex-direction: column; gap: var(--lu-space-2); }
    .plate { position: relative; display: grid; place-items: center; width: 100%; overflow: hidden; border: 1px solid var(--lu-edge); border-radius: var(--lu-radius-tile); background: #050607; }
    .plate.square { aspect-ratio: 1 / 1; }
    .plate.design { aspect-ratio: 2 / 1; }
    .art-image { display: block; max-width: none; max-height: none; image-rendering: pixelated; object-fit: contain; }
    .poster { display: block; max-width: none; max-height: none; image-rendering: pixelated; }
    .poster[hidden] { display: none; }
    .placeholder { display: grid; place-items: center; width: 100%; height: 100%; color: var(--lu-ink-3); }
    .glyph { font: 400 var(--lu-type-display)/1 var(--lu-font); }
    .badges { position: absolute; top: var(--lu-space-2); left: var(--lu-space-2); display: flex; max-width: calc(100% - 2 * var(--lu-space-2)); flex-wrap: wrap; gap: var(--lu-space-1); align-items: flex-start; pointer-events: none; }
    ::slotted([slot="badges"]) { pointer-events: auto; }
    ::slotted(.tile-badge) { display: inline-flex; min-height: 20px; align-items: center; padding: 0 var(--lu-space-2); border: 1px solid var(--lu-edge); border-radius: var(--lu-radius-pill); background: var(--lu-glass-raised, var(--lu-tile)); color: var(--lu-ink-2); font: 500 var(--lu-type-caption)/1 var(--lu-font); white-space: nowrap; }
    ::slotted(.tile-badge.exact) { color: var(--lu-positive); }
    ::slotted(.tile-badge.play) { width: 20px; height: 20px; min-height: 20px; justify-content: center; padding: 0; }
    .retry { position: absolute; right: var(--lu-space-2); bottom: var(--lu-space-2); }
    .text { display: flex; flex-direction: column; min-width: 0; min-height: 48px; gap: var(--lu-space-1); padding: 0; border: 0; color: inherit; background: transparent; text-align: left; cursor: pointer; }
    .text:focus-visible { outline: 2px solid var(--lu-accent); outline-offset: 2px; border-radius: var(--lu-radius-control); }
    .title { overflow: hidden; color: var(--lu-ink); font: 500 var(--lu-type-label)/1.3 var(--lu-font); text-overflow: ellipsis; white-space: nowrap; }
    .subtitle { overflow: hidden; color: var(--lu-ink-3); font: 400 var(--lu-type-caption)/1.3 var(--lu-font); text-overflow: ellipsis; white-space: nowrap; }
    iledclock-led-preview { width: 100%; }
  `];
}

customElements.define("iledclock-art-tile", IledclockArtTile);

declare global { interface HTMLElementTagNameMap { "iledclock-art-tile": IledclockArtTile; } }
