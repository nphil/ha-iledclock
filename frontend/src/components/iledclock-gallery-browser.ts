/** Browse popular online pixel-art galleries (LaMetric, AWTRIX Hub, Divoom Cloud): a search field,
 * source pills (configured sources only; a source needing an account gets a quiet prompt row
 * instead of a pill), sort chips and filters driven entirely by whatever the active source's own
 * `iledclock/gallery/sources` entry reports, a responsive grid of square tiles, and infinite
 * scroll. Tapping a tile opens `iledclock-gallery-item-sheet` (owned here, not by the host panel).
 * Grid tiles animate only while visible and never under reduced motion (`gallery-tile-
 * animation.ts`); the browser's OWN chrome motion also respects reduced motion, but the item
 * sheet's adapted preview deliberately does not (see that file's own header comment).
 */

import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { ref } from "lit/directives/ref.js";
import { createRef } from "lit/directives/ref.js";
import type { HomeAssistant } from "../types.ts";
import {
  gallerySearchRequest,
  gallerySourcesRequest,
  SignedMediaCache,
  type GalleryItem,
  type GallerySearchResult,
  type GallerySource,
} from "../lib/gallery-api.ts";
import {
  applyFilters,
  beginLoadMore,
  failLoadMore,
  filterItemsByTitle,
  initialBrowseState,
  itemKey,
  mergePage,
  tileMetaLine,
  type BrowseFilters,
  type BrowseState,
} from "../lib/gallery-browse-state.ts";
import { TILE_SCHEDULE_IDLE, tileScheduleTick, tileShouldAnimate, tileVisibilityChanged, type TileScheduleState } from "../lib/gallery-tile-animation.ts";
import { describeWsError } from "../lib/ws-query.ts";
import { mdiIcon } from "../lib/mdi-icons.ts";
import { prefersReducedMotion, TOKENS_CSS } from "../styles/tokens.ts";
import "./iledclock-segmented-picker.ts";
import "./iledclock-gallery-item-sheet.ts";

const TILE_SETTLE_MS = 200;
const TILE_TICK_INTERVAL_MS = 100;
const SEARCH_DEBOUNCE_MS = 300;
const LOADING_SKELETON_COUNT = 6;
const INTEGRATION_DOMAIN = "iledclock";

function emptyFilters(): BrowseFilters {
  return { source: "", sort: "", query: "", size: undefined, animatedOnly: false };
}

/** Copy for the "needs an account" row. Only Divoom currently needs one; the exact line comes
 * straight from docs/GALLERY.md. A hypothetical future account-gated source falls back to a
 * generic phrase built from its own name rather than guessing marketing copy for it. */
function accountPromptCopy(source: GallerySource): string {
  if (source.id === "divoom") return "Add a free Divoom account to browse 700k+ designs.";
  return `Add a free ${source.name} account to browse its gallery.`;
}

export class IledclockGalleryBrowser extends LitElement {
  static properties = {
    hass: { attribute: false },
    entryId: { attribute: false },
    _sources: { state: true },
    _sourcesLoading: { state: true },
    _sourcesError: { state: true },
    _browse: { state: true },
    _signedPaths: { state: true },
    _selectedItem: { state: true },
    _itemSheetOpen: { state: true },
  };

  declare hass: HomeAssistant;
  declare entryId: string | undefined;
  declare _sources: GallerySource[];
  declare _sourcesLoading: boolean;
  declare _sourcesError: string | null;
  declare _browse: BrowseState;
  declare _signedPaths: Record<string, string>;
  declare _selectedItem: GalleryItem | null;
  declare _itemSheetOpen: boolean;

  private readonly _signedCache = new SignedMediaCache();
  private readonly _tileSchedules = new Map<string, TileScheduleState>();
  private _tileObserver: IntersectionObserver | null = null;
  private _tileTickInterval: ReturnType<typeof setInterval> | null = null;
  private _sentinelObserver: IntersectionObserver | null = null;
  private readonly _sentinelRef = createRef<HTMLDivElement>();
  private _lastObservedSentinel: Element | undefined;
  private _lastEntryId: string | undefined;
  private _searchDebounce: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    super();
    this._sources = [];
    this._sourcesLoading = false;
    this._sourcesError = null;
    this._browse = initialBrowseState(emptyFilters());
    this._signedPaths = {};
    this._selectedItem = null;
    this._itemSheetOpen = false;
  }

  connectedCallback(): void {
    super.connectedCallback();
    this._sentinelObserver = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void this._loadMore();
      },
      { rootMargin: "400px" },
    );
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this._tileObserver?.disconnect();
    this._sentinelObserver?.disconnect();
    if (this._tileTickInterval !== null) clearInterval(this._tileTickInterval);
    clearTimeout(this._searchDebounce);
  }

  protected willUpdate(changed: PropertyValues): void {
    if (!changed.has("hass") && !changed.has("entryId")) return;
    if (!this.hass || !this.entryId) return;
    if (this.entryId !== this._lastEntryId) {
      this._lastEntryId = this.entryId;
      void this._loadSources();
    }
  }

  protected updated(): void {
    const sentinel = this._browse.hasMore && !this._browse.error ? this._sentinelRef.value : undefined;
    if (sentinel !== this._lastObservedSentinel) {
      this._sentinelObserver?.disconnect();
      if (sentinel) this._sentinelObserver?.observe(sentinel);
      this._lastObservedSentinel = sentinel;
    }
  }

  // ---- data loading ----

  private async _loadSources(): Promise<void> {
    if (!this.entryId || !this.hass.callWS) return;
    this._sourcesLoading = true;
    this._sourcesError = null;
    try {
      this._sources = await this.hass.callWS<GallerySource[]>(gallerySourcesRequest(this.entryId));
      const configured = this._sources.filter((source) => source.configured);
      const stillValid = configured.some((source) => source.id === this._browse.filters.source);
      if (configured.length > 0 && !stillValid) {
        this._resetGrid({ source: configured[0]!.id, sort: configured[0]!.default_sort, query: "", size: undefined, animatedOnly: false });
        void this._loadMore();
      }
    } catch (err) {
      this._sourcesError = describeWsError(err);
    } finally {
      this._sourcesLoading = false;
    }
  }

  private _resetGrid(filters: BrowseFilters): void {
    this._browse = initialBrowseState(filters);
    this._tileObserver?.disconnect();
    this._tileObserver = null;
    this._tileSchedules.clear();
  }

  private _applyFilters(patch: Partial<BrowseFilters>): void {
    const next = applyFilters(this._browse, patch);
    if (next === this._browse) return;
    this._resetGrid(next.filters);
    void this._loadMore();
  }

  private async _loadMore(): Promise<void> {
    const started = beginLoadMore(this._browse);
    if (started === this._browse) return;
    this._browse = started;
    const activeSource = this._activeSource();
    const forFilters = started.filters;
    const forPage = started.page;
    if (!this.entryId || !this.hass.callWS) {
      this._browse = failLoadMore(this._browse, forFilters, forPage, "Not connected to Home Assistant.");
      return;
    }
    try {
      const response = await this.hass.callWS<GallerySearchResult>(
        gallerySearchRequest(this.entryId, {
          source: forFilters.source,
          sort: forFilters.sort,
          page: forPage,
          query: activeSource?.supports_search ? forFilters.query : undefined,
          size: forFilters.size,
          animatedOnly: forFilters.animatedOnly,
        }),
      );
      this._browse = mergePage(this._browse, forFilters, forPage, response);
      void this._signItems(response.items);
    } catch (err) {
      this._browse = failLoadMore(this._browse, forFilters, forPage, describeWsError(err));
    }
  }

  private async _signItems(items: readonly GalleryItem[]): Promise<void> {
    const toSign = items.filter((item) => !this._signedPaths[itemKey(item)]);
    if (toSign.length === 0) return;
    const entries = await Promise.all(toSign.map(async (item) => [itemKey(item), await this._signedCache.sign(this.hass, item.media_path)] as const));
    this._signedPaths = { ...this._signedPaths, ...Object.fromEntries(entries) };
  }

  // ---- derived view state ----

  private _activeSource(): GallerySource | undefined {
    return this._sources.find((source) => source.id === this._browse.filters.source);
  }

  private _configuredSources(): GallerySource[] {
    return this._sources.filter((source) => source.configured);
  }

  private _accountPromptSources(): GallerySource[] {
    return this._sources.filter((source) => !source.configured && source.requires_account);
  }

  private _visibleItems(): readonly GalleryItem[] {
    const activeSource = this._activeSource();
    return activeSource?.supports_search ? this._browse.items : filterItemsByTitle(this._browse.items, this._browse.filters.query);
  }

  // ---- interaction ----

  private _onSearchInput(value: string): void {
    const activeSource = this._activeSource();
    if (activeSource?.supports_search) {
      clearTimeout(this._searchDebounce);
      this._searchDebounce = setTimeout(() => this._applyFilters({ query: value }), SEARCH_DEBOUNCE_MS);
      return;
    }
    // No server-side search for this source: filter what's already loaded, no refetch/debounce.
    this._browse = { ...this._browse, filters: { ...this._browse.filters, query: value } };
  }

  private _onSourceSelected(sourceId: string): void {
    const source = this._sources.find((candidate) => candidate.id === sourceId);
    this._applyFilters({ source: sourceId, sort: source?.default_sort ?? "", query: "", size: undefined });
  }

  private _onSortSelected(sortId: string): void {
    this._applyFilters({ sort: sortId });
  }

  private _onSizeSelected(size: string): void {
    this._applyFilters({ size: size.length > 0 ? size : undefined });
  }

  private _toggleAnimatedOnly(): void {
    this._applyFilters({ animatedOnly: !this._browse.filters.animatedOnly });
  }

  private _openIntegrationOptions(): void {
    history.pushState(null, "", `/config/integrations/integration/${INTEGRATION_DOMAIN}`);
    window.dispatchEvent(new CustomEvent("location-changed", { bubbles: true, composed: true }));
  }

  private _openItem(item: GalleryItem): void {
    this._selectedItem = item;
    this._itemSheetOpen = true;
  }

  private _onItemSheetClosed(): void {
    this._itemSheetOpen = false;
  }

  // ---- tile visibility scheduling (animated tiles only; static art relies on native lazy-load) ----

  private _ensureTileObserver(): IntersectionObserver {
    if (!this._tileObserver) {
      this._tileObserver = new IntersectionObserver(
        (entries) => {
          const now = performance.now();
          let changed = false;
          for (const entry of entries) {
            const key = (entry.target as HTMLElement).dataset.tileKey;
            if (!key) continue;
            const previous = this._tileSchedules.get(key) ?? TILE_SCHEDULE_IDLE;
            const next = tileVisibilityChanged(previous, entry.isIntersecting, now);
            if (next !== previous) {
              this._tileSchedules.set(key, next);
              changed = true;
            }
          }
          if (changed) {
            this._ensureTileTicking();
            this.requestUpdate();
          }
        },
        { rootMargin: "150px", threshold: 0.1 },
      );
    }
    return this._tileObserver;
  }

  private _ensureTileTicking(): void {
    if (this._tileTickInterval !== null) return;
    this._tileTickInterval = setInterval(() => {
      const now = performance.now();
      let anyPending = false;
      let changed = false;
      for (const [key, state] of this._tileSchedules) {
        if (state.pending === null) continue;
        anyPending = true;
        const next = tileScheduleTick(state, now, TILE_SETTLE_MS);
        if (next !== state) {
          this._tileSchedules.set(key, next);
          changed = true;
        }
      }
      if (changed) this.requestUpdate();
      if (!anyPending && this._tileTickInterval !== null) {
        clearInterval(this._tileTickInterval);
        this._tileTickInterval = null;
      }
    }, TILE_TICK_INTERVAL_MS);
  }

  private _observeTile(el: Element | undefined, item: GalleryItem): void {
    if (!item.animated || !el) return;
    (el as HTMLElement).dataset.tileKey = itemKey(item);
    this._ensureTileObserver().observe(el);
  }

  // ---- render ----

  render() {
    const activeSource = this._activeSource();
    const configured = this._configuredSources();
    const accountPrompts = this._accountPromptSources();
    return html`
      <div class="toolbar">
        <input
          class="search-input"
          type="search"
          placeholder="Search designs"
          .value=${this._browse.filters.query}
          ?disabled=${!activeSource}
          @input=${(event: Event) => this._onSearchInput((event.target as HTMLInputElement).value)}
        />
        ${this._sourcesLoading ? html`<p class="hint">Loading gallery sources…</p>` : nothing}
        ${this._sourcesError ? html`<p class="error">${this._sourcesError}</p>` : nothing}
        ${configured.length > 0
          ? html`
              <iledclock-segmented-picker
                group-label="Source"
                content-fit
                .options=${configured.map((source) => ({ value: source.id, label: source.name }))}
                .value=${this._browse.filters.source}
                @option-selected=${(event: CustomEvent<{ value: string }>) => this._onSourceSelected(event.detail.value)}
              ></iledclock-segmented-picker>
            `
          : nothing}
        ${accountPrompts.map(
          (source) => html`
            <button type="button" class="account-row" @click=${this._openIntegrationOptions}>
              <span>${accountPromptCopy(source)}</span>
              ${mdiIcon("chevronRight")}
            </button>
          `,
        )}
        ${activeSource ? this._renderSortAndFilters(activeSource) : nothing}
      </div>
      ${!this._sourcesLoading && !activeSource && configured.length === 0 && accountPrompts.length === 0
        ? html`<p class="empty-state">No gallery sources are available right now.</p>`
        : nothing}
      ${activeSource ? this._renderGrid() : nothing}
      <iledclock-gallery-item-sheet
        .hass=${this.hass}
        .entryId=${this.entryId}
        .item=${this._selectedItem}
        .source=${activeSource}
        ?open=${this._itemSheetOpen}
        @close-requested=${this._onItemSheetClosed}
      ></iledclock-gallery-item-sheet>
    `;
  }

  private _renderSortAndFilters(activeSource: GallerySource) {
    return html`
      <iledclock-segmented-picker
        group-label="Sort"
        content-fit
        .options=${activeSource.sorts.map((sort) => ({ value: sort.id, label: sort.label }))}
        .value=${this._browse.filters.sort}
        @option-selected=${(event: CustomEvent<{ value: string }>) => this._onSortSelected(event.detail.value)}
      ></iledclock-segmented-picker>
      <div class="filter-row">
        <button type="button" class="filter-chip ${this._browse.filters.animatedOnly ? "on" : ""}" @click=${() => this._toggleAnimatedOnly()}>
          ${mdiIcon("gif")} Animated only
        </button>
        ${activeSource.sizes.length > 1
          ? html`
              <iledclock-segmented-picker
                group-label="Size"
                content-fit
                .options=${[{ value: "", label: "All sizes" }, ...activeSource.sizes.map((size) => ({ value: size, label: size }))]}
                .value=${this._browse.filters.size ?? ""}
                @option-selected=${(event: CustomEvent<{ value: string }>) => this._onSizeSelected(event.detail.value)}
              ></iledclock-segmented-picker>
            `
          : nothing}
      </div>
    `;
  }

  private _renderGrid() {
    const items = this._visibleItems();
    return html`
      <div class="grid">
        ${items.map((item) => this._renderTile(item))}
        ${this._browse.loading ? Array.from({ length: LOADING_SKELETON_COUNT }, () => html`<div class="tile"><div class="plate"><div class="skeleton"></div></div></div>`) : nothing}
      </div>
      ${!this._browse.loading && items.length === 0 && !this._browse.error ? html`<p class="empty-state">No designs match your search.</p>` : nothing}
      ${this._browse.error
        ? html`
            <div class="error-row">
              <p class="error">${this._browse.error}</p>
              <button type="button" class="retry-button" @click=${() => void this._loadMore()}>Retry</button>
            </div>
          `
        : nothing}
      ${this._browse.hasMore && !this._browse.error ? html`<div class="sentinel" ${ref(this._sentinelRef)}></div>` : nothing}
    `;
  }

  private _renderTile(item: GalleryItem) {
    const key = itemKey(item);
    const schedule = this._tileSchedules.get(key) ?? TILE_SCHEDULE_IDLE;
    const reduced = prefersReducedMotion();
    const signedSrc = this._signedPaths[key];
    const showMedia = Boolean(signedSrc) && (!item.animated || tileShouldAnimate(schedule, item.animated, reduced));
    const meta = tileMetaLine(item);
    return html`
      <button type="button" class="tile" @click=${() => this._openItem(item)} aria-label=${item.title}>
        <div class="plate" ${ref((el?: Element) => this._observeTile(el, item))}>
          ${showMedia
            ? html`<img class="art" src=${signedSrc!} alt="" loading="lazy" decoding="async" />`
            : html`<div class="skeleton ${signedSrc ? "static" : ""}"></div>`}
          ${item.animated && !showMedia && signedSrc ? html`<span class="badge" title="Animated design">${mdiIcon("gif")}</span>` : nothing}
        </div>
        <p class="title">${item.title}</p>
        ${meta ? html`<p class="meta">${meta}</p>` : nothing}
      </button>
    `;
  }

  static styles = [
    TOKENS_CSS,
    css`
    :host {
      display: block;
      height: 100%;
      overflow-y: auto;
      box-sizing: border-box;
      padding: 16px;
      container-type: inline-size;
      color: var(--lu-ink);
    }
    .toolbar {
      display: flex;
      flex-direction: column;
      gap: 10px;
      margin-bottom: 16px;
    }
    .search-input {
      min-height: var(--lu-target, 48px);
      border-radius: var(--lu-radius-pill);
      border: 1px solid var(--lu-edge);
      background: var(--lu-card);
      color: var(--lu-ink);
      padding: 0 16px;
      font-size: 15px;
      box-sizing: border-box;
    }
    .search-input:disabled {
      opacity: 0.5;
    }
    .hint {
      margin: 0;
      font-size: 13px;
      color: var(--lu-ink-2);
    }
    .error {
      margin: 0;
      font-size: 13px;
      color: var(--lu-danger);
    }
    .account-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      min-height: var(--lu-target, 48px);
      border-radius: var(--lu-radius-control);
      border: 1px dashed var(--lu-edge);
      background: none;
      color: var(--lu-ink-2);
      padding: 0 14px;
      font-size: 13px;
      cursor: pointer;
      text-align: left;
    }
    .filter-row {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      align-items: center;
    }
    .filter-chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      min-height: var(--lu-target, 48px);
      padding: 0 16px;
      border-radius: var(--lu-radius-pill);
      border: 1px solid var(--lu-edge);
      background: var(--lu-tile);
      color: var(--lu-ink);
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
    }
    .filter-chip.on {
      background: var(--lu-accent);
      color: var(--lu-accent-ink);
      border-color: transparent;
    }
    iledclock-segmented-picker {
      max-width: 100%;
    }
    .empty-state {
      margin: 24px 0;
      text-align: center;
      font-size: 14px;
      color: var(--lu-ink-2);
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 14px;
    }
    @container (min-width: 480px) {
      .grid { grid-template-columns: repeat(3, 1fr); }
    }
    @container (min-width: 700px) {
      .grid { grid-template-columns: repeat(4, 1fr); }
    }
    @container (min-width: 960px) {
      .grid { grid-template-columns: repeat(5, 1fr); }
    }
    .tile {
      display: flex;
      flex-direction: column;
      gap: 6px;
      background: none;
      border: none;
      padding: 0;
      cursor: pointer;
      text-align: left;
      color: inherit;
      font: inherit;
    }
    .plate {
      position: relative;
      aspect-ratio: 1 / 1;
      border-radius: var(--lu-radius-tile);
      overflow: hidden;
      background: #050607;
      border: 1px solid var(--lu-edge);
    }
    .art {
      display: block;
      width: 100%;
      height: 100%;
      object-fit: contain;
      image-rendering: pixelated;
    }
    .skeleton {
      width: 100%;
      height: 100%;
      background: linear-gradient(90deg, #0a0b0c 25%, #16181a 37%, #0a0b0c 63%);
      background-size: 400% 100%;
      animation: gallery-shimmer 1.4s ease infinite;
    }
    .skeleton.static {
      animation: none;
      background: #0a0b0c;
    }
    @keyframes gallery-shimmer {
      0% { background-position: 100% 0; }
      100% { background-position: 0 0; }
    }
    .badge {
      position: absolute;
      right: 6px;
      bottom: 6px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 24px;
      height: 24px;
      border-radius: 50%;
      background: rgba(0, 0, 0, 0.6);
      color: #fff;
    }
    .title {
      margin: 0;
      font-size: 13px;
      font-weight: 600;
      color: var(--lu-ink);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .meta {
      margin: 0;
      font-size: 12px;
      color: var(--lu-ink-2);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .error-row {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
      margin: 16px 0;
    }
    .retry-button {
      min-height: var(--lu-target, 48px);
      padding: 0 16px;
      border-radius: var(--lu-radius-pill);
      border: 1px solid var(--lu-edge);
      background: var(--lu-tile);
      color: var(--lu-ink);
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
    }
    .sentinel {
      height: 1px;
    }
    @media (prefers-reduced-motion: reduce) {
      * {
        transition: none !important;
        animation: none !important;
      }
    }
    `,
  ];
}

customElements.define("iledclock-gallery-browser", IledclockGalleryBrowser);

declare global {
  interface HTMLElementTagNameMap {
    "iledclock-gallery-browser": IledclockGalleryBrowser;
  }
}
