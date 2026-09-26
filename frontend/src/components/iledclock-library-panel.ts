/** The studio's design library: a responsive thumbnail grid over saved `StoredDesign`s. Select
 * to load into the editor, rename inline, duplicate, or delete (gated behind a hold-to-confirm,
 * since deleting a design is irreversible).
 */

import { LitElement, css, html, nothing } from "lit";
import { TOKENS_CSS } from "../styles/tokens.ts";
import type { StoredDesign } from "../types.ts";
import { designToFrames } from "../lib/design-codec.ts";
import { mdiIcon } from "../lib/mdi-icons.ts";
import "./iledclock-matrix-canvas.ts";
import "./iledclock-hold-button.ts";

export class IledclockLibraryPanel extends LitElement {
  static properties = {
    designs: { attribute: false },
    loading: { type: Boolean },
    disabled: { type: Boolean },
    _renamingId: { state: true },
  };

  declare designs: StoredDesign[];
  declare loading: boolean;
  declare disabled: boolean;
  declare _renamingId: string | null;

  constructor() {
    super();
    this.designs = [];
    this.loading = false;
    this.disabled = false;
    this._renamingId = null;
  }

  private _select(id: string): void {
    this.dispatchEvent(new CustomEvent("design-selected", { detail: { id }, bubbles: true, composed: true }));
  }

  private _commitRename(design: StoredDesign, event: Event): void {
    const name = (event.target as HTMLInputElement).value.trim();
    this._renamingId = null;
    if (!name || name === design.name) return;
    this.dispatchEvent(new CustomEvent("design-rename-requested", { detail: { id: design.id, name }, bubbles: true, composed: true }));
  }

  private _duplicate(id: string): void {
    this.dispatchEvent(new CustomEvent("design-duplicate-requested", { detail: { id }, bubbles: true, composed: true }));
  }

  private _delete(id: string): void {
    this.dispatchEvent(new CustomEvent("design-delete-requested", { detail: { id }, bubbles: true, composed: true }));
  }

  render() {
    return html`
      <div class="header">
        <h2>Library</h2>
        ${this.loading ? html`<span class="hint">Loading…</span>` : nothing}
      </div>
      ${!this.loading && this.designs.length === 0 ? html`<p class="hint">No saved designs yet. Draw something and save it.</p>` : nothing}
      <div class="grid">
        ${this.designs.map((design) => {
          const frame = designToFrames(design)[0]!;
          const renaming = this._renamingId === design.id;
          return html`
            <div class="tile">
              <button type="button" class="thumb" ?disabled=${this.disabled} @click=${() => this._select(design.id)} aria-label="Open ${design.name}">
                <iledclock-matrix-canvas .frame=${frame}></iledclock-matrix-canvas>
                <span class="kind-badge">${mdiIcon(design.kind === "animation" ? "gif" : "image")}</span>
              </button>
              ${renaming
                ? html`<input class="name-input" .value=${design.name} @blur=${(e: Event) => this._commitRename(design, e)} @keydown=${(e: KeyboardEvent) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} autofocus />`
                : html`<button type="button" class="name" @click=${() => (this._renamingId = design.id)}>${design.name}</button>`}
              <div class="tile-actions">
                <button type="button" class="icon-btn" ?disabled=${this.disabled} @click=${() => this._duplicate(design.id)} aria-label="Duplicate">${mdiIcon("duplicate")}</button>
                <iledclock-hold-button label="Hold to delete" complete-label="Deleted" danger ?disabled=${this.disabled} @confirmed=${() => this._delete(design.id)}></iledclock-hold-button>
              </div>
            </div>
          `;
        })}
      </div>
    `;
  }

  static styles = [
    TOKENS_CSS,
    css`
    :host {
      display: block;
      container-type: inline-size;
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
    .grid {
      display: grid;
      grid-template-columns: 1fr;
      gap: 12px;
    }
    @container (min-width: 420px) {
      .grid {
        grid-template-columns: repeat(2, 1fr);
      }
    }
    @container (min-width: 700px) {
      .grid {
        grid-template-columns: repeat(3, 1fr);
      }
    }
    .tile {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .thumb {
      position: relative;
      display: block;
      width: 100%;
      aspect-ratio: 2 / 1;
      border-radius: var(--lu-radius-control);
      overflow: hidden;
      border: 1px solid var(--lu-edge);
      padding: 0;
      cursor: pointer;
      background: none;
    }
    .kind-badge {
      position: absolute;
      right: 4px;
      bottom: 4px;
      display: inline-flex;
      color: #fff;
      background: rgba(0, 0, 0, 0.55);
      border-radius: 50%;
      width: 22px;
      height: 22px;
      align-items: center;
      justify-content: center;
    }
    .name,
    .name-input {
      font-size: 13px;
      color: var(--lu-ink);
      background: none;
      border: none;
      text-align: left;
      padding: 4px 0;
      cursor: pointer;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .name-input {
      border-bottom: 1px solid var(--lu-accent);
    }
    .tile-actions {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .tile-actions iledclock-hold-button {
      flex: 1;
    }
    .icon-btn {
      width: 36px;
      height: 36px;
      border-radius: 50%;
      border: none;
      background: var(--lu-glass-raised);
      color: var(--lu-ink);
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
  `,
  ];
}

customElements.define("iledclock-library-panel", IledclockLibraryPanel);

declare global {
  interface HTMLElementTagNameMap {
    "iledclock-library-panel": IledclockLibraryPanel;
  }
}
