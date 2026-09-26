/** The shared LED-matrix renderer: draws one `PixelFrame` as round, gently bloomed LEDs on a
 * `<canvas>`, off pixels faintly visible so the grid structure reads even on a blank design.
 * Every place this project shows the clock's pixels -- the card's hero, a library thumbnail, a
 * frame-timeline strip cell, the studio's own live canvas -- goes through this one component so
 * they all agree pixel-for-pixel (see `matrix-layout.ts` for the shared geometry). Animation
 * playback is NOT this component's job: a caller wanting motion (the hero, the studio's loop
 * preview) drives its own timer with `frame-player.ts` and re-assigns `frame` on each tick, so
 * this stays a plain, cheap, single-responsibility renderer.
 *
 * This component does NOT quantise pixel data -- it trusts `frame.pixels` to already be the
 * achievable/displayed colour (every producer -- the pixel editor's flood-fill/rasterize tools,
 * and the server's own render results -- already runs the correct content-path curve exactly
 * once via `color.ts`'s `quantizePreviewRgb`/`quantizePreviewRgbLinear` before the pixel reaches
 * a `PixelFrame`). Re-quantising here would be both redundant AND actively wrong: quantise-then-
 * expand is NOT idempotent under a second pass (see `color.ts`'s module doc), so a component
 * that blindly re-ran every pixel through one fixed curve regardless of its actual content path
 * would silently shift already-correct colours by 1-2 levels (or worse, run clock/timer content
 * through the wrong curve entirely). This only clamps to valid bytes, matching `clampRgb`.
 *
 * `interactive` additionally turns pointer input into `matrix-pointer` events (`{x, y, phase,
 * buttons, pointerId}` in grid cells, `phase` one of `down`/`move`/`up`/`leave`) so the studio's
 * pixel editor can drive its tools without this component knowing anything about pens or fills.
 */

import { LitElement, css, html, type PropertyValues } from "lit";
import { createRef, ref } from "lit/directives/ref.js";
import { GRID_HEIGHT, GRID_WIDTH, type PixelFrame } from "../lib/grid.ts";
import { cellCenter, computeMatrixLayout, pointToCell, type MatrixLayout } from "../lib/matrix-layout.ts";

export interface MatrixPointerDetail {
  x: number;
  y: number;
  phase: "down" | "move" | "up" | "leave";
  buttons: number;
  pointerId: number;
}

const OFF_DOT_ALPHA = 0.05;

export class IledclockMatrixCanvas extends LitElement {
  static properties = {
    frame: { attribute: false },
    interactive: { type: Boolean },
    showGrid: { type: Boolean, attribute: "show-grid" },
    bloom: { type: Boolean },
  };

  declare frame: PixelFrame | null;
  declare interactive: boolean;
  declare showGrid: boolean;
  declare bloom: boolean;

  private readonly _canvasRef = createRef<HTMLCanvasElement>();
  private _resizeObserver: ResizeObserver | null = null;
  private _layout: MatrixLayout | null = null;
  private _dpr = 1;

  constructor() {
    super();
    this.frame = null;
    this.interactive = false;
    this.showGrid = false;
    this.bloom = true;
  }

  connectedCallback(): void {
    super.connectedCallback();
    this._resizeObserver = new ResizeObserver(() => this._resize());
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this._resizeObserver?.disconnect();
    this._resizeObserver = null;
  }

  protected firstUpdated(): void {
    if (this._canvasRef.value) this._resizeObserver?.observe(this._canvasRef.value);
    this._resize();
  }

  protected updated(changed: PropertyValues): void {
    if (changed.has("frame") || changed.has("showGrid") || changed.has("bloom")) this._draw();
  }

  private _resize(): void {
    const canvas = this._canvasRef.value;
    if (!canvas) return;
    const box = canvas.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) return;
    this._dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(box.width * this._dpr));
    canvas.height = Math.max(1, Math.round(box.height * this._dpr));
    const width = this.frame?.width ?? GRID_WIDTH;
    const height = this.frame?.height ?? GRID_HEIGHT;
    this._layout = computeMatrixLayout(canvas.width, canvas.height, width, height);
    this._draw();
  }

  private _draw(): void {
    const canvas = this._canvasRef.value;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || !this._layout) return;
    const layout = this._layout;
    const width = this.frame?.width ?? GRID_WIDTH;
    const height = this.frame?.height ?? GRID_HEIGHT;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#050607";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
        const [r, g, b] = this.frame
          ? [clamp(this.frame.pixels[(y * width + x) * 3]!), clamp(this.frame.pixels[(y * width + x) * 3 + 1]!), clamp(this.frame.pixels[(y * width + x) * 3 + 2]!)]
          : [0, 0, 0];
        const [cx, cy] = cellCenter(layout, x, y);
        const lit = r > 0 || g > 0 || b > 0;

        if (!lit) {
          ctx.beginPath();
          ctx.fillStyle = `rgba(255, 255, 255, ${OFF_DOT_ALPHA})`;
          ctx.arc(cx, cy, layout.dotRadius * 0.72, 0, Math.PI * 2);
          ctx.fill();
          continue;
        }

        if (this.bloom) {
          ctx.save();
          ctx.shadowColor = `rgb(${r}, ${g}, ${b})`;
          ctx.shadowBlur = layout.dotRadius * 1.6;
          ctx.beginPath();
          ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
          ctx.arc(cx, cy, layout.dotRadius, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }

        // A crisp core on top of the (possibly restored-away) glow, always drawn: without
        // `bloom` this is simply the whole dot, matching a small thumbnail's need for a clean
        // read with no soft edges competing at a handful of screen pixels per LED.
        const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, layout.dotRadius);
        gradient.addColorStop(0, `rgb(${Math.min(255, r + 40)}, ${Math.min(255, g + 40)}, ${Math.min(255, b + 40)})`);
        gradient.addColorStop(1, `rgb(${r}, ${g}, ${b})`);
        ctx.beginPath();
        ctx.fillStyle = gradient;
        ctx.arc(cx, cy, layout.dotRadius, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    if (this.showGrid) {
      ctx.strokeStyle = "rgba(255, 255, 255, 0.05)";
      ctx.lineWidth = 1;
      for (let x = 0; x <= width; x++) {
        const px = layout.offsetX - layout.cellSize / 2 + x * layout.cellSize;
        ctx.beginPath();
        ctx.moveTo(px, layout.offsetY - layout.cellSize / 2);
        ctx.lineTo(px, layout.offsetY - layout.cellSize / 2 + height * layout.cellSize);
        ctx.stroke();
      }
      for (let y = 0; y <= height; y++) {
        const py = layout.offsetY - layout.cellSize / 2 + y * layout.cellSize;
        ctx.beginPath();
        ctx.moveTo(layout.offsetX - layout.cellSize / 2, py);
        ctx.lineTo(layout.offsetX - layout.cellSize / 2 + width * layout.cellSize, py);
        ctx.stroke();
      }
    }
  }

  private _emitPointer(event: PointerEvent, phase: MatrixPointerDetail["phase"]): void {
    const canvas = this._canvasRef.value;
    if (!canvas || !this._layout) return;
    const box = canvas.getBoundingClientRect();
    const canvasX = ((event.clientX - box.left) / box.width) * canvas.width;
    const canvasY = ((event.clientY - box.top) / box.height) * canvas.height;
    const width = this.frame?.width ?? GRID_WIDTH;
    const height = this.frame?.height ?? GRID_HEIGHT;
    const cell = phase === "leave" ? null : pointToCell(this._layout, canvasX, canvasY, width, height);
    if (!cell && phase !== "leave") return;
    this.dispatchEvent(
      new CustomEvent<MatrixPointerDetail>("matrix-pointer", {
        detail: { x: cell?.[0] ?? -1, y: cell?.[1] ?? -1, phase, buttons: event.buttons, pointerId: event.pointerId },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _onPointerDown = (event: PointerEvent): void => {
    if (!this.interactive) return;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    event.preventDefault();
    this._emitPointer(event, "down");
  };

  private _onPointerMove = (event: PointerEvent): void => {
    // Only a "move" DURING a captured press represents an in-progress stroke -- a bare hover
    // (no button held) must never reach a tool's move-handling as if a stroke were active. This
    // mirrors `_onPointerLeave`'s own `event.buttons !== 0` guard below.
    if (!this.interactive || event.buttons === 0) return;
    this._emitPointer(event, "move");
  };

  private _onPointerUp = (event: PointerEvent): void => {
    if (!this.interactive) return;
    this._emitPointer(event, "up");
  };

  private _onPointerLeave = (event: PointerEvent): void => {
    if (!this.interactive || event.buttons !== 0) return;
    this._emitPointer(event, "leave");
  };

  render() {
    return html`<canvas
      ${ref(this._canvasRef)}
      class=${this.interactive ? "interactive" : ""}
      @pointerdown=${this._onPointerDown}
      @pointermove=${this._onPointerMove}
      @pointerup=${this._onPointerUp}
      @pointercancel=${this._onPointerUp}
      @pointerleave=${this._onPointerLeave}
    ></canvas>`;
  }

  static styles = css`
    :host {
      display: block;
      width: 100%;
      height: 100%;
      contain: layout size;
    }
    canvas {
      display: block;
      width: 100%;
      height: 100%;
      border-radius: inherit;
      touch-action: none;
    }
    canvas.interactive {
      cursor: crosshair;
    }
  `;
}

customElements.define("iledclock-matrix-canvas", IledclockMatrixCanvas);

declare global {
  interface HTMLElementTagNameMap {
    "iledclock-matrix-canvas": IledclockMatrixCanvas;
  }
}
