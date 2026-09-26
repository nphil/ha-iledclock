/** The studio's playlist editor: a reorderable list of up to `maxItems` rows, each a kind +
 * description (via `playlist-item.ts`) + a duration, plus an "Add" control. Controlled -- the
 * parent owns `items` and persists them to the device itself (a separate, hold-gated action).
 */

import { LitElement, css, html, nothing } from "lit";
import { ref } from "lit/directives/ref.js";
import { TOKENS_CSS } from "../styles/tokens.ts";
import type { PlaylistItem, PlaylistItemKind, StoredDesign } from "../types.ts";
import { clampPlaylistDuration } from "../lib/ws-api.ts";
import { createPlaylistItem, describePlaylistItem, playlistItemIcon, playlistKindLabel } from "../lib/playlist-item.ts";
import { dragTargetIndex, moveItem, type AxisRect } from "../lib/drag-reorder.ts";
import { mdiIcon } from "../lib/mdi-icons.ts";

const KINDS: readonly PlaylistItemKind[] = ["clock", "date", "text", "design", "timer", "scoreboard", "temperature", "humidity"];

export class IledclockPlaylistEditor extends LitElement {
  static properties = {
    items: { attribute: false },
    maxItems: { type: Number, attribute: "max-items" },
    designs: { attribute: false },
    disabled: { type: Boolean },
    _addKind: { state: true },
  };

  declare items: PlaylistItem[];
  declare maxItems: number;
  declare designs: StoredDesign[];
  declare disabled: boolean;
  declare _addKind: PlaylistItemKind;

  private _dragOriginalIndex: number | null = null;
  private _dragTarget: number | null = null;
  private _itemRefs = new Map<number, HTMLElement>();

  constructor() {
    super();
    this.items = [];
    this.maxItems = 9;
    this.designs = [];
    this.disabled = false;
    this._addKind = "clock";
  }

  private _emit(items: PlaylistItem[]): void {
    this.dispatchEvent(new CustomEvent("items-changed", { detail: { items }, bubbles: true, composed: true }));
  }

  private _updateDuration(index: number, event: Event): void {
    const duration_s = clampPlaylistDuration(Number((event.target as HTMLInputElement).value));
    const next = this.items.slice();
    next[index] = { ...next[index]!, duration_s };
    this._emit(next);
  }

  private _remove(index: number): void {
    this._emit(this.items.filter((_, i) => i !== index));
  }

  private _addItem(): void {
    if (this.items.length >= this.maxItems) return;
    this._emit([...this.items, createPlaylistItem(this._addKind, this.designs)]);
  }

  private _onPointerDown(index: number, event: PointerEvent): void {
    if (this.disabled) return;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    this._dragOriginalIndex = index;
    this._dragTarget = index;
  }

  private _onPointerMove(event: PointerEvent): void {
    if (this._dragOriginalIndex === null) return;
    const rects: AxisRect[] = [];
    for (let i = 0; i < this.items.length; i++) {
      const el = this._itemRefs.get(i);
      if (el) rects.push(el.getBoundingClientRect());
    }
    const target = dragTargetIndex(rects, "y", event);
    if (target !== this._dragTarget) {
      this._dragTarget = target;
      this.requestUpdate();
    }
  }

  private _onPointerUp(): void {
    if (this._dragOriginalIndex === null) return;
    if (this._dragTarget !== null && this._dragTarget !== this._dragOriginalIndex) {
      this._emit(moveItem(this.items, this._dragOriginalIndex, this._dragTarget));
    }
    this._dragOriginalIndex = null;
    this._dragTarget = null;
  }


  render() {
    const items = this._dragOriginalIndex !== null && this._dragTarget !== null ? moveItem(this.items, this._dragOriginalIndex, this._dragTarget) : this.items;
    return html`
      <div class="header">
        <h2>Playlist</h2>
        <span class="hint">${items.length}/${this.maxItems}</span>
      </div>
      ${items.length === 0 ? html`<p class="hint">Nothing queued -- the clock will just show its clock face.</p>` : nothing}
      <div class="rows">
        ${items.map((item, index) => {
          return html`
            <div
              class="row"
              @pointerdown=${(e: PointerEvent) => this._onPointerDown(index, e)}
              @pointermove=${(e: PointerEvent) => this._onPointerMove(e)}
              @pointerup=${() => this._onPointerUp()}
              @pointercancel=${() => this._onPointerUp()}
              ${ref((el) => (el ? this._itemRefs.set(index, el as HTMLElement) : this._itemRefs.delete(index)))}
            >
              <span class="drag-handle">${mdiIcon("drag")}</span>
              <span class="row-icon">${mdiIcon(playlistItemIcon(item, this.designs))}</span>
              <div class="row-text">
                <span class="row-title">${playlistKindLabel(item.kind)}</span>
                <span class="row-desc">${describePlaylistItem(item, this.designs)}</span>
              </div>
              <input
                class="duration-input"
                type="number"
                min="1"
                max="3600"
                .value=${String(item.duration_s)}
                @change=${(e: Event) => this._updateDuration(index, e)}
              />
              <button type="button" class="icon-btn" ?disabled=${this.disabled} @click=${() => this._remove(index)} aria-label="Remove">${mdiIcon("close")}</button>
            </div>
          `;
        })}
      </div>
      <div class="add-row">
        <select class="kind-select" ?disabled=${this.disabled || items.length >= this.maxItems} @change=${(e: Event) => (this._addKind = (e.target as HTMLSelectElement).value as PlaylistItemKind)}>
          ${KINDS.map((kind) => html`<option value=${kind} ?selected=${kind === this._addKind}>${playlistKindLabel(kind)}</option>`)}
        </select>
        <button type="button" class="add-btn" ?disabled=${this.disabled || items.length >= this.maxItems} @click=${this._addItem}>${mdiIcon("plus")} Add</button>
      </div>
    `;
  }

  static styles = [
    TOKENS_CSS,
    css`
    :host {
      display: block;
      background: var(--lu-tile);
      border-radius: var(--lu-radius-tile);
      padding: 12px;
    }
    .header {
      display: flex;
      align-items: baseline;
      gap: 8px;
      margin-bottom: 8px;
    }
    h2 {
      margin: 0;
      font-size: 16px;
      font-weight: 600;
      color: var(--lu-ink);
    }
    .hint {
      font-size: 13px;
      color: var(--lu-ink-2);
    }
    .rows {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .row {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px;
      border-radius: var(--lu-radius-row);
      background: var(--lu-card);
      touch-action: none;
    }
    .drag-handle {
      color: var(--lu-ink-3);
      flex: none;
    }
    .row-icon {
      color: var(--lu-ink-2);
      flex: none;
    }
    .row-text {
      flex: 1;
      display: flex;
      flex-direction: column;
      min-width: 0;
    }
    .row-title {
      font-size: 13px;
      font-weight: 600;
      color: var(--lu-ink);
    }
    .row-desc {
      font-size: 12px;
      color: var(--lu-ink-2);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .duration-input {
      width: 60px;
      min-height: 36px;
      border-radius: var(--lu-radius-control);
      border: 1px solid var(--lu-edge);
      background: var(--lu-card);
      color: var(--lu-ink);
      text-align: center;
      font-size: 13px;
    }
    .icon-btn {
      width: 36px;
      height: 36px;
      border-radius: 50%;
      border: none;
      background: none;
      color: var(--lu-ink-2);
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex: none;
    }
    .icon-btn:disabled {
      opacity: 0.4;
      cursor: default;
    }
    .add-row {
      display: flex;
      gap: 8px;
      margin-top: 10px;
    }
    .kind-select {
      flex: 1;
      min-height: var(--lu-target, 48px);
      border-radius: var(--lu-radius-control);
      border: 1px solid var(--lu-edge);
      background: var(--lu-card);
      color: var(--lu-ink);
      padding: 0 10px;
    }
    .add-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      min-height: var(--lu-target, 48px);
      border-radius: var(--lu-radius-pill);
      border: none;
      background: var(--lu-accent);
      color: var(--lu-accent-ink);
      cursor: pointer;
      padding: 0 16px;
      font-weight: 600;
    }
    .add-btn:disabled {
      opacity: 0.5;
      cursor: default;
    }
  `,
  ];
}


customElements.define("iledclock-playlist-editor", IledclockPlaylistEditor);

declare global {
  interface HTMLElementTagNameMap {
    "iledclock-playlist-editor": IledclockPlaylistEditor;
  }
}
