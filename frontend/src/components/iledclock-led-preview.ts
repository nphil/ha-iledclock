import { LitElement, css, html, type PropertyValues } from "lit";
import { createRef, ref } from "lit/directives/ref.js";
import type { LedPreviewContext, LedSize } from "../lib/led-size.ts";
import { ledSizeFor } from "../lib/led-size.ts";
import { frameIndexAtTime } from "../lib/frame-player.ts";
import { createFrame, GRID_HEIGHT, GRID_WIDTH, type PixelFrame } from "../lib/grid.ts";
import { TOKENS_CSS } from "../styles/tokens.ts";
import "./iledclock-matrix-canvas.ts";

const EMPTY_FRAME = createFrame(GRID_WIDTH, GRID_HEIGHT);

export class IledclockLedPreview extends LitElement {
  static properties = {
    frames: { attribute: false },
    delays: { attribute: false },
    context: { type: String },
    maxPitch: { type: Number, attribute: "max-pitch" },
    zoom: { type: Number },
    playing: { type: Boolean },
    label: { type: String },
    _size: { state: true },
    _frameIndex: { state: true },
  };

  declare frames: PixelFrame[];
  declare delays: number[];
  declare context: LedPreviewContext;
  declare maxPitch: number | undefined;
  declare zoom: number;
  declare playing: boolean;
  declare label: string;
  declare _size: LedSize | null;
  declare _frameIndex: number;

  private readonly _stageRef = createRef<HTMLDivElement>();
  private _resizeObserver: ResizeObserver | null = null;
  private _intersectionObserver: IntersectionObserver | null = null;
  private _motionQuery: MediaQueryList | null = null;
  private _playFrames: PixelFrame[] = [];
  private _visible = true;
  private _reducedMotion = false;
  private _startedAt = 0;
  private _rafId: number | null = null;

  constructor() {
    super();
    this.frames = [];
    this.delays = [];
    this.context = "hero";
    this.maxPitch = undefined;
    this.zoom = 1;
    this.playing = true;
    this.label = "LED preview";
    this._size = null;
    this._frameIndex = 0;
  }

  connectedCallback(): void {
    super.connectedCallback();
    if (typeof ResizeObserver !== "undefined") this._resizeObserver = new ResizeObserver(() => this._measure());
    if (typeof IntersectionObserver !== "undefined") {
      this._intersectionObserver = new IntersectionObserver((entries) => {
        this._visible = entries[0]?.isIntersecting ?? false;
        this._syncPlayback();
      });
    }
    this._motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    this._reducedMotion = this._motionQuery.matches;
    this._motionQuery.addEventListener("change", this._onMotionChanged);
  }

  protected firstUpdated(): void {
    const stage = this._stageRef.value;
    if (stage) this._resizeObserver?.observe(stage);
    if (this._intersectionObserver) this._intersectionObserver.observe(this);
    this._measure();
    this._syncPlayback();
  }

  protected willUpdate(changed: PropertyValues): void {
    if (changed.has("frames") || changed.has("delays")) {
      this._playFrames = this.frames.map((frame, index) => ({ ...frame, durationMs: Math.max(1, this.delays[index] ?? frame.durationMs) }));
      this._frameIndex = 0;
      this._startedAt = performance.now();
    }
  }

  protected updated(changed: PropertyValues): void {
    if (changed.has("context") || changed.has("maxPitch") || changed.has("zoom")) this._measure();
    if (changed.has("frames") || changed.has("delays") || changed.has("playing")) this._syncPlayback();
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this._resizeObserver?.disconnect();
    this._intersectionObserver?.disconnect();
    this._motionQuery?.removeEventListener("change", this._onMotionChanged);
    this._resizeObserver = null;
    this._intersectionObserver = null;
    this._motionQuery = null;
    this._stopPlayback();
  }

  private _measure(): void {
    const box = this._stageRef.value?.getBoundingClientRect();
    if (!box || box.width <= 0 || box.height <= 0) return;
    const size = ledSizeFor(this.context, box.width, box.height, { maxPitch: this.maxPitch, zoom: this.zoom });
    if (this._size?.pitch === size.pitch) return;
    this._size = size;
  }

  private _canAnimate(): boolean {
    return this.playing && this._visible && !this._reducedMotion && this._playFrames.length > 1;
  }

  private _startPlayback(): void {
    if (this._rafId !== null) return;
    this._startedAt = performance.now();
    const tick = (now: number) => {
      if (!this._canAnimate()) {
        this._rafId = null;
        return;
      }
      const index = frameIndexAtTime(this._playFrames, now - this._startedAt);
      if (index !== this._frameIndex) {
        this._frameIndex = index;
        this.requestUpdate();
      }
      this._rafId = requestAnimationFrame(tick);
    };
    this._rafId = requestAnimationFrame(tick);
  }

  private _stopPlayback(): void {
    if (this._rafId === null) return;
    cancelAnimationFrame(this._rafId);
    this._rafId = null;
  }

  private _syncPlayback(): void {
    if (this._canAnimate()) this._startPlayback();
    else {
      this._stopPlayback();
      if (this._frameIndex !== 0) this._frameIndex = 0;
    }
  }

  private _onMotionChanged = (event: MediaQueryListEvent): void => {
    this._reducedMotion = event.matches;
    this._syncPlayback();
  };

  render() {
    const frames = this._playFrames.length ? this._playFrames : this.frames;
    const frame = frames[this._frameIndex] ?? frames[0] ?? EMPTY_FRAME;
    const width = this._size?.width;
    const height = this._size?.height;
    return html`<div class="stage" ${ref(this._stageRef)} role="img" aria-label=${this.label}>
      <iledclock-matrix-canvas .frame=${frame} .bloom=${(this._size?.pitch ?? 0) >= 10} style=${width && height ? "width: " + width + "px; height: " + height + "px" : "width: 100%; height: 100%"}></iledclock-matrix-canvas>
    </div>`;
  }

  static styles = [TOKENS_CSS, css`
    :host { display: block; width: 100%; min-width: 0; aspect-ratio: 2 / 1; overflow: hidden; border-radius: var(--lu-radius-tile); }
    .stage { display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; min-height: var(--lu-space-7); overflow: hidden; border-radius: inherit; background: #050607; }
    iledclock-matrix-canvas { display: block; flex: none; border-radius: inherit; }
  `];
}

customElements.define("iledclock-led-preview", IledclockLedPreview);

declare global { interface HTMLElementTagNameMap { "iledclock-led-preview": IledclockLedPreview; } }
