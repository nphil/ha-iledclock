import { LitElement, css, html, type PropertyValues } from "lit";
import { ref } from "lit/directives/ref.js";
import { TOKENS_CSS } from "../styles/tokens.ts";
import type { PixelFrame } from "../lib/grid.ts";
import { MAX_FRAME_COUNT, MIN_FRAME_DELAY_MS, clampFrameDelay, deleteFrame, duplicateFrame, insertFrame, reorderFrame, setFrameDelay, totalDurationMs } from "../lib/timeline.ts";
import { frameIndexAtTime } from "../lib/frame-player.ts";
import { dragTargetIndex, type AxisRect } from "../lib/drag-reorder.ts";
import { mdiIcon } from "../lib/mdi-icons.ts";
import "./iledclock-matrix-canvas.ts";
import "./iledclock-hold-button.ts";

function frameHasPixels(frame: PixelFrame): boolean {
  for (const pixel of frame.pixels) if (pixel !== 0) return true;
  return false;
}

function remapIndex(index: number, from: number, to: number): number {
  if (index === from) return to;
  if (from < to && index > from && index <= to) return index - 1;
  if (from > to && index >= to && index < from) return index + 1;
  return index;
}

export class IledclockFrameTimeline extends LitElement {
  static properties = {
    frames: { attribute: false },
    activeIndex: { type: Number, attribute: "active-index" },
    playing: { type: Boolean },
    disabled: { type: Boolean },
    _dragOriginalIndex: { state: true },
    _dragTarget: { state: true },
  };

  declare frames: PixelFrame[];
  declare activeIndex: number;
  declare playing: boolean;
  declare disabled: boolean;
  declare _dragOriginalIndex: number | null;
  declare _dragTarget: number | null;

  private _itemRefs = new Map<number, HTMLElement>();
  private _rafId: number | null = null;
  private _playStartedAt = 0;

  constructor() {
    super();
    this.frames = [];
    this.activeIndex = 0;
    this.playing = false;
    this.disabled = false;
    this._dragOriginalIndex = null;
    this._dragTarget = null;
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this._stopLoop();
  }

  protected updated(changed: PropertyValues): void {
    if (changed.has("playing") || changed.has("frames")) {
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

  private _emitFrames(frames: PixelFrame[], activeIndex: number): void {
    this.dispatchEvent(new CustomEvent("frames-changed", { detail: { frames, activeIndex }, bubbles: true, composed: true }));
  }

  private _select(index: number): void {
    this.dispatchEvent(new CustomEvent("frame-selected", { detail: { index }, bubbles: true, composed: true }));
  }

  private _togglePlay(): void {
    this.dispatchEvent(new CustomEvent("play-toggled", { detail: { playing: !this.playing }, bubbles: true, composed: true }));
  }

  private _onDelayInput(index: number, event: Event): void {
    const candidate = Number((event.target as HTMLInputElement).value);
    const delayMs = clampFrameDelay(Number.isFinite(candidate) ? candidate : this.frames[index]?.durationMs ?? 100);
    const next = setFrameDelay(this.frames, index, delayMs);
    this.dispatchEvent(new CustomEvent("frames-changed", { detail: { frames: next, activeIndex: this.activeIndex }, bubbles: true, composed: true }));
  }

  private _onAdd = (): void => {
    const frames = insertFrame(this.frames, this.frames.length - 1);
    this._emitFrames(frames, Math.min(frames.length - 1, this.frames.length));
  };

  private _onDuplicate(index: number): void {
    const frames = duplicateFrame(this.frames, index);
    this._emitFrames(frames, Math.min(frames.length - 1, index + 1));
  }

  private _onDelete(index: number): void {
    const frames = deleteFrame(this.frames, index);
    this._emitFrames(frames, Math.min(index, frames.length - 1));
  }

  private _move(index: number, delta: number): void {
    const target = Math.max(0, Math.min(this.frames.length - 1, index + delta));
    if (target === index) return;
    this._emitFrames(reorderFrame(this.frames, index, target), remapIndex(this.activeIndex, index, target));
  }

  private _onFrameKeydown(index: number, event: KeyboardEvent): void {
    if (!event.altKey || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
    event.preventDefault();
    this._move(index, event.key === "ArrowLeft" ? -1 : 1);
  }

  private _onDragStart(index: number, event: PointerEvent): void {
    if (this.disabled) return;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    this._dragOriginalIndex = index;
    this._dragTarget = index;
  }

  private _onDragMove(event: PointerEvent): void {
    if (this._dragOriginalIndex === null) return;
    const rects: AxisRect[] = [];
    for (let i = 0; i < this.frames.length; i++) {
      const element = this._itemRefs.get(i);
      if (element) rects.push(element.getBoundingClientRect());
    }
    this._dragTarget = dragTargetIndex(rects, "x", event);
  }

  private _onDragEnd(): void {
    const from = this._dragOriginalIndex;
    const to = this._dragTarget;
    if (from !== null && to !== null && to !== from) this._emitFrames(reorderFrame(this.frames, from, to), remapIndex(this.activeIndex, from, to));
    this._dragOriginalIndex = null;
    this._dragTarget = null;
  }

  render() {
    const frames = this.frames;
    const current = Math.min(Math.max(this.activeIndex, 0), Math.max(frames.length - 1, 0));
    const total = totalDurationMs(frames);
    const fps = total > 0 ? Math.max(1, Math.round(frames.length * 1000 / total)) : 0;
    return html`
      <section class="timeline" aria-label="Animation timeline">
        <div class="toolbar">
          <button type="button" class="control" ?disabled=${this.disabled || frames.length < 2} @click=${this._togglePlay} aria-label=${this.playing ? "Pause animation preview" : "Play animation preview"} aria-pressed=${String(this.playing)}>${mdiIcon(this.playing ? "pause" : "play")}</button>
          <span class="counter" aria-live="polite">${current + 1} / ${frames.length} · max ${MAX_FRAME_COUNT}</span>
          <span class="fps">${fps} fps</span>
        </div>
        <div class="strip" role="list" aria-label="Animation frames">
          ${frames.map((frame, index) => html`
            <article class="frame-item ${index === current ? "active" : ""} ${index === this._dragTarget && this._dragOriginalIndex !== null ? "drop-target" : ""}" role="listitem" tabindex="0" aria-label=${`Frame ${index + 1} of ${frames.length}`} @keydown=${(event: KeyboardEvent) => this._onFrameKeydown(index, event)} ${ref((element) => { if (element) this._itemRefs.set(index, element as HTMLElement); else this._itemRefs.delete(index); })}>
              <button type="button" class="thumb" @click=${() => this._select(index)} aria-label=${`Select frame ${index + 1}`} aria-pressed=${String(index === current)}><iledclock-matrix-canvas .frame=${frame} .bloom=${false}></iledclock-matrix-canvas></button>
              <div class="frame-meta"><span class="frame-label">Frame ${index + 1}</span><label class="delay"><input type="number" min=${MIN_FRAME_DELAY_MS} max="60000" step="10" aria-label=${`Delay for frame ${index + 1} in milliseconds`} .value=${String(frame.durationMs)} @change=${(event: Event) => this._onDelayInput(index, event)}><span>ms</span></label></div>
              <div class="frame-actions">
                <button type="button" class="control drag-handle" ?disabled=${this.disabled} aria-label=${`Drag to reorder frame ${index + 1}`} title="Drag to reorder" @pointerdown=${(event: PointerEvent) => this._onDragStart(index, event)} @pointermove=${this._onDragMove} @pointerup=${this._onDragEnd} @pointercancel=${this._onDragEnd}>↔</button>
                <button type="button" class="control" ?disabled=${this.disabled || frames.length >= MAX_FRAME_COUNT} @click=${() => this._onDuplicate(index)} aria-label=${`Duplicate frame ${index + 1}`}>${mdiIcon("duplicate")}</button>
                <span class="move-actions"><button type="button" class="control" ?disabled=${this.disabled || index === 0} @click=${() => this._move(index, -1)} aria-label=${`Move frame ${index + 1} earlier`}>‹</button><button type="button" class="control" ?disabled=${this.disabled || index === frames.length - 1} @click=${() => this._move(index, 1)} aria-label=${`Move frame ${index + 1} later`}>›</button></span>
                ${frames.length > 1 && frameHasPixels(frame) ? html`<iledclock-hold-button class="delete-hold" label="Hold to delete" complete-label="Deleted" danger ?disabled=${this.disabled} @confirmed=${() => this._onDelete(index)}></iledclock-hold-button>` : html`<button type="button" class="control" ?disabled=${this.disabled || frames.length <= 1} @click=${() => this._onDelete(index)} aria-label=${`Delete empty frame ${index + 1}`}>${mdiIcon("delete")}</button>`}
              </div>
            </article>
          `)}
          <button type="button" class="control add" ?disabled=${this.disabled || frames.length >= MAX_FRAME_COUNT} @click=${this._onAdd} aria-label="Add frame">${mdiIcon("plus")}</button>
        </div>
      </section>
    `;
  }

  static styles = [TOKENS_CSS, css`
    :host { display: block; min-width: 0; }
    .timeline { display: grid; gap: var(--lu-space-2); min-width: 0; }
    .toolbar { display: flex; align-items: center; gap: var(--lu-space-2); min-height: var(--lu-target); }
    .control { display: inline-flex; align-items: center; justify-content: center; flex: none; min-width: var(--lu-target); min-height: var(--lu-target); padding: 0 var(--lu-space-2); border: 1px solid var(--lu-edge); border-radius: var(--lu-radius-control); background: var(--lu-tile); color: var(--lu-ink); cursor: pointer; font: 500 var(--lu-type-label)/1 var(--lu-font); }
    .control:disabled { opacity: .45; cursor: default; }
    .control:active:not(:disabled) { transform: scale(.97); }
    .counter { color: var(--lu-ink); font: 500 var(--lu-type-label)/1.2 var(--lu-font); font-variant-numeric: tabular-nums; }
    .fps { margin-left: auto; color: var(--lu-ink-3); font: 400 var(--lu-type-caption)/1.2 var(--lu-font); font-variant-numeric: tabular-nums; }
    .strip { display: flex; align-items: stretch; gap: var(--lu-space-2); min-width: 0; overflow-x: auto; padding: var(--lu-space-1) var(--lu-space-1) var(--lu-space-2); overscroll-behavior-inline: contain; scrollbar-width: thin; }
    .frame-item { flex: 0 0 168px; display: grid; align-content: start; gap: var(--lu-space-1); min-width: 0; padding: var(--lu-space-1); border: 1px solid transparent; border-radius: var(--lu-radius-tile); background: transparent; outline: none; }
    .frame-item.active { border-color: var(--lu-accent); background: var(--lu-tile); box-shadow: var(--lu-highlight-raised); }
    .frame-item.drop-target { border-color: var(--lu-accent); }
    .frame-item:focus-visible { outline: 2px solid var(--lu-accent); outline-offset: 2px; }
    .thumb { display: block; width: 100%; aspect-ratio: 2 / 1; overflow: hidden; padding: 0; border: 0; border-radius: var(--lu-radius-control); background: #050607; cursor: pointer; }
    .thumb iledclock-matrix-canvas { display: block; width: 100%; height: 100%; }
    .frame-meta { display: flex; align-items: center; justify-content: space-between; gap: var(--lu-space-1); min-height: var(--lu-target); }
    .frame-label { color: var(--lu-ink-2); font: 500 var(--lu-type-caption)/1.2 var(--lu-font); }
    .delay { display: inline-flex; align-items: center; gap: var(--lu-space-1); color: var(--lu-ink-3); font: 400 var(--lu-type-caption)/1 var(--lu-font); font-variant-numeric: tabular-nums; }
    .delay input { width: 5.5rem; min-height: var(--lu-target); box-sizing: border-box; padding: 0 var(--lu-space-1); border: 1px solid var(--lu-edge); border-radius: var(--lu-radius-control); background: var(--lu-card); color: var(--lu-ink); text-align: center; font: 500 var(--lu-type-caption)/1 var(--lu-font); font-variant-numeric: tabular-nums; }
    .frame-actions { display: flex; flex-wrap: wrap; align-items: center; gap: var(--lu-space-1); }
    .drag-handle { touch-action: none; cursor: grab; }
    .move-actions { display: inline-flex; gap: var(--lu-space-1); opacity: 0; transition: opacity var(--lu-motion-label) var(--lu-ease); }
    .frame-item:focus-within .move-actions, .frame-item:hover .move-actions { opacity: 1; }
    .delete-hold { flex: 1 1 100%; min-width: 0; }
    .add { align-self: center; border-style: dashed; background: transparent; }
    button:focus-visible, input:focus-visible { outline: 2px solid var(--lu-accent); outline-offset: 2px; }
    @media (prefers-reduced-motion: reduce) { .move-actions { transition-duration: 0ms; } }
  `];
}

customElements.define("iledclock-frame-timeline", IledclockFrameTimeline);

declare global { interface HTMLElementTagNameMap { "iledclock-frame-timeline": IledclockFrameTimeline; } }
