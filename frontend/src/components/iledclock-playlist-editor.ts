/** Ordered, keyboard-accessible editor for the clock's saved rotation list. */
import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { ref } from "lit/directives/ref.js";
import type { PlaylistItem, PlaylistItemKind, StoredDesign } from "../types.ts";
import { createPlaylistItem, describePlaylistItem, playlistItemIcon, playlistKindLabel } from "../lib/playlist-item.ts";
import type { PixelFrame } from "../lib/grid.ts";
import { designToFrames } from "../lib/design-codec.ts";
import { dragTargetIndex, type AxisRect } from "../lib/drag-reorder.ts";
import { moveRotationItem, removeRotationItem, updateRotationDuration } from "../lib/library-state.ts";
import { mdiIcon } from "../lib/mdi-icons.ts";
import { SURFACES_CSS, TOKENS_CSS } from "../styles/tokens.ts";
import "./iledclock-led-preview.ts";
import "./iledclock-stepper.ts";
import "./lu-empty.ts";

const PLAYLIST_KINDS: readonly PlaylistItemKind[] = ["clock", "date", "text", "design", "timer", "scoreboard", "temperature", "humidity"];
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
    _addKind: { state: true },
    _designId: { state: true },
    _timerMode: { state: true },
  };

  declare items: PlaylistItem[];
  declare maxItems: number;
  declare designs: StoredDesign[];
  declare disabled: boolean;
  declare _addKind: PlaylistItemKind;
  declare _designId: string;
  declare _timerMode: "countdown" | "stopwatch";

  private _dragOriginalIndex: number | null = null;
  private _dragTarget: number | null = null;
  private _rowRefs = new Map<number, HTMLElement>();

  constructor() {
    super();
    this.items = [];
    this.maxItems = 9;
    this.designs = [];
    this.disabled = false;
    this._addKind = "clock";
    this._designId = "";
    this._timerMode = "countdown";
  }

  willUpdate(changed: PropertyValues<this>): void {
    if (!changed.has("designs")) return;
    if (!this.designs.some((design) => design.id === this._designId)) this._designId = this.designs[0]?.id ?? "";
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

  private _addItem(): void {
    if (this.disabled || this.items.length >= this.maxItems) return;
    if (this._addKind === "design" && !this.designs.some((design) => design.id === this._designId)) return;
    const item = createPlaylistItem(this._addKind, this.designs);
    if (item.kind === "design") item.params = { design_id: this._designId };
    if (item.kind === "timer") item.params = { mode: this._timerMode };
    this._emit([...this.items, item]);
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
    return html`<div class="thumbnail design-thumbnail"><iledclock-led-preview context="thumb" .frames=${framesFor(design)} .delays=${design.delays} ?playing=${design.kind === "animation"} .label=${design.name}></iledclock-led-preview></div>`;
  }

  render() {
    const items = this._dragOriginalIndex !== null && this._dragTarget !== null
      ? moveRotationItem(this.items, this._dragOriginalIndex, this._dragTarget)
      : this.items;
    const full = items.length >= this.maxItems;
    const designMissing = this._addKind === "design" && !this.designs.some((design) => design.id === this._designId);
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
          <label class="add-field">Add menu<select aria-label="Choose a program to add" .value=${this._addKind} ?disabled=${this.disabled || full} @change=${(event: Event) => (this._addKind = (event.currentTarget as HTMLSelectElement).value as PlaylistItemKind)}>
            ${PLAYLIST_KINDS.map((kind) => html`<option value=${kind}>${playlistKindLabel(kind)}</option>`)}
          </select></label>
          ${this._addKind === "design" ? html`<label class="add-field">Design<select aria-label="Choose a design" .value=${this._designId} ?disabled=${this.disabled || full || this.designs.length === 0} @change=${(event: Event) => (this._designId = (event.currentTarget as HTMLSelectElement).value)}>
            ${this.designs.length === 0 ? html`<option value="">No designs saved</option>` : this.designs.map((design) => html`<option value=${design.id}>${design.name}</option>`)}
          </select></label>` : nothing}
          ${this._addKind === "timer" ? html`<label class="add-field">Timer mode<select aria-label="Choose timer mode" .value=${this._timerMode} ?disabled=${this.disabled || full} @change=${(event: Event) => (this._timerMode = (event.currentTarget as HTMLSelectElement).value as "countdown" | "stopwatch")}><option value="countdown">Countdown</option><option value="stopwatch">Stopwatch</option></select></label>` : nothing}
          <button type="button" class="add-button" ?disabled=${this.disabled || full || designMissing} @click=${this._addItem}>${mdiIcon("plus")} Add</button>
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
    .add-controls { display: flex; flex-wrap: wrap; align-items: flex-end; gap: var(--lu-space-2); }
    .add-field { display: grid; flex: 1 1 10rem; gap: var(--lu-space-1); min-width: min(100%, 9rem); color: var(--lu-ink-2); font: 500 var(--lu-type-caption)/1.2 var(--lu-font); }
    select { box-sizing: border-box; width: 100%; min-height: var(--lu-target); padding: 0 var(--lu-space-3); border: 1px solid var(--lu-edge); border-radius: var(--lu-radius-control); color: var(--lu-ink); background: var(--lu-card); font: 400 var(--lu-type-label)/1.2 var(--lu-font); }
    select:focus-visible { outline: 2px solid var(--lu-accent); outline-offset: 2px; }
    .add-button { display: inline-flex; align-items: center; justify-content: center; gap: var(--lu-space-2); min-width: 7rem; min-height: var(--lu-target); padding: 0 var(--lu-space-4); border: 1px solid var(--lu-edge-raised); border-radius: var(--lu-radius-pill); color: var(--lu-ink); background: var(--lu-glass-raised); font: 600 var(--lu-type-label)/1.2 var(--lu-font); cursor: pointer; }
    .add-button:focus-visible { outline: 2px solid var(--lu-accent); outline-offset: 2px; }
    .add-button:disabled { opacity: .5; cursor: default; }
    .limit-hint { margin: 0; color: var(--lu-ink-3); font: 400 var(--lu-type-caption)/1.4 var(--lu-font); }
    @container (min-width: 760px) { .row { grid-template-columns: 64px minmax(0,1fr) 48px auto; } .row-controls { grid-column: auto; flex-wrap: nowrap; } .duration { margin-inline-end: var(--lu-space-1); } }
    @container (max-width: 360px) { .row { grid-template-columns: 56px minmax(0,1fr) 48px; gap: var(--lu-space-1); padding: var(--lu-space-1); } .thumbnail { width: 56px; } .duration { flex-basis: 100%; } .add-button { flex: 1 1 100%; } }
  `];
}

customElements.define("iledclock-playlist-editor", IledclockPlaylistEditor);

declare global { interface HTMLElementTagNameMap { "iledclock-playlist-editor": IledclockPlaylistEditor; } }
