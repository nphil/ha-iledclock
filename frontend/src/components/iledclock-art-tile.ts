import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { createRef, ref } from "lit/directives/ref.js";
import type { PixelFrame } from "../lib/grid.ts";
import { ledSizeFor, type LedSize } from "../lib/led-size.ts";
import { frameIndexAtTime } from "../lib/frame-player.ts";
import { prefersReducedMotion, SURFACES_CSS, TOKENS_CSS } from "../styles/tokens.ts";
import { tileAnimationBudget, tileAutoRetryDelay, tileRetryUrl } from "../lib/tile-policy.ts";
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
    title: { type: String },
    subtitle: { type: String },
    _failed: { state: true },
    _retryUrl: { state: true },
    _visible: { state: true },
    _granted: { state: true },
    _imageSize: { state: true },
  };

  declare itemId: string;
  declare imageUrl: string;
  declare mediaPath: string;
  declare frames: PixelFrame[];
  declare delays: number[];
  declare animated: boolean;
  declare aspect: ArtTileAspect;
  declare title: string;
  declare subtitle: string;
  declare _failed: boolean;
  declare _retryUrl: string;
  declare _visible: boolean;
  declare _granted: boolean;
  declare _imageSize: LedSize | null;

  private readonly _surfaceRef = createRef<HTMLDivElement>();
  private _observer: IntersectionObserver | null = null;
  private _resizeObserver: ResizeObserver | null = null;
  private _motionQuery: MediaQueryList | null = null;
  private _tileKey = "";
  private _attempts = 0;
  private _autoRetryTimer: ReturnType<typeof setTimeout> | undefined;
  private _reducedMotion = false;

  constructor() {
    super();
    this.itemId = "";
    this.imageUrl = "";
    this.mediaPath = "";
    this.frames = [];
    this.delays = [];
    this.animated = false;
    this.aspect = "square";
    this.title = "";
    this.subtitle = "";
    this._failed = false;
    this._retryUrl = "";
    this._visible = false;
    this._granted = false;
    this._imageSize = null;
  }

  connectedCallback(): void {
    super.connectedCallback();
    this._tileKey = "art-tile-" + (++nextTileId);
    tileAnimationBudget.register(this._tileKey, this._onBudgetChanged);
    this._visible = typeof IntersectionObserver === "undefined";
    if (typeof IntersectionObserver !== "undefined") {
      this._observer = new IntersectionObserver((entries) => {
        this._visible = (entries[0]?.intersectionRatio ?? 0) >= 0.5;
        this._syncBudget();
      }, { threshold: [0, 0.5, 1] });
    }
    if (typeof ResizeObserver !== "undefined") this._resizeObserver = new ResizeObserver(() => this._measureImage());
    this._motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    this._reducedMotion = this._motionQuery.matches;
    this._motionQuery.addEventListener("change", this._onMotionChanged);
  }

  protected firstUpdated(): void {
    if (this._observer) this._observer.observe(this);
    if (this._surfaceRef.value) this._resizeObserver?.observe(this._surfaceRef.value);
    this._measureImage();
  }

  protected willUpdate(changed: PropertyValues): void {
    if (changed.has("imageUrl") || changed.has("mediaPath") || changed.has("itemId")) {
      clearTimeout(this._autoRetryTimer);
      const itemChanged = changed.has("itemId") && changed.get("itemId") !== this.itemId;
      const mediaPathChanged = changed.has("mediaPath") && changed.get("mediaPath") !== this.mediaPath;
      if (itemChanged || mediaPathChanged || (changed.has("imageUrl") && !this.mediaPath)) {
        this._attempts = 0;
      }
      this._failed = false;
      this._retryUrl = this.imageUrl;
      this._imageSize = null;
    }
    if (changed.has("animated") || changed.has("frames") || changed.has("imageUrl")) this._syncBudget();
  }

  protected updated(changed: PropertyValues): void {
    if (changed.has("imageUrl") || changed.has("aspect")) this._measureImage();
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    clearTimeout(this._autoRetryTimer);
    this._observer?.disconnect();
    this._resizeObserver?.disconnect();
    this._motionQuery?.removeEventListener("change", this._onMotionChanged);
    this._observer = null;
    this._resizeObserver = null;
    this._motionQuery = null;
    if (this._tileKey) tileAnimationBudget.unregister(this._tileKey);
  }

  private _isAnimated(): boolean {
    return this.animated || this.frames.length > 1;
  }

  private _syncBudget(): void {
    if (!this._tileKey) return;
    tileAnimationBudget.setVisible(this._tileKey, this._visible && this._isAnimated() && !this._reducedMotion);
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

  private _measureImage(): void {
    const box = this._surfaceRef.value?.getBoundingClientRect();
    if (!box || box.width <= 0 || box.height <= 0) return;
    const image = this.renderRoot.querySelector<HTMLImageElement>("img.art-image");
    const artWidth = image?.naturalWidth || 32;
    const artHeight = image?.naturalHeight || 16;
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

  render() {
    const useFrames = this.frames.length > 0;
    const showAnimatedImage = this._isAnimated() && !useFrames && this._granted && !this._reducedMotion;
    const imageUrl = this._retryUrl || this.imageUrl;
    const sizeStyle = this._imageSize ? "width:" + this._imageSize.width + "px;height:" + this._imageSize.height + "px" : "";
    const imageVisible = !this._failed && (!this._isAnimated() || useFrames || showAnimatedImage);
    return html`<article class="tile">
      <div class="plate ${this.aspect === "design" ? "design" : "square"}" ${ref(this._surfaceRef)} @click=${this._select}>
        ${useFrames
          ? html`<iledclock-led-preview context="tile" max-pitch="4" .frames=${this.frames} .delays=${this.delays} .playing=${this._granted && !this._reducedMotion} label=${this.title || "Pixel art"}></iledclock-led-preview>`
          : imageVisible && imageUrl
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
    :host { display: block; min-width: 0; container-type: inline-size; }
    .tile { display: flex; min-width: 0; flex-direction: column; gap: var(--lu-space-2); }
    .plate { position: relative; display: grid; place-items: center; width: 100%; overflow: hidden; border: 1px solid var(--lu-edge); border-radius: var(--lu-radius-tile); background: #050607; }
    .plate.square { aspect-ratio: 1 / 1; }
    .plate.design { aspect-ratio: 2 / 1; }
    .art-image { display: block; max-width: none; max-height: none; image-rendering: pixelated; object-fit: contain; }
    .placeholder { display: grid; place-items: center; width: 100%; height: 100%; color: var(--lu-ink-3); }
    .glyph { font: 400 var(--lu-type-display)/1 var(--lu-font); }
    .badges { position: absolute; inset: var(--lu-space-2) var(--lu-space-2) auto; display: flex; flex-wrap: wrap; gap: var(--lu-space-1); align-items: flex-start; pointer-events: none; }
    ::slotted([slot="badges"]) { pointer-events: auto; }
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
