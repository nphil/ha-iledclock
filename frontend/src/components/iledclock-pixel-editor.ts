/** The studio's pixel-art editor: a full toolbar (pen, eraser, fill, line, rectangle, ellipse,
 * eyedropper, text stamp, shift, mirror, undo/redo, zoom) wrapped around one interactive
 * `iledclock-matrix-canvas`. Controlled -- `frame` is owned by the parent; every tool commits its
 * result as a `frame-changed` event built from `grid.ts`/`flood-fill.ts`/`rasterize.ts`, never by
 * mutating the incoming frame directly. Undo/redo are requests, not local state: the parent owns
 * the history (`undo-stack.ts`) and feeds a new `frame` back down.
 */

import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { TOKENS_CSS } from "../styles/tokens.ts";
import type { HomeAssistant } from "../types.ts";
import { rgbToHex, hexToRgb, type RGB } from "../lib/color.ts";
import { cloneFrame, getPixel, setPixel, type PixelFrame } from "../lib/grid.ts";
import { floodFill } from "../lib/flood-fill.ts";
import { plotEllipse, plotLine, plotRect } from "../lib/rasterize.ts";
import { mirrorFrame, shiftFrame } from "../lib/grid.ts";
import { buildTextRenderSpec, renderRequest } from "../lib/ws-api.ts";
import { mdiIcon, type MdiIconName } from "../lib/mdi-icons.ts";
import type { MatrixPointerDetail } from "./iledclock-matrix-canvas.ts";
import "./iledclock-matrix-canvas.ts";

type Tool = "pen" | "eraser" | "fill" | "line" | "rectangle" | "ellipse" | "eyedropper" | "text" | "shift" | "mirror-h" | "mirror-v";

interface ToolDef {
  tool: Tool;
  icon: MdiIconName;
  label: string;
}

const TOOLS: readonly ToolDef[] = [
  { tool: "pen", icon: "pen", label: "Pen" },
  { tool: "eraser", icon: "eraser", label: "Eraser" },
  { tool: "fill", icon: "fill", label: "Fill" },
  { tool: "line", icon: "line", label: "Line" },
  { tool: "rectangle", icon: "rectangle", label: "Rectangle" },
  { tool: "ellipse", icon: "ellipse", label: "Ellipse" },
  { tool: "eyedropper", icon: "eyedropper", label: "Eyedropper" },
  { tool: "text", icon: "textStamp", label: "Text stamp" },
  { tool: "shift", icon: "shift", label: "Shift" },
];

const ZOOM_LEVELS = [100, 150, 200, 300, 400];

export class IledclockPixelEditor extends LitElement {
  static properties = {
    frame: { attribute: false },
    onionSkin: { attribute: false },
    wrap: { type: Boolean },
    activeColor: { attribute: false },
    recentColors: { attribute: false },
    hass: { attribute: false },
    entryId: { attribute: "entry-id" },
    disabled: { type: Boolean },
    _tool: { state: true },
    _filled: { state: true },
    _zoomIndex: { state: true },
    _draft: { state: true },
    _textArmed: { state: true },
    _textValue: { state: true },
    _busy: { state: true },
  };

  declare frame: PixelFrame;
  declare onionSkin: PixelFrame | null;
  declare wrap: boolean;
  declare activeColor: RGB;
  declare recentColors: RGB[];
  declare hass: HomeAssistant | undefined;
  declare entryId: string | undefined;
  declare disabled: boolean;
  declare _tool: Tool;
  declare _filled: boolean;
  declare _zoomIndex: number;
  declare _draft: PixelFrame | null;
  declare _textArmed: boolean;
  declare _textValue: string;
  declare _busy: boolean;

  private _dragStart: [number, number] | null = null;

  constructor() {
    super();
    this.wrap = false;
    this.activeColor = [255, 255, 255];
    this.recentColors = [];
    this.disabled = false;
    this._tool = "pen";
    this._filled = false;
    this._zoomIndex = 0;
    this._draft = null;
    this._textArmed = false;
    this._textValue = "";
    this._busy = false;
  }

  protected updated(changed: PropertyValues): void {
    if (changed.has("frame")) this._draft = null;
  }

  private _emitFrame(frame: PixelFrame): void {
    this.dispatchEvent(new CustomEvent("frame-changed", { detail: { frame }, bubbles: true, composed: true }));
  }

  private _pickColor(color: RGB): void {
    this.dispatchEvent(new CustomEvent("color-picked", { detail: { color }, bubbles: true, composed: true }));
  }

  private _selectTool(tool: Tool): void {
    this._tool = tool;
    this._textArmed = tool === "text";
  }

  private _onMirror(axis: "horizontal" | "vertical"): void {
    this._emitFrame(mirrorFrame(this.frame, axis));
  }

  private _onUndo(): void {
    this.dispatchEvent(new CustomEvent("undo-requested", { bubbles: true, composed: true }));
  }

  private _onRedo(): void {
    this.dispatchEvent(new CustomEvent("redo-requested", { bubbles: true, composed: true }));
  }

  private _zoomIn(): void {
    this._zoomIndex = Math.min(ZOOM_LEVELS.length - 1, this._zoomIndex + 1);
  }

  private _zoomOut(): void {
    this._zoomIndex = Math.max(0, this._zoomIndex - 1);
  }

  // ---- pointer-driven tools ----

  private _onMatrixPointer = (event: CustomEvent<MatrixPointerDetail>): void => {
    if (this.disabled) return;
    const { x, y, phase } = event.detail;
    if (phase === "leave") return;
    if (x < 0 || y < 0) return;

    switch (this._tool) {
      case "pen":
      case "eraser": {
        const color: RGB = this._tool === "eraser" ? [0, 0, 0] : this.activeColor;
        if (phase === "down") {
          this._draft = setPixel(this.frame, x, y, color);
          return;
        }
        // A "move" or "up" with no stroke captured here (this._draft still null) is not a
        // continuation of anything this canvas started -- e.g. a pointer that was pressed down
        // elsewhere (another control, mid hold-to-confirm) and only later happens to move/release
        // over this canvas once some other view change re-mounted it underneath the same on-screen
        // position. Ignore it rather than painting a stray pixel from an interaction that never
        // began here.
        if (!this._draft) return;
        const next = setPixel(this._draft, x, y, color);
        this._draft = next;
        if (phase === "up") {
          this._emitFrame(next);
          this._draft = null;
        }
        return;
      }
      case "fill": {
        if (phase !== "down") return;
        this._emitFrame(floodFill(this.frame, x, y, this.activeColor, this.wrap));
        return;
      }
      case "eyedropper": {
        if (phase !== "down") return;
        this._pickColor(getPixel(this.frame, x, y));
        return;
      }
      case "text": {
        if (phase !== "down") return;
        void this._stampTextAt(x, y);
        return;
      }
      case "line":
      case "rectangle":
      case "ellipse": {
        if (phase === "down") {
          this._dragStart = [x, y];
          this._draft = this.frame;
          return;
        }
        if (!this._dragStart) return;
        const [sx, sy] = this._dragStart;
        const drafted =
          this._tool === "line"
            ? plotLine(this.frame, sx, sy, x, y, this.activeColor)
            : this._tool === "rectangle"
              ? plotRect(this.frame, sx, sy, x, y, this.activeColor, this._filled)
              : plotEllipse(this.frame, sx, sy, x, y, this.activeColor, this._filled);
        this._draft = drafted;
        if (phase === "up") {
          this._emitFrame(drafted);
          this._draft = null;
          this._dragStart = null;
        }
        return;
      }
      case "shift": {
        if (phase === "down") {
          this._dragStart = [x, y];
          this._draft = this.frame;
          return;
        }
        if (!this._dragStart) return;
        const [sx, sy] = this._dragStart;
        const shifted = shiftFrame(this.frame, x - sx, y - sy, this.wrap);
        this._draft = shifted;
        if (phase === "up") {
          this._emitFrame(shifted);
          this._draft = null;
          this._dragStart = null;
        }
        return;
      }
    }
  };

  private async _stampTextAt(x: number, y: number): Promise<void> {
    const text = this._textValue.trim();
    if (!text || !this.hass?.callWS || !this.entryId) return;
    const spec = buildTextRenderSpec(text, this.activeColor);
    if (!spec) return;
    this._busy = true;
    try {
      const result = await this.hass.callWS<{ frames: string[] }>(renderRequest(this.entryId, spec));
      const b64 = result.frames[0];
      if (!b64) return;
      const binary = atob(b64);
      let next = cloneFrame(this.frame);
      const stampWidth = this.frame.width;
      const stampHeight = this.frame.height;
      for (let sy = 0; sy < stampHeight; sy++) {
        for (let sx = 0; sx < stampWidth; sx++) {
          const i = (sy * stampWidth + sx) * 3;
          const r = binary.charCodeAt(i) || 0;
          const g = binary.charCodeAt(i + 1) || 0;
          const b = binary.charCodeAt(i + 2) || 0;
          if (r === 0 && g === 0 && b === 0) continue;
          const tx = x + sx - Math.floor(stampWidth / 2);
          const ty = y + sy - Math.floor(stampHeight / 2);
          next = setPixel(next, tx, ty, [r, g, b]);
        }
      }
      this._emitFrame(next);
    } finally {
      this._busy = false;
      this._textArmed = false;
    }
  }

  render() {
    const zoom = ZOOM_LEVELS[this._zoomIndex]!;
    const displayFrame = this._draft ?? this.frame;
    return html`
      <div class="toolbar">
        ${TOOLS.map(
          (def) => html`
            <button
              type="button"
              class="tool-btn ${this._tool === def.tool ? "selected" : ""}"
              ?disabled=${this.disabled || (def.tool === "text" && (!this.hass?.callWS || !this.entryId))}
              @click=${() => this._selectTool(def.tool)}
              aria-label=${def.label}
              title=${def.label}
            >
              ${mdiIcon(def.icon)}
            </button>
          `,
        )}
        ${this._tool === "rectangle" || this._tool === "ellipse"
          ? html`<button type="button" class="tool-btn ${this._filled ? "selected" : ""}" @click=${() => (this._filled = !this._filled)} title="Filled">${mdiIcon("check")}</button>`
          : nothing}
        <button type="button" class="tool-btn" @click=${() => this._onMirror("horizontal")} title="Mirror horizontal">${mdiIcon("flipH")}</button>
        <button type="button" class="tool-btn" @click=${() => this._onMirror("vertical")} title="Mirror vertical">${mdiIcon("flipV")}</button>
        <button type="button" class="tool-btn" @click=${this._onUndo} title="Undo">${mdiIcon("undo")}</button>
        <button type="button" class="tool-btn" @click=${this._onRedo} title="Redo">${mdiIcon("redo")}</button>
        <span class="zoom-group">
          <button type="button" class="tool-btn" @click=${this._zoomOut} title="Zoom out">${mdiIcon("zoomOut")}</button>
          <span class="zoom-value">${zoom}%</span>
          <button type="button" class="tool-btn" @click=${this._zoomIn} title="Zoom in">${mdiIcon("zoomIn")}</button>
        </span>
      </div>
      ${this._textArmed
        ? html`<input class="text-stamp-input" type="text" placeholder="Type, then tap the canvas" .value=${this._textValue} @input=${(e: Event) => (this._textValue = (e.target as HTMLInputElement).value)} />`
        : nothing}
      <div class="canvas-scroll">
        <div class="canvas-wrap" style="width: ${zoom}%">
          <iledclock-matrix-canvas .frame=${displayFrame} interactive show-grid @matrix-pointer=${this._onMatrixPointer}></iledclock-matrix-canvas>
        </div>
      </div>
      <div class="palette">
        ${this.recentColors.map(
          (color) => html`<button type="button" class="swatch" style="background:${`rgb(${color.join(",")})`}" @click=${() => this._pickColor(color)} aria-label="Recent colour"></button>`,
        )}
        <input class="color-input" type="color" .value=${rgbToHex(this.activeColor)} @input=${(e: Event) => this._pickColor(hexToRgb((e.target as HTMLInputElement).value))} />
      </div>
    `;
  }

  static styles = [
    TOKENS_CSS,
    css`
    :host {
      display: block;
      container-type: inline-size;
    }
    .toolbar {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      margin-bottom: 8px;
    }
    .tool-btn {
      width: var(--lu-target, 48px);
      height: var(--lu-target, 48px);
      border-radius: var(--lu-radius-control);
      border: none;
      background: var(--lu-tile);
      color: var(--lu-ink);
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex: none;
      transition: transform 90ms var(--lu-ease, ease), opacity 90ms var(--lu-ease, ease);
    }
    .tool-btn.selected {
      background: var(--lu-accent);
      color: var(--lu-accent-ink);
      box-shadow: var(--lu-highlight-raised), var(--lu-shadow-raised);
    }
    .tool-btn:active:not(:disabled) {
      transform: scale(0.97);
    }
    .tool-btn:disabled {
      opacity: 0.4;
      cursor: default;
    }
    .zoom-group {
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    .zoom-value {
      font-size: 12px;
      color: var(--lu-ink-2);
      min-width: 3.5em;
      text-align: center;
    }
    .text-stamp-input {
      width: 100%;
      min-height: var(--lu-target, 48px);
      border-radius: var(--lu-radius-control);
      border: 1px solid var(--lu-accent);
      background: var(--lu-card);
      color: var(--lu-ink);
      padding: 0 12px;
      box-sizing: border-box;
      margin-bottom: 8px;
    }
    .canvas-scroll {
      overflow: auto;
      border-radius: var(--lu-radius-tile);
      background: #050607;
    }
    .canvas-wrap {
      aspect-ratio: 2 / 1;
      min-width: 100%;
    }
    .palette {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 10px;
      flex-wrap: wrap;
    }
    .swatch {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      border: 2px solid var(--lu-edge);
      cursor: pointer;
      padding: 0;
    }
    .color-input {
      width: 40px;
      height: 40px;
      border: none;
      border-radius: 50%;
      overflow: hidden;
      padding: 0;
      background: none;
      cursor: pointer;
    }
    @media (prefers-reduced-motion: reduce) {
      * {
        transition: none !important;
      }
    }
  `,
  ];
}

customElements.define("iledclock-pixel-editor", IledclockPixelEditor);

declare global {
  interface HTMLElementTagNameMap {
    "iledclock-pixel-editor": IledclockPixelEditor;
  }
}
