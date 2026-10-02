/** Searchable, filterable Library grid and its route-backed design sheet. */
import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import type { HomeAssistant, PlaybackPreviewResult, StoredDesign } from "../types.ts";
import type { StudioRoute } from "../lib/route.ts";
import { navigateStudioRoute } from "../lib/route.ts";
import type { PixelFrame } from "../lib/grid.ts";
import { designToFrames } from "../lib/design-codec.ts";
import { PlaybackSession, type PlaybackState } from "../lib/playback-session.ts";
import { playbackPreviewRequest } from "../lib/ws-api.ts";
import { designHasClockRegion, filterAndSortDesigns, type LibraryFilter, type LibrarySort } from "../lib/library-state.ts";
import { mdiIcon } from "../lib/mdi-icons.ts";
import { contentClassOf } from "../lib/slots.ts";
import { SURFACES_CSS, TOKENS_CSS } from "../styles/tokens.ts";
import "./iledclock-art-tile.ts";
import "./iledclock-hold-button.ts";
import "./iledclock-led-preview.ts";
import "./iledclock-playback-control.ts";
import "./iledclock-slot-choice.ts";
import "./lu-empty.ts";
import "./lu-error.ts";
import "./lu-skeleton.ts";
import "./lu-pill-button.ts";
import "./lu-sheet.ts";

const FILTERS: ReadonlyArray<{ value: LibraryFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "animated", label: "Animated" },
  { value: "still", label: "Still" },
  { value: "with-clock", label: "With clock" },
  { value: "from-explore", label: "From Explore" },
];

interface CachedDesignPreview { source: StoredDesign["frames"]; delays: number[]; frames: PixelFrame[]; }
const FRAME_CACHE = new Map<string, CachedDesignPreview>();

/** Decoded frames for a design. Keyed on the stored frame list itself, so a playback change (which
 * only touches speed/smooth/updated) keeps the decoded frames and never restarts the tiles. */
function previewFor(design: StoredDesign): CachedDesignPreview {
  const cached = FRAME_CACHE.get(design.id);
  if (cached && cached.source === design.frames) return cached;
  const preview = { source: design.frames, frames: designToFrames(design), delays: design.delays };
  FRAME_CACHE.set(design.id, preview);
  return preview;
}

function storedPlayback(design: StoredDesign): PlaybackState {
  return { speed: design.speed ?? null, smooth: design.smooth ?? null };
}

export class IledclockLibraryPanel extends LitElement {
  static properties = {
    hass: { attribute: false },
    entryId: { attribute: false },
    designs: { attribute: false },
    loading: { type: Boolean },
    error: { type: String },
    disabled: { type: Boolean },
    route: { attribute: false },
    _query: { state: true },
    _filter: { state: true },
    _sort: { state: true },
    _selectMode: { state: true },
    _selectedIds: { state: true },
    _renameValue: { state: true },
  };

  declare hass: HomeAssistant | undefined;
  declare entryId: string | undefined;
  declare designs: StoredDesign[];
  declare loading: boolean;
  declare error: string | null;
  declare disabled: boolean;
  declare route: StudioRoute;
  declare _query: string;
  declare _filter: LibraryFilter;
  declare _sort: LibrarySort;
  declare _selectMode: boolean;
  declare _selectedIds: string[];
  declare _renameValue: string;

  private _routeSeen = false;
  private _session: PlaybackSession | null = null;
  private _sessionDesignId: string | null = null;

  constructor() {
    super();
    this.designs = [];
    this.loading = false;
    this.error = null;
    this.disabled = false;
    this.route = { destination: "library" };
    this._query = "";
    this._filter = "all";
    this._sort = "recent";
    this._selectMode = false;
    this._selectedIds = [];
    this._renameValue = "";
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this._disposeSession();
  }

  /** One session per opened design sheet: it follows the design id, not `updated`, so saving a speed
   * (which bumps `updated`) never re-sources the preview or refetches. */
  private _syncSession(): void {
    const design = this.route.destination === "library" && this.route.design ? this._selectedDesign : undefined;
    if (!design) {
      this._disposeSession();
      return;
    }
    if (this._session && this._sessionDesignId === design.id) return;
    this._disposeSession();
    const id = design.id;
    const session = new PlaybackSession({
      callWS: (request) => {
        if (!this.hass?.callWS) return Promise.reject(new Error("Home Assistant connection is unavailable."));
        return this.hass.callWS<PlaybackPreviewResult>(request);
      },
      buildRequest: (state) => playbackPreviewRequest({ designId: id }, state),
      onChange: () => this.requestUpdate(),
    });
    this._session = session;
    this._sessionDesignId = id;
    session.setSource(designToFrames(design), { state: storedPlayback(design) });
    // Reset means Original, not "the value this design was opened with".
    session.setDefaultState({ speed: null, smooth: null });
  }

  private _disposeSession(): void {
    this._session?.dispose();
    this._session = null;
    this._sessionDesignId = null;
  }

  protected willUpdate(changed: PropertyValues): void {
    this._syncSession();
    if (!changed.has("route")) return;
    if (!this._routeSeen) {
      this._routeSeen = true;
      if (this.route.destination === "library" && this.route.design) {
        // Put the plain Library route behind a direct deep link so Back closes its sheet first.
        navigateStudioRoute({ destination: "library" }, true);
        navigateStudioRoute(this.route, false);
      }
    }
    this._renameValue = "";
  }

  private get _visibleDesigns(): StoredDesign[] {
    return filterAndSortDesigns(this.designs, { query: this._query, filter: this._filter, sort: this._sort });
  }

  private get _selectedDesign(): StoredDesign | undefined {
    return this.designs.find((design) => design.id === this.route.design);
  }

  private _dispatch(name: string, detail: Record<string, unknown> = {}): void {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }

  private _onTileSelected = (event: CustomEvent<{ itemId: string }>): void => {
    event.stopPropagation();
    const id = event.detail.itemId;
    if (this._selectMode) {
      this._toggleSelected(id);
      return;
    }
    navigateStudioRoute({ destination: "library", design: id });
  };

  private _toggleSelected(id: string): void {
    this._selectedIds = this._selectedIds.includes(id)
      ? this._selectedIds.filter((selected) => selected !== id)
      : [...this._selectedIds, id];
  }

  private _toggleSelectMode(): void {
    this._selectMode = !this._selectMode;
    if (!this._selectMode) this._selectedIds = [];
  }

  private _setFilter(filter: LibraryFilter): void {
    this._filter = filter;
  }

  private _setSort(sort: LibrarySort): void {
    this._sort = sort;
  }

  private _requestImport(): void {
    this._dispatch("import-requested");
  }

  private _navigate(destination: "create" | "explore"): void {
    navigateStudioRoute({ destination });
  }

  private _closeDesignSheet = (): void => {
    if (this.route.design) window.history.back();
  };

  private _saveRename(design: StoredDesign): void {
    const name = this._renameValue.trim();
    if (!name || name === design.name || this.disabled) return;
    this._dispatch("design-rename-requested", { id: design.id, name });
    this._renameValue = "";
  }

  private _duplicate(id: string): void {
    this._dispatch("design-duplicate-requested", { id });
  }

  private _delete(id: string): void {
    this._dispatch("design-delete-requested", { id });
    this._closeDesignSheet();
  }

  private _onPlaybackCommit(design: StoredDesign, event: CustomEvent<PlaybackState>): void {
    event.stopPropagation();
    const requested: PlaybackState = { speed: event.detail.speed, smooth: event.detail.smooth };
    this._dispatch("design-playback-requested", { id: design.id, ...requested, failed: () => this._revertPlayback(design.id, requested) });
  }

  /** The save failed: put the slider back on what is stored, unless the user has already moved on. */
  private _revertPlayback(id: string, requested: PlaybackState): void {
    const session = this._session;
    const stored = this.designs.find((item) => item.id === id);
    if (!session || this._sessionDesignId !== id || !stored) return;
    const now = session.state;
    if (now.speed !== requested.speed || now.smooth !== requested.smooth) return;
    session.setState(storedPlayback(stored), { commit: true });
  }

  private _show(design: StoredDesign): void {
    this._dispatch("design-show-requested", { id: design.id, title: design.name });
  }

  private _edit(design: StoredDesign): void {
    this._dispatch("iledclock-open-design", { design_id: design.id });
  }

  private _addToRotation(ids: string[]): void {
    if (ids.length === 0) return;
    this._dispatch("designs-add-to-rotation", { ids });
    this._selectedIds = [];
    this._selectMode = false;
    this._closeDesignSheet();
  }

  private _deleteSelected(): void {
    if (this._selectedIds.length === 0 || this.disabled) return;
    this._dispatch("designs-delete-requested", { ids: [...this._selectedIds] });
    this._selectedIds = [];
    this._selectMode = false;
  }

  private _renameInput(event: Event): void {
    this._renameValue = (event.currentTarget as HTMLInputElement).value;
  }

  private _onRenameKeydown(event: KeyboardEvent, design: StoredDesign): void {
    if (event.key === "Enter") {
      event.preventDefault();
      this._saveRename(design);
    } else if (event.key === "Escape") {
      this._renameValue = "";
      (event.currentTarget as HTMLInputElement).value = design.name;
      (event.currentTarget as HTMLInputElement).blur();
    }
  }

  render() {
    const visibleDesigns = this._visibleDesigns;
    const selectedDesign = this._selectedDesign;
    const sheetOpen = Boolean(this.route.destination === "library" && this.route.design);
    return html`
      <section class="library" aria-labelledby="library-title">
        <header class="section-heading">
          <div>
            <h2 id="library-title">My designs</h2>
            <p class="subtitle">Saved art for your clock</p>
          </div>
          <div class="heading-actions">
            <lu-pill-button variant="secondary" label="Import file" icon="mdi:upload" @lu-press=${this._requestImport}></lu-pill-button>
            ${this.designs.length > 0 ? html`<lu-pill-button variant=${this._selectMode ? "primary" : "quiet"} .label=${this._selectMode ? "Done selecting" : "Select"} @lu-press=${this._toggleSelectMode}></lu-pill-button>` : nothing}
          </div>
        </header>

        <div class="toolbar">
          <label class="search">
            <span class="sr-only">Search designs</span>
            ${mdiIcon("zoomIn")}
            <input type="search" autocomplete="off" placeholder="Search designs" .value=${this._query} @input=${(event: Event) => (this._query = (event.currentTarget as HTMLInputElement).value)} />
          </label>
          <div class="sort" role="group" aria-label="Sort designs">
            <span class="sort-label">Sort</span>
            ${(["recent", "name"] as const).map((sort) => html`
              <button type="button" class="choice ${this._sort === sort ? "active" : ""}" aria-pressed=${this._sort === sort} @click=${() => this._setSort(sort)}>${sort === "recent" ? "Recent" : "Name"}</button>
            `)}
          </div>
        </div>
        <div class="filters" role="group" aria-label="Filter designs">
          ${FILTERS.map((filter) => html`
            <button type="button" class="choice ${this._filter === filter.value ? "active" : ""}" aria-pressed=${this._filter === filter.value} @click=${() => this._setFilter(filter.value)}>${filter.label}</button>
          `)}
        </div>

        ${this.error ? html`<lu-error .message=${this.error} @retry=${() => this._dispatch("retry-designs")}></lu-error>` : nothing}
        ${this.loading ? html`<div class="loading-grid" role="status" aria-label="Loading designs"><lu-skeleton variant="card" label="Loading design"></lu-skeleton><lu-skeleton variant="card" label="Loading design"></lu-skeleton><lu-skeleton variant="card" label="Loading design"></lu-skeleton></div>` : nothing}
        ${!this.loading && !this.error && this.designs.length === 0 ? html`
          <div class="empty-state">
            <lu-empty title="No designs yet" message="Create a design or bring artwork in from Explore." action-label="Create" icon="mdi:image-plus-outline" @empty-action=${() => this._navigate("create")}></lu-empty>
            <lu-pill-button variant="secondary" label="Explore artwork" icon="mdi:compass-outline" @lu-press=${() => this._navigate("explore")}></lu-pill-button>
          </div>
        ` : nothing}
        ${!this.loading && !this.error && this.designs.length > 0 && visibleDesigns.length === 0 ? html`<lu-empty title="No matching designs" message="Try a different search or filter." action-label="Clear filters" @empty-action=${() => { this._query = ""; this._filter = "all"; }}></lu-empty>` : nothing}
        ${!this.loading && !this.error && visibleDesigns.length > 0 ? html`
          <div class="grid" aria-label="Saved designs">
            ${visibleDesigns.map((design) => this._renderDesignTile(design))}
          </div>
        ` : nothing}

        ${this._selectMode && this._selectedIds.length > 0 ? html`
          <div class="selection-bar" role="group" aria-label="Selected design actions">
            <span class="selection-count" aria-live="polite">${this._selectedIds.length} selected</span>
            <lu-pill-button variant="secondary" label="Add to rotation" icon="mdi:playlist-plus" ?disabled=${this.disabled} @lu-press=${() => this._addToRotation([...this._selectedIds])}></lu-pill-button>
            <iledclock-hold-button label="Hold to delete selected" complete-label="Deleted" danger ?disabled=${this.disabled} @confirmed=${this._deleteSelected}></iledclock-hold-button>
          </div>
        ` : nothing}

        <lu-sheet .open=${sheetOpen} .label=${selectedDesign?.name ?? "Design not found"} @closed=${this._closeDesignSheet}>
          <div slot="header" class="sheet-title">
            <div>
              <h2>${selectedDesign?.name ?? "Design not found"}</h2>
              <p>${selectedDesign ? (selectedDesign.kind === "animation" ? "Animated design" : "Still design") : "This design may have been deleted."}</p>
            </div>
          </div>
          ${selectedDesign ? html`${this._renderDesignSheet(selectedDesign)}${this._renderDesignActions(selectedDesign)}` : html`
            <lu-empty title="Design not found" message="This saved design is no longer available." action-label="Back to Library" @empty-action=${this._closeDesignSheet}></lu-empty>
          `}
        </lu-sheet>
      </section>
    `;
  }

  private _renderDesignTile(design: StoredDesign) {
    const { frames, delays } = previewFor(design);
    const selected = this._selectedIds.includes(design.id);
    const metadata = design as StoredDesign & { origin?: unknown };
    const fromExplore = metadata.origin !== undefined && metadata.origin !== null;
    const details = [`${design.width}×${design.height}`];
    if (design.kind === "animation" && frames.length > 1) details.push(`${frames.length} frames`);
    const badge = design.kind === "animation"
      ? html`<span slot="badges" class="tile-badge play" role="img" aria-label="Animated" title="Animated"><ha-icon .icon=${"mdi:play"} aria-hidden="true" style="--mdc-icon-size:12px"></ha-icon></span>`
      : designHasClockRegion(design)
        ? html`<span slot="badges" class="tile-badge">With clock</span>`
        : fromExplore ? html`<span slot="badges" class="tile-badge">Explore</span>` : nothing;
    return html`
      <article class="design-tile ${selected ? "selected" : ""}">
        <iledclock-art-tile
          item-id=${design.id}
          aspect="design"
          .frames=${frames}
          .delays=${delays}
          ?animated=${design.kind === "animation"}
          .title=${design.name}
          .subtitle=${details.join(" · ")}
          @tile-selected=${this._onTileSelected}
        >${badge}</iledclock-art-tile>
        ${this._selectMode ? html`
          <button type="button" class="select-toggle ${selected ? "selected" : ""}" aria-pressed=${selected} aria-label=${`${selected ? "Deselect" : "Select"} ${design.name}`} @click=${() => this._toggleSelected(design.id)}>
            <span aria-hidden="true">${selected ? mdiIcon("check") : mdiIcon("plus")}</span>
            ${selected ? "Selected" : "Select"}
          </button>
        ` : nothing}
      </article>
    `;
  }

  private _renderDesignSheet(design: StoredDesign) {
    const { frames, delays } = previewFor(design);
    const session = this._session && this._sessionDesignId === design.id && this._session.hasMotion ? this._session : null;
    const canRename = this._renameValue.trim().length > 0 && this._renameValue.trim() !== design.name;
    return html`
      <div class="design-sheet-body">
        <div class="hero">${session
          ? html`<iledclock-led-preview context="hero" .frames=${session.frames} .delays=${session.delays} .rate=${session.rate} ?playing=${session.playing} .label=${design.name}></iledclock-led-preview>`
          : html`<iledclock-led-preview context="hero" .frames=${frames} .delays=${delays} ?playing=${design.kind === "animation"} .label=${design.name}></iledclock-led-preview>`}</div>
        <label class="rename-field">
          <span>Design name</span>
          <input type="text" maxlength="80" autocomplete="off" .value=${this._renameValue || design.name} ?disabled=${this.disabled} @input=${this._renameInput} @keydown=${(event: KeyboardEvent) => this._onRenameKeydown(event, design)} />
        </label>
        <div class="rename-action"><lu-pill-button variant="secondary" label="Save name" ?disabled=${this.disabled || !canRename} @lu-press=${() => this._saveRename(design)}></lu-pill-button></div>
        ${session ? html`<div class="playback"><iledclock-playback-control .session=${session} @playback-commit=${(event: CustomEvent<PlaybackState>) => this._onPlaybackCommit(design, event)}></iledclock-playback-control></div>` : nothing}
      </div>
    `;
  }

  /** Everything the user can do with the design lives in the sheet's footer, so it is always in view while the body scrolls. */
  private _renderDesignActions(design: StoredDesign) {
    return html`
      <div slot="footer" class="design-footer">
        <iledclock-slot-choice .hass=${this.hass} .entryId=${this.entryId} content-class=${contentClassOf(design)} ?disabled=${this.disabled}></iledclock-slot-choice>
        <div class="design-actions">
          <lu-pill-button class="primary-action" variant="primary" label="Show on clock" icon="mdi:television-play" ?disabled=${this.disabled} @lu-press=${() => this._show(design)}></lu-pill-button>
          <lu-pill-button variant="secondary" label="Edit" icon="mdi:draw" ?disabled=${this.disabled} @lu-press=${() => this._edit(design)}></lu-pill-button>
          <lu-pill-button variant="secondary" label="Duplicate" icon="mdi:content-copy" ?disabled=${this.disabled} @lu-press=${() => this._duplicate(design.id)}></lu-pill-button>
          <lu-pill-button variant="secondary" label="Add to rotation" icon="mdi:playlist-plus" ?disabled=${this.disabled} @lu-press=${() => this._addToRotation([design.id])}></lu-pill-button>
        </div>
        <div class="delete-action"><iledclock-hold-button label="Hold to delete design" complete-label="Deleted" danger ?disabled=${this.disabled} @confirmed=${() => this._delete(design.id)}></iledclock-hold-button></div>
      </div>
    `;
  }

  static styles = [TOKENS_CSS, SURFACES_CSS, css`
    :host { display: block; min-width: 0; container-type: inline-size; }
    .library { display: grid; gap: var(--lu-space-4); min-width: 0; }
    .section-heading { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: var(--lu-space-3); }
    h2 { margin: 0; color: var(--lu-ink); font: 600 var(--lu-type-title)/1.25 var(--lu-font); letter-spacing: -.01em; }
    .subtitle { margin: var(--lu-space-1) 0 0; color: var(--lu-ink-2); font: 400 var(--lu-type-caption)/1.4 var(--lu-font); }
    .heading-actions { display: flex; flex-wrap: wrap; gap: var(--lu-space-2); }
    .toolbar { display: flex; min-width: 0; flex-wrap: wrap; align-items: center; gap: var(--lu-space-3); }
    .search { display: flex; align-items: center; gap: var(--lu-space-2); flex: 1 1 14rem; min-width: 0; min-height: var(--lu-target); padding: 0 var(--lu-space-3); border: 1px solid var(--lu-edge); border-radius: var(--lu-radius-pill); background: var(--lu-card); color: var(--lu-ink-2); }
    .search > svg { width: var(--lu-space-5); height: var(--lu-space-5); flex: none; }
    .search input { width: 100%; min-width: 0; min-height: var(--lu-target); border: 0; outline: 0; color: var(--lu-ink); background: transparent; font: 400 var(--lu-type-body)/1.2 var(--lu-font); }
    .search:focus-within { outline: 2px solid var(--lu-accent); outline-offset: 2px; }
    .sort, .filters { display: flex; align-items: center; flex-wrap: wrap; gap: var(--lu-space-1); min-width: 0; }
    .sort-label { padding-inline: var(--lu-space-2); color: var(--lu-ink-3); font: 500 var(--lu-type-caption)/1.2 var(--lu-font); }
    .choice { display: inline-flex; justify-content: center; align-items: center; min-height: var(--lu-target); padding: 0 var(--lu-space-3); border: 1px solid var(--lu-edge); border-radius: var(--lu-radius-pill); color: var(--lu-ink-2); background: transparent; font: 500 var(--lu-type-label)/1.2 var(--lu-font); cursor: pointer; }
    .choice.active { border-color: transparent; color: var(--lu-accent-ink); background: var(--lu-accent); }
    .choice:focus-visible, .select-toggle:focus-visible { outline: 2px solid var(--lu-accent); outline-offset: 2px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 132px), 1fr)); gap: var(--lu-space-3); min-width: 0; }
    .design-tile { position: relative; min-width: 0; padding: var(--lu-space-1); border-radius: var(--lu-radius-tile); border: 1px solid transparent; }
    .design-tile.selected { border-color: var(--lu-accent); background: var(--lu-accent-soft); }
    .select-toggle { display: flex; justify-content: center; align-items: center; gap: var(--lu-space-2); width: 100%; min-height: var(--lu-target); margin-top: var(--lu-space-2); padding: 0 var(--lu-space-2); border: 1px solid var(--lu-edge); border-radius: var(--lu-radius-pill); color: var(--lu-ink-2); background: transparent; font: 500 var(--lu-type-label)/1.2 var(--lu-font); cursor: pointer; }
    .select-toggle.selected { border-color: var(--lu-edge-raised); color: var(--lu-ink); background: var(--lu-glass-raised); }
    .loading-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 132px), 1fr)); gap: var(--lu-space-3); }
    .empty-state { display: grid; justify-items: center; gap: var(--lu-space-3); padding: var(--lu-space-4); border: 1px solid var(--lu-edge); border-radius: var(--lu-radius-card); }
    .selection-bar { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: var(--lu-space-2); padding: var(--lu-space-3); border: 1px solid var(--lu-edge); border-radius: var(--lu-radius-card); }
    .selection-count { margin-inline-end: auto; color: var(--lu-ink-2); font: 500 var(--lu-type-label)/1.3 var(--lu-font); font-variant-numeric: tabular-nums; }
    .sheet-title { min-width: 0; }
    .sheet-title h2 { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .sheet-title p { margin: var(--lu-space-1) 0 0; color: var(--lu-ink-2); font: 400 var(--lu-type-caption)/1.35 var(--lu-font); }
    .design-sheet-body { display: grid; gap: var(--lu-space-3); padding-bottom: var(--lu-space-2); }
    .hero { display: grid; place-items: center; min-width: 0; overflow: hidden; border-radius: var(--lu-radius-tile); }
    .hero iledclock-led-preview { width: 100%; }
    .rename-field { display: grid; gap: var(--lu-space-2); color: var(--lu-ink-2); font: 500 var(--lu-type-label)/1.25 var(--lu-font); }
    .rename-field input { box-sizing: border-box; width: 100%; min-height: var(--lu-target); padding: 0 var(--lu-space-3); border: 1px solid var(--lu-edge); border-radius: var(--lu-radius-control); color: var(--lu-ink); background: var(--lu-card); font: 400 var(--lu-type-body)/1.2 var(--lu-font); }
    .rename-field input:focus-visible { outline: 2px solid var(--lu-accent); outline-offset: 2px; }
    .rename-action { display: flex; justify-content: flex-end; }
    .playback { min-width: 0; }
    .design-footer { display: grid; gap: var(--lu-space-3); min-width: 0; }
    .design-actions { display: flex; flex-wrap: wrap; gap: var(--lu-space-2); }
    .delete-action { display: flex; justify-content: flex-end; }
    .delete-action iledclock-hold-button { width: min(100%, 20rem); }
    .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
    @container (min-width: 720px) { .grid, .loading-grid { grid-template-columns: repeat(auto-fill, minmax(148px, 1fr)); } }
    @container (max-width: 420px) { .heading-actions { width: 100%; } .heading-actions > * { flex: 1 1 auto; } .selection-bar { justify-content: stretch; } .selection-bar > * { flex: 1 1 10rem; } .selection-count { flex-basis: 100%; } .delete-action iledclock-hold-button { width: 100%; } }
  `];
}

customElements.define("iledclock-library-panel", IledclockLibraryPanel);

declare global { interface HTMLElementTagNameMap { "iledclock-library-panel": IledclockLibraryPanel; } }
