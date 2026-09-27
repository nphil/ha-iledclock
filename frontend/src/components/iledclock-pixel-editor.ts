import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { createRef, ref } from "lit/directives/ref.js";
import { TOKENS_CSS } from "../styles/tokens.ts";
import { quantizePreviewRgb, type RGB } from "../lib/color.ts";
import { cloneFrame, getPixel, setPixelMut, shiftFrame, type PixelFrame } from "../lib/grid.ts";
import { floodFill } from "../lib/flood-fill.ts";
import { plotEllipse, plotLine, plotRect } from "../lib/rasterize.ts";
import { editableWidth, isEditablePixel, mirrorEditableFrame, moveEditableCell, preserveClockRegionPixels } from "../lib/clock-region.ts";
import { ledSizeFor } from "../lib/led-size.ts";
import type { MatrixPointerDetail } from "./iledclock-matrix-canvas.ts";
import "./iledclock-matrix-canvas.ts";
import "./iledclock-editor-toolbox.ts";

type EditorTool = "pen" | "eraser" | "fill" | "line" | "rectangle" | "ellipse" | "eyedropper" | "text" | "pan" | "shift";
interface TextStamp { text: string; color: RGB; }
interface PointerPoint { x: number; y: number; }
interface PinchState { distance: number; pitch: number; middleX: number; middleY: number; scrollLeft: number; scrollTop: number; }
const KEYBOARD_DIRECTIONS: Record<string, PointerPoint> = {
  ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 },
};

function brushFrame(frame: PixelFrame, x: number, y: number, color: RGB, size: number, maxWidth: number): PixelFrame {
  const next = cloneFrame(frame);
  const shownColor = quantizePreviewRgb(color);
  const startX = x - Math.floor(size / 2);
  const startY = y - Math.floor(size / 2);
  const widthLimit = Math.min(frame.width, maxWidth);
  for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) {
    const column = startX + dx;
    if (column < 0 || column >= widthLimit) continue;
    setPixelMut(next, column, startY + dy, shownColor);
  }
  return next;
}


function pointsDistance(a: PointerPoint, b: PointerPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function clampPitch(pitch: number): number { return Math.max(8, Math.min(40, Math.round(pitch))); }

export class IledclockPixelEditor extends LitElement {
  static properties = {
    frame: { attribute: false },
    onionSkin: { attribute: false },
    wrap: { type: Boolean },
    activeColor: { attribute: false },
    brushSize: { type: Number, attribute: "brush-size" },
    clockRegion: { type: Boolean, attribute: "clock-region" },
    stampText: { attribute: false },
    narrow: { type: Boolean, reflect: true },
    disabled: { type: Boolean },
    _tool: { state: true },
    _filled: { state: true },
    _pitch: { state: true },
    _fitPitch: { state: true },
    _draft: { state: true },
    _panning: { state: true },
    _canvasFocused: { state: true },
    _keyboardCell: { state: true },
  };

  declare frame: PixelFrame;
  declare onionSkin: PixelFrame | null;
  declare wrap: boolean;
  declare activeColor: RGB;
  declare brushSize: number;
  declare clockRegion: boolean;
  declare stampText: TextStamp | null;
  declare narrow: boolean;
  declare disabled: boolean;
  declare _tool: EditorTool;
  declare _filled: boolean;
  declare _pitch: number;
  declare _fitPitch: number;
  declare _draft: PixelFrame | null;
  declare _panning: boolean;
  declare _canvasFocused: boolean;
  declare _keyboardCell: { x: number; y: number };

  private readonly _viewportRef = createRef<HTMLDivElement>();
  private _resizeObserver: ResizeObserver | null = null;
  private _dragStart: [number, number] | null = null;
  private _strokeActive = false;
  private _panningStart: PointerPoint | null = null;
  private _spaceHeld = false;
  private _touchPoints = new Map<number, PointerPoint>();
  private _pinch: PinchState | null = null;
  private _isPinching = false;

  constructor() {
    super();
    this.wrap = false;
    this.activeColor = [255, 255, 255];
    this.brushSize = 1;
    this.clockRegion = false;
    this.stampText = null;
    this.narrow = true;
    this.disabled = false;
    this._tool = "pen";
    this._filled = false;
    this._pitch = 8;
    this._fitPitch = 8;
    this._draft = null;
    this._panning = false;
    this._canvasFocused = false;
    this._keyboardCell = { x: 0, y: 0 };
  }

  connectedCallback(): void {
    super.connectedCallback();
    this.addEventListener("pointerdown", this._capturePointerDown, true);
    this.addEventListener("pointermove", this._capturePointerMove, true);
    this.addEventListener("pointerup", this._capturePointerEnd, true);
    this.addEventListener("pointercancel", this._capturePointerEnd, true);
    this.addEventListener("keydown", this._onKeyDown);
    this.addEventListener("keyup", this._onKeyUp);
    this._resizeObserver = new ResizeObserver(() => this._measure());
    window.addEventListener("resize", this._measure);
  }

  protected firstUpdated(): void {
    const viewport = this._viewportRef.value;
    if (viewport) this._resizeObserver?.observe(viewport);
    this._measure();
  }

  protected updated(changed: PropertyValues): void {
    if (changed.has("frame")) {
      this._draft = null;
      this._strokeActive = false;
    }
    if (changed.has("frame") || changed.has("clockRegion")) {
      this._keyboardCell = moveEditableCell(this._keyboardCell, { x: 0, y: 0 }, this.frame.width, this.frame.height, this.clockRegion);
    }
    if (changed.has("disabled") && this.disabled) this._cancelGesture();
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.removeEventListener("pointerdown", this._capturePointerDown, true);
    this.removeEventListener("pointermove", this._capturePointerMove, true);
    this.removeEventListener("pointerup", this._capturePointerEnd, true);
    this.removeEventListener("pointercancel", this._capturePointerEnd, true);
    this.removeEventListener("keydown", this._onKeyDown);
    this.removeEventListener("keyup", this._onKeyUp);
    window.removeEventListener("resize", this._measure);
    this._resizeObserver?.disconnect();
    this._resizeObserver = null;
    this._cancelGesture();
  }

  private _measure = (): void => {
    const viewport = this._viewportRef.value;
    const box = viewport?.getBoundingClientRect();
    if (!box || box.width <= 0 || box.height <= 0) return;
    const fit = ledSizeFor("editor", box.width, box.height, { maxPitch: 22 }).pitch;
    this._fitPitch = fit;
    if (this._pitch < 8 || !this._userZoomed) this._pitch = fit;
  };

  private _userZoomed = false;

  private _emit(name: string, detail: Record<string, unknown> = {}): void {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }

  private _emitFrame(frame: PixelFrame): void { this._emit("frame-changed", { frame }); }

  private _cancelGesture(): void {
    this._draft = null;
    this._dragStart = null;
    this._strokeActive = false;
    this._panning = false;
    this._panningStart = null;
    this._pinch = null;
    this._isPinching = false;
    this._touchPoints.clear();
  }

  private _cancelStroke(): void {
    this._draft = null;
    this._dragStart = null;
    this._strokeActive = false;
  }

  private _capturePointerDown = (event: PointerEvent): void => {
    if (event.pointerType !== "touch" || !event.composedPath().some((node) => node instanceof HTMLElement && node.classList.contains("canvas-viewport"))) return;
    this._touchPoints.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this._touchPoints.size < 2) return;
    const points = [...this._touchPoints.values()];
    const viewport = this._viewportRef.value;
    if (!viewport) return;
    this._isPinching = true;
    this._cancelStroke();
    this._pinch = {
      distance: pointsDistance(points[0]!, points[1]!),
      pitch: this._pitch,
      middleX: (points[0]!.x + points[1]!.x) / 2,
      middleY: (points[0]!.y + points[1]!.y) / 2,
      scrollLeft: viewport.scrollLeft,
      scrollTop: viewport.scrollTop,
    };
  };

  private _capturePointerMove = (event: PointerEvent): void => {
    if (!this._touchPoints.has(event.pointerId) || !this._isPinching) return;
    this._touchPoints.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const points = [...this._touchPoints.values()];
    const pinch = this._pinch;
    const viewport = this._viewportRef.value;
    if (!pinch || !viewport || points.length < 2) return;
    const distance = Math.max(1, pointsDistance(points[0]!, points[1]!));
    const middleX = (points[0]!.x + points[1]!.x) / 2;
    const middleY = (points[0]!.y + points[1]!.y) / 2;
    this._pitch = clampPitch(pinch.pitch * distance / Math.max(1, pinch.distance));
    this._userZoomed = true;
    viewport.scrollLeft = pinch.scrollLeft - (middleX - pinch.middleX);
    viewport.scrollTop = pinch.scrollTop - (middleY - pinch.middleY);
    event.preventDefault();
  };

  private _capturePointerEnd = (event: PointerEvent): void => {
    if (!this._touchPoints.has(event.pointerId)) return;
    this._touchPoints.delete(event.pointerId);
    if (this._touchPoints.size < 2) {
      this._pinch = null;
      this._isPinching = false;
    }
  };

  private _onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === " ") this._spaceHeld = true;
    if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "z") return;
    const target = event.target;
    if (target instanceof HTMLElement && target.matches("input, textarea, select")) return;
    event.preventDefault();
    this._emit(event.shiftKey ? "redo-requested" : "undo-requested");
  };

  private _onKeyUp = (event: KeyboardEvent): void => { if (event.key === " ") this._spaceHeld = false; };

  private _onCanvasFocus = (): void => { this._canvasFocused = true; };
  private _onCanvasBlur = (): void => { this._canvasFocused = false; };

  private _onCanvasKeydown = (event: KeyboardEvent): void => {
    if (this.disabled) return;
    const delta = KEYBOARD_DIRECTIONS[event.key];
    if (delta) {
      event.preventDefault();
      if (this._tool === "shift") {
        this._emitFrame(preserveClockRegionPixels(this.frame, shiftFrame(this.frame, delta.x, delta.y, this.wrap), this.clockRegion));
      } else {
        this._keyboardCell = moveEditableCell(this._keyboardCell, delta, this.frame.width, this.frame.height, this.clockRegion);
      }
      return;
    }
    if (event.key !== " " && event.key !== "Enter") return;
    event.preventDefault();
    if (event.repeat) return;
    const detail = { x: this._keyboardCell.x, y: this._keyboardCell.y, buttons: 1, pointerId: -1 };
    this._onMatrixPointer(new CustomEvent<MatrixPointerDetail>("matrix-pointer", { detail: { ...detail, phase: "down" } }));
    this._onMatrixPointer(new CustomEvent<MatrixPointerDetail>("matrix-pointer", { detail: { ...detail, phase: "up" } }));
  };

  private _zoomBy(delta: number): void {
    this._pitch = clampPitch(this._pitch + delta);
    this._userZoomed = true;
  }

  private _fit(): void {
    this._pitch = this._fitPitch;
    this._userZoomed = false;
    const viewport = this._viewportRef.value;
    if (viewport) {
      viewport.scrollLeft = 0;
      viewport.scrollTop = 0;
    }
  }

  private _onWheel = (event: WheelEvent): void => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    this._zoomBy(event.deltaY < 0 ? 1 : -1);
  };

  private _onViewportPointerDown = (event: PointerEvent): void => {
    if (event.button !== 1 && !this._spaceHeld && this._tool !== "pan") return;
    event.preventDefault();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    this._panningStart = { x: event.clientX, y: event.clientY };
    this._panning = true;
  };

  private _onViewportPointerMove = (event: PointerEvent): void => {
    if (!this._panning || !this._panningStart) return;
    const viewport = this._viewportRef.value;
    if (!viewport) return;
    viewport.scrollLeft -= event.clientX - this._panningStart.x;
    viewport.scrollTop -= event.clientY - this._panningStart.y;
    this._panningStart = { x: event.clientX, y: event.clientY };
  };

  private _onViewportPointerUp = (event: PointerEvent): void => {
    if (this._panning) {
      this._panning = false;
      this._panningStart = null;
      return;
    }
    if (!this._strokeActive || !event.composedPath().some((node) => node instanceof HTMLElement && node.classList.contains("canvas-viewport"))) return;
    if (this._draft) this._emitFrame(this._draft);
    this._draft = null;
    this._strokeActive = false;
    this._dragStart = null;
  };

  private _selectTool = (event: CustomEvent<{ tool: EditorTool }>): void => {
    this._tool = event.detail.tool;
    this._cancelStroke();
  };

  private _onMirror = (event: CustomEvent<{ axis: "horizontal" | "vertical" }>): void => {
    this._emitFrame(mirrorEditableFrame(this.frame, event.detail.axis, this.clockRegion));
  };

  private _onFilled = (event: CustomEvent<{ filled: boolean }>): void => { this._filled = event.detail.filled; };
  private _onWrap = (event: CustomEvent<{ wrap: boolean }>): void => { this._emit("wrap-changed", { wrap: event.detail.wrap }); };

  private _onMatrixPointer = (event: CustomEvent<MatrixPointerDetail>): void => {
    if (this.disabled || this._isPinching) return;
    const { x, y, phase } = event.detail;
    if (phase === "leave" || y < 0 || !isEditablePixel(x, this.frame.width, this.clockRegion)) return;

    switch (this._tool) {
      case "pen":
      case "eraser": {
        const color: RGB = this._tool === "eraser" ? [0, 0, 0] : this.activeColor;
        if (phase === "down") {
          this._draft = brushFrame(this.frame, x, y, color, this.brushSize, editableWidth(this.frame.width, this.clockRegion));
          this._strokeActive = true;
          return;
        }
        if (!this._strokeActive || !this._draft) return;
        this._draft = brushFrame(this._draft, x, y, color, this.brushSize, editableWidth(this.frame.width, this.clockRegion));
        if (phase === "up") {
          this._emitFrame(this._draft);
          this._draft = null;
          this._strokeActive = false;
        }
        return;
      }
      case "fill":
        if (phase === "down") {
          const filled = floodFill(this.frame, x, y, this.activeColor, this.wrap);
          this._emitFrame(preserveClockRegionPixels(this.frame, filled, this.clockRegion));
        }
        return;
      case "eyedropper":
        if (phase === "down") this._emit("color-picked", { color: getPixel(this.frame, x, y) });
        return;
      case "text":
        if (phase === "down") {
          if (this.stampText) this._emit("text-place-requested", { x, y });
          else this._emit("text-config-requested", { mode: "stamp" });
        }
        return;
      case "line":
      case "rectangle":
      case "ellipse":
      case "shift": {
        if (phase === "down") {
          this._dragStart = [x, y];
          this._draft = this.frame;
          this._strokeActive = true;
          return;
        }
        if (!this._dragStart || !this._strokeActive) return;
        const [startX, startY] = this._dragStart;
        const drafted = this._tool === "line"
          ? plotLine(this.frame, startX, startY, x, y, this.activeColor)
          : this._tool === "rectangle"
            ? plotRect(this.frame, startX, startY, x, y, this.activeColor, this._filled)
            : this._tool === "ellipse"
              ? plotEllipse(this.frame, startX, startY, x, y, this.activeColor, this._filled)
              : preserveClockRegionPixels(this.frame, shiftFrame(this.frame, x - startX, y - startY, this.wrap), this.clockRegion);
        this._draft = drafted;
        if (phase === "up") {
          this._emitFrame(drafted);
          this._draft = null;
          this._dragStart = null;
          this._strokeActive = false;
        }
        return;
      }
      case "pan":
        return;
    }
  };

  render() {
    const displayFrame = this._draft ?? this.frame;
    const stageWidth = this._pitch * displayFrame.width;
    const stageHeight = this._pitch * displayFrame.height;
    const worldStyle = `width: max(100%, ${stageWidth}px); height: max(100%, ${stageHeight}px);`;
    const matrixStyle = `width: ${stageWidth}px; height: ${stageHeight}px;`;
    const cursorStyle = `left: ${this._keyboardCell.x * this._pitch}px; top: ${this._keyboardCell.y * this._pitch}px; width: ${this._pitch}px; height: ${this._pitch}px;`;
    const cursorStatus = `Column ${this._keyboardCell.x + 1} of ${displayFrame.width}, row ${this._keyboardCell.y + 1} of ${displayFrame.height}. ${this._tool} tool; colour ${this.activeColor.join(", ")}.`;
    return html`<div class="workbench ${this._tool === "pan" ? "pan-tool" : ""}">
      <iledclock-editor-toolbox .tool=${this._tool} .narrow=${this.narrow} .filled=${this._filled} .wrap=${this.wrap} .activeColor=${this.activeColor} @editor-tool-selected=${this._selectTool} @editor-mirror-requested=${this._onMirror} @editor-filled-changed=${this._onFilled} @editor-wrap-changed=${this._onWrap} @editor-color-requested=${() => this._emit("color-requested")}></iledclock-editor-toolbox>
      <section class="canvas-panel" aria-label="Pixel drawing canvas">
        <div class="canvas-controls">
          <span class="pitch-label" aria-live="polite">${this._pitch} px / LED</span>
          <button type="button" class="zoom-control" aria-label="Zoom out" ?disabled=${this._pitch <= 8} @click=${() => this._zoomBy(-1)}>−</button>
          <button type="button" class="zoom-control" aria-label="Zoom in" ?disabled=${this._pitch >= 40} @click=${() => this._zoomBy(1)}>+</button>
          <button type="button" class="fit-control" @click=${this._fit}>Fit</button>
        </div>
        <div class="canvas-viewport" ${ref(this._viewportRef)} @wheel=${this._onWheel} @pointerdown=${this._onViewportPointerDown} @pointermove=${this._onViewportPointerMove} @pointerup=${this._onViewportPointerUp} @pointercancel=${this._onViewportPointerUp}>
          <div class="canvas-world" style=${worldStyle}>
            <div class="canvas-stage" style=${matrixStyle}>
              <iledclock-matrix-canvas class="active-canvas" .frame=${displayFrame} interactive show-grid role="application" aria-roledescription="pixel editor canvas" aria-label=${`Pixel art canvas, ${displayFrame.width} columns by ${displayFrame.height} rows. Use arrow keys to move and Space or Enter to use the ${this._tool} tool.`} aria-describedby="canvas-help canvas-cursor-status" aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown Space Enter" aria-disabled=${String(this.disabled)} tabindex="0" @focus=${this._onCanvasFocus} @blur=${this._onCanvasBlur} @keydown=${this._onCanvasKeydown} @matrix-pointer=${this._onMatrixPointer}></iledclock-matrix-canvas>
              ${this.onionSkin ? html`<iledclock-matrix-canvas class="onion-layer" .frame=${this.onionSkin} .bloom=${false} aria-hidden="true"></iledclock-matrix-canvas>` : nothing}
              ${this.clockRegion ? html`<div class="clock-region" aria-hidden="true"><span>Live clock</span></div>` : nothing}
              ${this._canvasFocused ? html`<div class="keyboard-cursor" style=${cursorStyle} aria-hidden="true"></div>` : nothing}
            </div>
          </div>
        </div>
        <p class="canvas-help" id="canvas-help">Drag to draw. Or focus the canvas, move with arrow keys, and use the selected tool with Space or Enter. Pinch or Ctrl/⌘ + wheel to zoom.</p>
        <p class="sr-only" id="canvas-cursor-status" aria-live="polite" aria-atomic="true">${cursorStatus}</p>
      </section>
    </div>`;
  }

  static styles = [TOKENS_CSS, css`
    :host { display: block; min-width: 0; container-type: inline-size; }
    .workbench { display: grid; grid-template-columns: var(--lu-target) minmax(0, 1fr); align-items: start; gap: var(--lu-space-3); min-width: 0; }
    .canvas-panel { display: grid; min-width: 0; gap: var(--lu-space-2); }
    .canvas-controls { display: flex; align-items: center; justify-content: flex-end; gap: var(--lu-space-1); min-height: var(--lu-target); }
    .pitch-label { margin-right: auto; color: var(--lu-ink-3); font: 400 var(--lu-type-caption)/1.2 var(--lu-font); font-variant-numeric: tabular-nums; }
    .zoom-control, .fit-control { min-width: var(--lu-target); min-height: var(--lu-target); border: 1px solid var(--lu-edge); border-radius: var(--lu-radius-control); background: var(--lu-tile); color: var(--lu-ink); font: 500 var(--lu-type-label)/1 var(--lu-font); cursor: pointer; }
    .zoom-control { font-size: var(--lu-type-title); }
    .zoom-control:disabled { opacity: .45; cursor: default; }
    .canvas-viewport { width: 100%; height: min(calc(100dvh - 360px), 42rem); min-height: 128px; overflow: auto; overscroll-behavior: contain; touch-action: none; border-radius: var(--lu-radius-tile); background: color-mix(in srgb, var(--lu-card) 60%, transparent); scrollbar-width: thin; }
    .canvas-world { display: grid; min-width: 100%; min-height: 100%; place-items: center; }
    .canvas-stage { position: relative; flex: none; max-width: none; max-height: none; }
    .active-canvas, .onion-layer { position: absolute; inset: 0; display: block; width: 100%; height: 100%; }
    .active-canvas { z-index: 1; }
    .onion-layer { z-index: 2; opacity: .28; mix-blend-mode: screen; pointer-events: none; }
    .clock-region { position: absolute; z-index: 3; inset-block: 0; inset-inline-end: 0; display: grid; place-items: center; width: 50%; border-inline-start: 1px dashed var(--lu-edge-raised); background: color-mix(in srgb, var(--lu-card) 18%, transparent); color: var(--lu-ink-2); pointer-events: none; }
    .clock-region span { padding: var(--lu-space-1) var(--lu-space-2); border-radius: var(--lu-radius-pill); background: color-mix(in srgb, var(--lu-card) 74%, transparent); font: 500 var(--lu-type-caption)/1.2 var(--lu-font); }
    .keyboard-cursor { position: absolute; z-index: 4; box-sizing: border-box; border: 2px solid var(--lu-accent); pointer-events: none; }
    .active-canvas:focus-visible { outline: 2px solid var(--lu-accent); outline-offset: 3px; }
    .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
    .canvas-help { margin: 0; color: var(--lu-ink-3); font: 400 var(--lu-type-caption)/1.35 var(--lu-font); }
    .pan-tool .canvas-viewport { cursor: grab; }
    .pan-tool .canvas-viewport:active { cursor: grabbing; }
    :host([narrow]) .workbench { display: flex; flex-direction: column; gap: var(--lu-space-2); }
    :host([narrow]) .canvas-panel { order: 0; width: 100%; }
    :host([narrow]) iledclock-editor-toolbox { order: 1; width: 100%; }
    @media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
  `];
}

customElements.define("iledclock-pixel-editor", IledclockPixelEditor);

declare global { interface HTMLElementTagNameMap { "iledclock-pixel-editor": IledclockPixelEditor; } }
