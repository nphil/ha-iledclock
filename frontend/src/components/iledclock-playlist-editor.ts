/** Ordered, keyboard-accessible editor for the clock's saved rotation list. */
import { LitElement, css, html, nothing } from "lit";
import { ref } from "lit/directives/ref.js";
import type { PlaylistItem, PlaylistItemKind, StoredDesign } from "../types.ts";
import { createPlaylistItem, describePlaylistItem, playlistItemIcon, playlistKindLabel } from "../lib/playlist-item.ts";
import type { PixelFrame } from "../lib/grid.ts";
import { designToFrames } from "../lib/design-codec.ts";
import { dragTargetIndex, type AxisRect } from "../lib/drag-reorder.ts";
import { moveRotationItem, removeRotationItem, updateRotationDuration } from "../lib/library-state.ts";
import { mdiIcon, type MdiIconName } from "../lib/mdi-icons.ts";
import { SURFACES_CSS, TOKENS_CSS } from "../styles/tokens.ts";
import "./iledclock-led-preview.ts";
import "./iledclock-stepper.ts";
import "./lu-empty.ts";

const ROTATION_CHOICES: readonly { kind: PlaylistItemKind; label: string; icon: MdiIconName }[] = [
  { kind: "design", label: "Design from library", icon: "image" },
  { kind: "clock", label: "Clock", icon: "clock" },
  { kind: "date", label: "Date", icon: "clock" },
  { kind: "text", label: "Text", icon: "text" },
  { kind: "timer", label: "Timer", icon: "countdown" },
  { kind: "scoreboard", label: "Live scores", icon: "scoreboard" },
  { kind: "temperature", label: "Temperature", icon: "thermometer" },
  { kind: "humidity", label: "Humidity", icon: "humidity" },
];
const FRAME_CACHE = new WeakMap<StoredDesign, PixelFrame[]>();

function framesFor(design: StoredDesign): PixelFrame[] {
  let frames = FRAME_CACHE.get(design);
  if (!frames) {
    frames = designToFrames(design);
    FRAME_CACHE.set(design, frames);
  }
  return frames;
}

export class IledclockPlaylistEditor extends LitElement {
  static properties = {
    items: { attribute: false },
    maxItems: { type: Number, attribute: "max-items" },
    designs: { attribute: false },
    disabled: { type: Boolean },
    _addMenuOpen: { state: true },
    _designMenuOpen: { state: true },
    _timerMenuOpen: { state: true },
  };

  declare items: PlaylistItem[];
  declare maxItems: number;
  declare designs: StoredDesign[];
  declare disabled: boolean;
  declare _addMenuOpen: boolean;
  declare _designMenuOpen: boolean;
  declare _timerMenuOpen: boolean;

  private _dragOriginalIndex: number | null = null;
  private _dragTarget: number | null = null;
  private _rowRefs = new Map<number, HTMLElement>();

  constructor() {
    super();
    this.items = [];
    this.maxItems = 9;
    this.designs = [];
    this.disabled = false;
    this._addMenuOpen = false;
    this._designMenuOpen = false;
    this._timerMenuOpen = false;
  }

  private _emit(items: PlaylistItem[]): void {
    this.dispatchEvent(new CustomEvent("items-changed", { detail: { items }, bubbles: true, composed: true }));
  }

  private _updateDuration(index: number, event: CustomEvent<{ value: number }>): void {
    this._emit(updateRotationDuration(this.items, index, event.detail.value));
  }

  private _move(index: number, delta: -1 | 1): void {
    if (this.disabled) return;
    this._emit(moveRotationItem(this.items, index, index + delta));
  }

  private _remove(index: number): void {
    if (this.disabled) return;
    this._emit(removeRotationItem(this.items, index));
  }

  private _chooseAdd(kind: PlaylistItemKind): void {
    if (this.disabled || this.items.length >= this.maxItems) return;
    if (kind === "design") {
      if (this.designs.length > 0) {
        this._designMenuOpen = !this._designMenuOpen;
        this._timerMenuOpen = false;
      }
      return;
    }
    if (kind === "timer") {
      this._timerMenuOpen = !this._timerMenuOpen;
      this._designMenuOpen = false;
      return;
    }
    this._addItem(kind);
  }

  private _addItem(kind: PlaylistItemKind, designId?: string, timerMode: "countdown" | "stopwatch" = "countdown"): void {
    if (this.disabled || this.items.length >= this.maxItems) return;
    if (kind === "design" && !this.designs.some((design) => design.id === designId)) return;
    const item = createPlaylistItem(kind, this.designs);
    if (item.kind === "design") item.params = { design_id: designId };
    if (item.kind === "timer") item.params = { mode: timerMode };
    this._emit([...this.items, item]);
    this._addMenuOpen = false;
    this._designMenuOpen = false;
    this._timerMenuOpen = false;
  }

  private _onPointerDown(index: number, event: PointerEvent): void {
    if (this.disabled) return;
    event.preventDefault();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    this._dragOriginalIndex = index;
    this._dragTarget = index;
  }

  private _onPointerMove(event: PointerEvent): void {
    if (this._dragOriginalIndex === null) return;
    const rects: AxisRect[] = [];
    for (let index = 0; index < this.items.length; index++) {
      const row = this._rowRefs.get(index);
      if (row) rects.push(row.getBoundingClientRect());
    }
    const target = dragTargetIndex(rects, "y", event);
    if (target !== this._dragTarget) {
      this._dragTarget = target;
      this.requestUpdate();
    }
  }

  private _onPointerUp(): void {
    if (this._dragOriginalIndex === null) return;
    const from = this._dragOriginalIndex;
    const to = this._dragTarget;
    this._dragOriginalIndex = null;
    this._dragTarget = null;
    if (to !== null && to !== from) this._emit(moveRotationItem(this.items, from, to));
  }

  private _itemDesign(item: PlaylistItem): StoredDesign | undefined {
    if (item.kind !== "design") return undefined;
    return this.designs.find((design) => design.id === item.params.design_id);
  }

  private _renderThumbnail(item: PlaylistItem) {
    const design = this._itemDesign(item);
    if (!design) return html`<div class="thumbnail" aria-hidden="true">${mdiIcon(playlistItemIcon(item, this.designs))}</div>`;
    return html`<div class="thumbnail design-thumbnail"><iledclock-led-preview context="thumb" .frames=${framesFor(design)} .delays=${design.delays} ?playing=${false} .label=${design.name}></iledclock-led-preview></div>`;
  }

  render() {
    const items = this._dragOriginalIndex !== null && this._dragTarget !== null
      ? moveRotationItem(this.items, this._dragOriginalIndex, this._dragTarget)
      : this.items;
    const full = items.length >= this.maxItems;
    return html`
      ${items.length === 0 ? html`<lu-empty title="No rotation yet" message="Add a clock, design, timer, or live reading to choose what the clock shows."></lu-empty>` : html`
        <ol class="rows" aria-label="Rotation order">
          ${items.map((item, index) => {
            const description = describePlaylistItem(item, this.designs);
            return html`<li class="row" ${ref((element) => element ? this._rowRefs.set(index, element as HTMLElement) : this._rowRefs.delete(index))}>
              ${this._renderThumbnail(item)}
              <div class="row-copy"><span class="row-title">${description}</span><span class="row-kind">${playlistKindLabel(item.kind)}</span></div>
              <span class="icon-button drag-handle ${this.disabled ? "disabled" : ""}" aria-hidden="true" @pointerdown=${(event: PointerEvent) => this._onPointerDown(index, event)} @pointermove=${this._onPointerMove} @pointerup=${this._onPointerUp} @pointercancel=${this._onPointerUp} @lostpointercapture=${this._onPointerUp}>${mdiIcon("drag")}</span>
              <div class="row-controls">
                <div class="duration"><span>Duration</span><iledclock-stepper .value=${item.duration_s} min="1" max="3600" step="1" .label=${`Duration for ${description} in seconds`} ?disabled=${this.disabled} @value-selected=${(event: CustomEvent<{ value: number }>) => this._updateDuration(index, event)}></iledclock-stepper><span class="unit">s</span></div>
                <button class="icon-button" type="button" aria-label=${`Move ${description} up`} ?disabled=${this.disabled || index === 0} @click=${() => this._move(index, -1)}>${mdiIcon("chevronUp")}</button>
                <button class="icon-button" type="button" aria-label=${`Move ${description} down`} ?disabled=${this.disabled || index === items.length - 1} @click=${() => this._move(index, 1)}>${mdiIcon("chevronDown")}</button>
                <button class="icon-button remove" type="button" aria-label=${`Remove ${description}`} ?disabled=${this.disabled} @click=${() => this._remove(index)}>${mdiIcon("close")}</button>
              </div>
            </li>`;
          })}
        </ol>
      `}
      <div class="add-panel">
        <div class="add-count" role="status">${items.length} / ${this.maxItems} programs</div>
        <div class="add-controls">
          <button type="button" class="add-button" aria-expanded=${this._addMenuOpen} aria-controls="rotation-add-menu" ?disabled=${this.disabled || full} @click=${() => { this._addMenuOpen = !this._addMenuOpen; this._designMenuOpen = false; this._timerMenuOpen = false; }}>${mdiIcon("plus")} Add to rotation</button>
          ${this._addMenuOpen ? html`<div id="rotation-add-menu" class="add-menu" role="group" aria-label="Choose a program to add">
            ${ROTATION_CHOICES.map((choice) => choice.kind === "design"
              ? html`<button type="button" class="menu-choice" aria-expanded=${this._designMenuOpen} ?disabled=${this.disabled || full || this.designs.length === 0} @click=${() => this._chooseAdd(choice.kind)}>${mdiIcon(choice.icon)}<span>${choice.label}</span><span class="menu-chevron" aria-hidden="true">${this._designMenuOpen ? "‹" : "›"}</span></button>`
              : choice.kind === "timer"
                ? html`<button type="button" class="menu-choice" aria-expanded=${this._timerMenuOpen} ?disabled=${this.disabled || full} @click=${() => this._chooseAdd(choice.kind)}>${mdiIcon(choice.icon)}<span>${choice.label}</span><span class="menu-chevron" aria-hidden="true">${this._timerMenuOpen ? "‹" : "›"}</span></button>`
                : html`<button type="button" class="menu-choice" ?disabled=${this.disabled || full} @click=${() => this._chooseAdd(choice.kind)}>${mdiIcon(choice.icon)}<span>${choice.label}</span></button>`)}
            ${this._designMenuOpen ? html`<div class="design-options" aria-label="Choose a saved design">${this.designs.map((design) => html`<button type="button" class="menu-choice design-choice" ?disabled=${this.disabled || full} @click=${() => this._addItem("design", design.id)}>${mdiIcon(design.kind === "animation" ? "gif" : "image")}<span>${design.name}</span></button>`)}</div>` : nothing}
            ${this._timerMenuOpen ? html`<div class="design-options" role="group" aria-label="Choose timer mode"><button type="button" class="menu-choice" ?disabled=${this.disabled || full} @click=${() => this._addItem("timer", undefined, "countdown")}>${mdiIcon("countdown")}<span>Countdown</span></button><button type="button" class="menu-choice" ?disabled=${this.disabled || full} @click=${() => this._addItem("timer", undefined, "stopwatch")}>${mdiIcon("stopwatch")}<span>Stopwatch</span></button></div>` : nothing}
          </div>` : nothing}
        </div>
        ${full ? html`<p class="limit-hint">This clock can hold ${this.maxItems} programs. Remove one to add another.</p>` : nothing}
      </div>
    `;
  }

  static styles = [TOKENS_CSS, SURFACES_CSS, css`
    :host { display: grid; gap: var(--lu-space-3); min-width: 0; }
    .rows { display: grid; gap: var(--lu-space-2); margin: 0; padding: 0; list-style: none; }
    .row { display: grid; grid-template-columns: 64px minmax(0,1fr) 48px; align-items: center; gap: var(--lu-space-2); min-width: 0; padding: var(--lu-space-2); border-radius: var(--lu-radius-row); border-bottom: 1px solid var(--lu-edge); }
    .thumbnail { display: grid; place-items: center; width: 64px; height: 32px; overflow: hidden; border-radius: var(--lu-radius-control); color: var(--lu-ink-2); background: var(--lu-tile); }
    .thumbnail.design-thumbnail { background: #050607; }
    .design-thumbnail iledclock-led-preview { width: 100%; height: 100%; }
    .row-copy { display: grid; gap: var(--lu-space-1); min-width: 0; }
    .row-title { overflow: hidden; color: var(--lu-ink); font: 500 var(--lu-type-label)/1.3 var(--lu-font); text-overflow: ellipsis; white-space: nowrap; }
    .row-kind { color: var(--lu-ink-3); font: 400 var(--lu-type-caption)/1.2 var(--lu-font); }
    .row-controls { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; grid-column: 1 / -1; gap: var(--lu-space-1); min-width: 0; }
    .duration { display: inline-flex; align-items: center; gap: var(--lu-space-1); margin-inline-end: auto; color: var(--lu-ink-2); font: 500 var(--lu-type-caption)/1.2 var(--lu-font); }
    .duration iledclock-stepper { min-width: 144px; }
    .unit { color: var(--lu-ink-3); font-variant-numeric: tabular-nums; }
    .icon-button { display: inline-grid; place-items: center; flex: none; width: var(--lu-target); height: var(--lu-target); padding: 0; border: 1px solid var(--lu-edge); border-radius: var(--lu-radius-pill); color: var(--lu-ink-2); background: transparent; cursor: pointer; touch-action: none; }
    .icon-button:active:not(:disabled) { background: var(--lu-glass-raised); }
    .icon-button:focus-visible { outline: 2px solid var(--lu-accent); outline-offset: 2px; }
    .icon-button:disabled { opacity: .45; cursor: default; }
    .drag-handle { color: var(--lu-ink-3); cursor: grab; }
    .drag-handle:active { cursor: grabbing; }
    .drag-handle.disabled { opacity: .45; cursor: default; pointer-events: none; }
    .remove { color: var(--lu-ink-2); }
    .add-panel { display: grid; gap: var(--lu-space-2); padding-top: var(--lu-space-2); }
    .add-count { color: var(--lu-ink-3); font: 500 var(--lu-type-caption)/1.2 var(--lu-font); font-variant-numeric: tabular-nums; }
    .add-controls { position: relative; display: flex; flex-wrap: wrap; align-items: flex-start; gap: var(--lu-space-2); }
    .add-button { display: inline-flex; align-items: center; justify-content: center; gap: var(--lu-space-2); min-width: 12rem; min-height: var(--lu-target); padding: 0 var(--lu-space-4); border: 1px solid var(--lu-edge); border-radius: var(--lu-radius-pill); color: var(--lu-ink-2); background: var(--lu-glass); font: 500 var(--lu-type-label)/1.2 var(--lu-font); cursor: pointer; }
    .add-button:focus-visible, .menu-choice:focus-visible { outline: 2px solid var(--lu-accent); outline-offset: 2px; }
    .add-button:disabled, .menu-choice:disabled { opacity: .5; cursor: default; }
    .add-menu { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 12rem), 1fr)); flex: 1 1 100%; gap: var(--lu-space-1); padding: var(--lu-space-2); border: 1px solid var(--lu-edge); border-radius: var(--lu-radius-card); background: var(--lu-glass-raised, var(--lu-card)); }
    .menu-choice { display: flex; align-items: center; gap: var(--lu-space-2); min-width: 0; min-height: var(--lu-target); padding: 0 var(--lu-space-3); border: 1px solid transparent; border-radius: var(--lu-radius-control); color: var(--lu-ink-2); background: transparent; text-align: left; font: 500 var(--lu-type-label)/1.2 var(--lu-font); cursor: pointer; }
    .menu-choice:hover:not(:disabled) { border-color: var(--lu-edge); background: var(--lu-glass); }
    .menu-choice svg { width: 20px; height: 20px; flex: none; color: var(--lu-ink-3); }
    .menu-choice span:nth-child(2) { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .menu-chevron { color: var(--lu-ink-3); font-size: 20px; }
    .design-options { display: grid; grid-column: 1 / -1; gap: var(--lu-space-1); max-height: 12rem; overflow: auto; padding: var(--lu-space-1); border-top: 1px solid var(--lu-edge); }
    .limit-hint { margin: 0; color: var(--lu-ink-3); font: 400 var(--lu-type-caption)/1.4 var(--lu-font); }
    @container (min-width: 760px) { .row { grid-template-columns: 64px minmax(0,1fr) 48px auto; } .row-controls { grid-column: auto; flex-wrap: nowrap; } .duration { margin-inline-end: var(--lu-space-1); } }
    @container (max-width: 360px) { .row { grid-template-columns: 56px minmax(0,1fr) 48px; gap: var(--lu-space-1); padding: var(--lu-space-1); } .thumbnail { width: 56px; } .duration { flex-basis: 100%; } .add-button { flex: 1 1 100%; } }
  `];
}

customElements.define("iledclock-playlist-editor", IledclockPlaylistEditor);

declare global { interface HTMLElementTagNameMap { "iledclock-playlist-editor": IledclockPlaylistEditor; } }
