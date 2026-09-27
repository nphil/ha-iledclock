/** The studio's animation strip: add/duplicate/delete/reorder frames, a per-frame delay, and a
 * loop-preview play/pause. Controlled -- the parent owns `frames`/`activeIndex`/`playing` and
 * this only ever dispatches change-request events, built from `timeline.ts`'s pure ops.
 */

import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { ref } from "lit/directives/ref.js";
import { TOKENS_CSS } from "../styles/tokens.ts";
import type { PixelFrame } from "../lib/grid.ts";
import { MIN_FRAME_DELAY_MS, clampFrameDelay, deleteFrame, duplicateFrame, insertFrame, reorderFrame } from "../lib/timeline.ts";
import { frameIndexAtTime } from "../lib/frame-player.ts";
import { dragTargetIndex, moveItem, type AxisRect } from "../lib/drag-reorder.ts";
import { mdiIcon } from "../lib/mdi-icons.ts";
import "./iledclock-matrix-canvas.ts";

export class IledclockFrameTimeline extends LitElement {
  static properties = {
    frames: { attribute: false },
    activeIndex: { type: Number, attribute: "active-index" },
    playing: { type: Boolean },
    disabled: { type: Boolean },
  };

  declare frames: PixelFrame[];
  declare activeIndex: number;
  declare playing: boolean;
  declare disabled: boolean;

  private _dragOriginalIndex: number | null = null;
  private _dragTarget: number | null = null;
  private _itemRefs = new Map<number, HTMLElement>();
  private _rafId: number | null = null;
  private _playStartedAt = 0;

  constructor() {
    super();
    this.frames = [];
    this.activeIndex = 0;
    this.playing = false;
    this.disabled = false;
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this._stopLoop();
  }

  protected updated(changed: PropertyValues): void {
    if (changed.has("playing")) {
      if (this.playing) this._startLoop();
      else this._stopLoop();
    }
  }

  private _startLoop(): void {
    if (this._rafId !== null) return;
    this._playStartedAt = performance.now();
    const step = () => {
      const index = frameIndexAtTime(this.frames, performance.now() - this._playStartedAt);
      if (index !== this.activeIndex) this.dispatchEvent(new CustomEvent("frame-selected", { detail: { index }, bubbles: true, composed: true }));
      this._rafId = requestAnimationFrame(step);
    };
    this._rafId = requestAnimationFrame(step);
  }

  private _stopLoop(): void {
    if (this._rafId !== null) cancelAnimationFrame(this._rafId);
    this._rafId = null;
  }

  private _emitFrames(frames: PixelFrame[]): void {
    this.dispatchEvent(new CustomEvent("frames-changed", { detail: { frames }, bubbles: true, composed: true }));
  }

  private _select(index: number): void {
    this.dispatchEvent(new CustomEvent("frame-selected", { detail: { index }, bubbles: true, composed: true }));
  }

  private _togglePlay(): void {
    this.dispatchEvent(new CustomEvent("play-toggled", { detail: { playing: !this.playing }, bubbles: true, composed: true }));
  }

  private _onDelayInput(index: number, event: Event): void {
    const delayMs = clampFrameDelay(Number((event.target as HTMLInputElement).value));
    this.dispatchEvent(new CustomEvent("delay-changed", { detail: { index, delayMs }, bubbles: true, composed: true }));
  }

  // ---- pointer-based drag reorder ----

  private _onHandlePointerDown(index: number, event: PointerEvent): void {
    if (this.disabled) return;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    this._dragOriginalIndex = index;
    this._dragTarget = index;
  }

  private _onHandlePointerMove(event: PointerEvent): void {
    if (this._dragOriginalIndex === null) return;
    const rects: AxisRect[] = [];
    for (let i = 0; i < this.frames.length; i++) {
      const el = this._itemRefs.get(i);
      if (el) rects.push(el.getBoundingClientRect());
    }
    const target = dragTargetIndex(rects, "x", event);
    if (target !== this._dragTarget) {
      this._dragTarget = target;
      this.requestUpdate();
    }
  }

  private _onHandlePointerUp(): void {
    if (this._dragOriginalIndex === null) return;
    if (this._dragTarget !== null && this._dragTarget !== this._dragOriginalIndex) {
      this._emitFrames(reorderFrame(this.frames, this._dragOriginalIndex, this._dragTarget));
    }
    this._dragOriginalIndex = null;
    this._dragTarget = null;
  }

  render() {
    const frames = this._dragOriginalIndex !== null && this._dragTarget !== null ? moveItem(this.frames, this._dragOriginalIndex, this._dragTarget) : this.frames;
    return html`
      <div class="toolbar">
        <button type="button" class="icon-btn" ?disabled=${this.disabled} @click=${this._togglePlay} aria-label=${this.playing ? "Pause preview" : "Play preview"}>
          ${mdiIcon(this.playing ? "pause" : "play")}
        </button>
        <span class="hint">${frames.length} frame${frames.length === 1 ? "" : "s"}</span>
      </div>
      <div class="strip">
        ${frames.map(
          (frame, index) => html`
            <div
              class="frame-item ${index === this.activeIndex ? "active" : ""}"
              @pointerdown=${(e: PointerEvent) => this._onHandlePointerDown(index, e)}
              @pointermove=${this._onHandlePointerMove}
              @pointerup=${this._onHandlePointerUp}
              @pointercancel=${this._onHandlePointerUp}
              ${ref((el) => (el ? this._itemRefs.set(index, el as HTMLElement) : this._itemRefs.delete(index)))}
            >
              <button type="button" class="thumb" @click=${() => this._select(index)} aria-label="Frame ${index + 1}">
                <iledclock-matrix-canvas .frame=${frame}></iledclock-matrix-canvas>
              </button>
              <input
                class="delay-input"
                type="number"
                min=${MIN_FRAME_DELAY_MS}
                max="60000"
                step="10"
                .value=${String(frame.durationMs)}
                @change=${(e: Event) => this._onDelayInput(index, e)}
              />
              <div class="row-actions">
                <button type="button" class="icon-btn small" ?disabled=${this.disabled} @click=${() => this._emitFrames(duplicateFrame(this.frames, index))} aria-label="Duplicate frame">${mdiIcon("duplicate")}</button>
                <button type="button" class="icon-btn small" ?disabled=${this.disabled || frames.length <= 1} @click=${() => this._emitFrames(deleteFrame(this.frames, index))} aria-label="Delete frame">${mdiIcon("delete")}</button>
              </div>
            </div>
          `,
        )}
        <button type="button" class="icon-btn add" ?disabled=${this.disabled} @click=${() => this._emitFrames(insertFrame(this.frames, this.frames.length - 1))} aria-label="Add frame">
          ${mdiIcon("plus")}
        </button>
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
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
    }
    .hint {
      font-size: 12px;
      color: var(--lu-ink-2);
    }
    .strip {
      display: flex;
      gap: 8px;
      overflow-x: auto;
      padding: 4px 2px;
    }
    .frame-item {
      flex: none;
      width: 88px;
      display: flex;
      flex-direction: column;
      gap: 4px;
      border-radius: var(--lu-radius-tile);
      padding: 4px;
      border: 1px solid transparent;
      touch-action: none;
      transition: opacity 90ms var(--lu-ease, ease);
    }
    .frame-item.active {
      border-color: var(--lu-accent);
      background: var(--lu-tile);
      box-shadow: var(--lu-highlight-raised), var(--lu-shadow-raised);
    }
    .thumb {
      display: block;
      width: 100%;
      aspect-ratio: 2 / 1;
      border-radius: var(--lu-radius-control);
      overflow: hidden;
      border: none;
      padding: 0;
      cursor: pointer;
      transition: transform 90ms var(--lu-ease, ease);
    }
    .thumb:active {
      transform: scale(0.97);
    }
    .delay-input {
      width: 100%;
      min-height: 32px;
      border-radius: var(--lu-radius-control);
      border: 1px solid var(--lu-edge);
      background: var(--lu-card);
      color: var(--lu-ink);
      text-align: center;
      font-size: 12px;
      box-sizing: border-box;
    }
    .row-actions {
      display: flex;
      gap: 4px;
      justify-content: center;
    }
    .icon-btn {
      width: var(--lu-target, 48px);
      height: var(--lu-target, 48px);
      border-radius: 50%;
      border: none;
      background: var(--lu-tile);
      color: var(--lu-ink);
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex: none;
      transition: transform 90ms var(--lu-ease, ease);
    }
    .icon-btn:active:not(:disabled) {
      transform: scale(0.97);
    }
    .icon-btn.small {
      width: 32px;
      height: 32px;
    }
    .icon-btn:disabled {
      opacity: 0.4;
      cursor: default;
    }
    .icon-btn.add {
      border: 1px dashed var(--lu-edge);
      background: none;
      align-self: center;
    }
  `,
  ];
}


customElements.define("iledclock-frame-timeline", IledclockFrameTimeline);

declare global {
  interface HTMLElementTagNameMap {
    "iledclock-frame-timeline": IledclockFrameTimeline;
  }
}
