import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { createRef, ref } from "lit/directives/ref.js";
import type { HomeAssistant } from "../types.ts";
import type { StudioRoute } from "../lib/route.ts";
import { navigateStudioRoute } from "../lib/route.ts";
import { SignedMediaCache, gallerySourcesRequest, type GallerySource } from "../lib/gallery-api.ts";
import {
  beginLoadMore,
  applyFilters,
  failLoadMore,
  filterItemsByTitle,
  initialBrowseState,
  itemKey,
  mergePage,
  resolveSort,
  tileMetaLine,
  type BrowseFilters,
  type BrowseState,
} from "../lib/gallery-browse-state.ts";
import {
  exploreSearchRequest,
  exploreSourceLabel,
  fallbackExploreItem,
  exploreTileAspect,
  fitsClockExactly,
  orderedExploreSources,
  type ExploreGalleryItem,
  type ExploreSearchResult,
  type ExploreSource,
} from "../lib/gallery-explore-api.ts";
import {
  beginShelfLoad,
  initialShelfLoadStates,
  rejectShelfLoad,
  resolveShelfLoad,
  type GalleryShelfDescriptor,
  type ShelfLoadStates,
} from "../lib/gallery-shelf-state.ts";
import { parseGalleryItemRoute, serializeGalleryItemRoute } from "../lib/gallery-item-route.ts";
import { GalleryImportCache } from "../lib/gallery-import-cache.ts";
import { describeWsError } from "../lib/ws-query.ts";
import { TOKENS_CSS } from "../styles/tokens.ts";
import "./iledclock-explore-shelf.ts";
import "./iledclock-explore-item-sheet.ts";
import "./iledclock-segmented-picker.ts";
import "./lu-empty.ts";
import "./lu-error.ts";
import "./lu-icon-button.ts";
import "./lu-skeleton.ts";

const FOR_YOU = "for-you";
const SEARCH_DEBOUNCE_MS = 350;
const GRID_SKELETON_COUNT = 12;
const INTEGRATION_OPTIONS_PATH = "/config/integrations/integration/iledclock";

function emptyFilters(): BrowseFilters {
  return { source: "", sort: "", query: "", size: undefined, animatedOnly: false, category: undefined };
}


export class IledclockExploreBrowser extends LitElement {
  static properties = {
    hass: { attribute: false },
    entryId: { attribute: false },
    route: { attribute: false },
    _sources: { state: true },
    _sourcesLoading: { state: true },
    _sourcesError: { state: true },
    _viewSourceId: { state: true },
    _searchInput: { state: true },
    _activeQuery: { state: true },
    _browse: { state: true },
    _catalogShelves: { state: true },
    _shelves: { state: true },
    _shelfLoads: { state: true },
    _shelfCatalogLoading: { state: true },
    _shelfCatalogError: { state: true },
    _signedPaths: { state: true },
    _selectedItem: { state: true },
    _selectedItems: { state: true },
    _sheetOpen: { state: true },
  };

  declare hass: HomeAssistant;
  declare entryId: string | undefined;
  declare route: StudioRoute;
  declare _sources: ExploreSource[];
  declare _sourcesLoading: boolean;
  declare _sourcesError: string | null;
  declare _viewSourceId: string;
  declare _searchInput: string;
  declare _activeQuery: string;
  declare _browse: BrowseState;
  declare _catalogShelves: GalleryShelfDescriptor[];
  declare _shelves: GalleryShelfDescriptor[];
  declare _shelfLoads: ShelfLoadStates;
  declare _shelfCatalogLoading: boolean;
  declare _shelfCatalogError: string | null;
  declare _signedPaths: Record<string, string>;
  declare _selectedItem: ExploreGalleryItem | null;
  declare _selectedItems: readonly ExploreGalleryItem[];
  declare _sheetOpen: boolean;

  private readonly _signedCache = new SignedMediaCache();
  private readonly _importCache = new GalleryImportCache();
  private readonly _sentinelRef = createRef<HTMLDivElement>();
  private _sentinelObserver: IntersectionObserver | null = null;
  private _observedSentinel: Element | undefined;
  private _loadedEntryId: string | undefined;
  private _sourceRequestId = 0;
  private _shelfCatalogRequestId = 0;
  private _shelfGeneration = 0;
  private _browseRequestGeneration = 0;
  private _searchDebounce: ReturnType<typeof setTimeout> | undefined;
  private _selectedRouteToken: string | null = null;
  private _routeOpenedBySelection = false;

  constructor() {
    super();
    this._sources = [];
    this._sourcesLoading = false;
    this._sourcesError = null;
    this._viewSourceId = FOR_YOU;
    this._searchInput = "";
    this._activeQuery = "";
    this._browse = initialBrowseState(emptyFilters());
    this._catalogShelves = [];
    this._shelves = [];
    this._shelfLoads = {};
    this._shelfCatalogLoading = false;
    this._shelfCatalogError = null;
    this._signedPaths = {};
    this._selectedItem = null;
    this._selectedItems = [];
    this._sheetOpen = false;
  }

  connectedCallback(): void {
    super.connectedCallback();
    this._sentinelObserver = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) void this._loadMore();
    }, { rootMargin: "360px" });
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this._sentinelObserver?.disconnect();
    clearTimeout(this._searchDebounce);
    this._sourceRequestId++;
    this._shelfCatalogRequestId++;
    this._shelfGeneration++;
    this._browseRequestGeneration++;
  }

  protected willUpdate(changed: PropertyValues): void {
    if (!changed.has("hass") && !changed.has("entryId")) return;
    if (this.entryId === this._loadedEntryId) return;
    this._loadedEntryId = this.entryId;
    this._sourceRequestId++;
    this._shelfCatalogRequestId++;
    this._shelfGeneration++;
    this._browseRequestGeneration++;
    this._signedCache.clear();
    this._importCache.clear();
    this._signedPaths = {};
    this._sources = [];
    this._sourcesError = null;
    this._viewSourceId = FOR_YOU;
    this._searchInput = "";
    this._activeQuery = "";
    this._browse = initialBrowseState(emptyFilters());
    this._catalogShelves = [];
    this._shelves = [];
    this._shelfLoads = {};
    this._shelfCatalogError = null;
    this._selectedItem = null;
    this._selectedItems = [];
    this._selectedRouteToken = null;
    this._sheetOpen = false;
    if (this.entryId && this.hass) void this._loadSources(this.entryId);
  }

  protected updated(changed: PropertyValues): void {
    if (changed.has("route") || changed.has("_sources") || changed.has("_browse") || changed.has("_shelves")) this._syncRouteItem();
    const sentinel = this._viewSourceId !== FOR_YOU && this._browse.hasMore && !this._browse.error ? this._sentinelRef.value : undefined;
    if (sentinel !== this._observedSentinel) {
      this._sentinelObserver?.disconnect();
      if (sentinel) this._sentinelObserver?.observe(sentinel);
      this._observedSentinel = sentinel;
    }
  }

  private async _loadSources(entryId: string): Promise<void> {
    if (!this.hass.callWS) {
      this._sourcesError = "Home Assistant’s gallery connection is unavailable.";
      this._sourcesLoading = false;
      return;
    }
    const requestId = ++this._sourceRequestId;
    this._sourcesLoading = true;
    this._sourcesError = null;
    try {
      const sources = await this.hass.callWS<GallerySource[]>(gallerySourcesRequest(entryId));
      if (requestId !== this._sourceRequestId || entryId !== this.entryId) return;
      this._sources = sources as ExploreSource[];
      this._sourcesError = null;
      if (this._activeQuery) this._loadQueryShelves(this._activeQuery);
      else void this._loadShelfCatalog(entryId);
    } catch (error) {
      if (requestId === this._sourceRequestId && entryId === this.entryId) this._sourcesError = describeWsError(error);
    } finally {
      if (requestId === this._sourceRequestId) this._sourcesLoading = false;
    }
  }

  private async _loadShelfCatalog(entryId = this.entryId): Promise<void> {
    if (!entryId || !this.hass.callWS) return;
    const requestId = ++this._shelfCatalogRequestId;
    this._shelfCatalogLoading = true;
    this._shelfCatalogError = null;
    try {
      const shelves = await this.hass.callWS<GalleryShelfDescriptor[]>({ type: "iledclock/gallery/shelves", entry_id: entryId });
      if (requestId !== this._shelfCatalogRequestId || entryId !== this.entryId || this._activeQuery) return;
      this._catalogShelves = shelves;
      this._shelfCatalogLoading = false;
      this._installShelves(shelves, "");
    } catch (error) {
      if (requestId === this._shelfCatalogRequestId && entryId === this.entryId) this._shelfCatalogError = describeWsError(error);
    } finally {
      if (requestId === this._shelfCatalogRequestId) this._shelfCatalogLoading = false;
    }
  }

  private _loadQueryShelves(query: string): void {
    this._shelfCatalogRequestId++;
    this._shelfCatalogLoading = false;
    this._shelfCatalogError = null;
    const shelves: GalleryShelfDescriptor[] = orderedExploreSources(this._sources).map((source) => ({
      id: `search:${source.id}`,
      title: `${exploreSourceLabel(source)} results`,
      source: source.id,
      sort: source.default_sort,
    }));
    this._installShelves(shelves, query);
  }

  private _installShelves(shelves: readonly GalleryShelfDescriptor[], query: string): void {
    this._shelfGeneration++;
    this._shelves = shelves.slice();
    this._shelfLoads = initialShelfLoadStates(shelves);
    const generation = this._shelfGeneration;
    for (const shelf of shelves) void this._loadShelf(shelf, query, generation);
  }

  private async _loadShelf(shelf: GalleryShelfDescriptor, query: string, generation = this._shelfGeneration): Promise<void> {
    if (!this.entryId || !this.hass.callWS) return;
    const started = beginShelfLoad(this._shelfLoads, shelf.id);
    if (!started) return;
    this._shelfLoads = started.states;
    const entryId = this.entryId;
    const source = this._sources.find((candidate) => candidate.id === shelf.source);
    const requestQuery = query && source?.supports_search ? query : undefined;
    const request = exploreSearchRequest(entryId, {
      source: shelf.source,
      sort: shelf.sort ?? source?.default_sort ?? "featured",
      page: 0,
      query: requestQuery,
      category: shelf.category,
    });
    try {
      const result = await this.hass.callWS<ExploreSearchResult>(request);
      if (generation !== this._shelfGeneration || entryId !== this.entryId) return;
      const items = query && !source?.supports_search ? filterItemsByTitle(result.items, query) as ExploreGalleryItem[] : result.items;
      const next = resolveShelfLoad(this._shelfLoads, shelf.id, started.requestId, items);
      if (next === this._shelfLoads) return;
      this._shelfLoads = next;
      void this._signItems(items);
    } catch (error) {
      if (generation !== this._shelfGeneration || entryId !== this.entryId) return;
      this._shelfLoads = rejectShelfLoad(this._shelfLoads, shelf.id, started.requestId, describeWsError(error));
    }
  }

  private async _signItems(items: readonly ExploreGalleryItem[]): Promise<void> {
    const entryId = this.entryId;
    if (!entryId) return;
    const pending = items.filter((item) => !this._signedPaths[itemKey(item)]);
    if (pending.length === 0) return;
    const signatures = await Promise.all(pending.map(async (item) => [itemKey(item), await this._signedCache.sign(this.hass, item.media_path)] as const));
    if (entryId !== this.entryId) return;
    this._signedPaths = { ...this._signedPaths, ...Object.fromEntries(signatures) };
  }

  private async _onMediaRetry(event: CustomEvent<{ itemId: string; mediaPath: string }>): Promise<void> {
    const { itemId, mediaPath } = event.detail;
    if (!this.entryId || !mediaPath) return;
    const entryId = this.entryId;
    const signedUrl = await this._signedCache.signFresh(this.hass, mediaPath);
    if (entryId !== this.entryId) return;
    this._signedPaths = { ...this._signedPaths, [itemId]: signedUrl };
  }

  private _activeSource(): ExploreSource | undefined {
    return this._sources.find((source) => source.id === this._viewSourceId);
  }

  private _configuredSources(): ExploreSource[] {
    return orderedExploreSources(this._sources);
  }

  private _accountSource(): ExploreSource | undefined {
    return this._sources.find((source) => source.id === "divoom" && !source.configured && source.requires_account);
  }

  private _setSearch(value: string): void {
    this._searchInput = value;
    clearTimeout(this._searchDebounce);
    this._searchDebounce = setTimeout(() => this._commitSearch(), SEARCH_DEBOUNCE_MS);
  }

  private _clearSearch(): void {
    clearTimeout(this._searchDebounce);
    this._searchInput = "";
    this._commitSearch();
  }

  private _commitSearch(): void {
    const query = this._searchInput.trim();
    if (query === this._activeQuery) return;
    this._activeQuery = query;
    if (this._viewSourceId === FOR_YOU) {
      if (query) this._loadQueryShelves(query);
      else if (this._catalogShelves.length > 0) this._installShelves(this._catalogShelves, "");
      else if (this.entryId) void this._loadShelfCatalog(this.entryId);
      return;
    }
    this._applyBrowseFilters({ query });
  }

  private _selectView(sourceId: string): void {
    clearTimeout(this._searchDebounce);
    this._activeQuery = this._searchInput.trim();
    if (sourceId === FOR_YOU) {
      this._viewSourceId = FOR_YOU;
      if (this._activeQuery) this._loadQueryShelves(this._activeQuery);
      else if (this._catalogShelves.length > 0) this._installShelves(this._catalogShelves, "");
      else if (this.entryId) void this._loadShelfCatalog(this.entryId);
      return;
    }
    const source = this._sources.find((candidate) => candidate.id === sourceId);
    if (!source?.configured) return;
    this._viewSourceId = sourceId;
    this._startBrowse({
      source: sourceId,
      sort: source.default_sort,
      query: this._activeQuery,
      size: undefined,
      animatedOnly: false,
      category: undefined,
    });
  }

  private _applyBrowseFilters(patch: Partial<BrowseFilters>): void {
    const next = applyFilters(this._browse, patch);
    if (next === this._browse) return;
    this._browse = next;
    this._browseRequestGeneration++;
    void this._loadMore();
  }

  private _startBrowse(filters: BrowseFilters): void {
    this._browseRequestGeneration++;
    this._browse = initialBrowseState(filters);
    void this._loadMore();
  }

  private async _loadMore(): Promise<void> {
    const started = beginLoadMore(this._browse);
    if (started === this._browse || this._viewSourceId === FOR_YOU) return;
    this._browse = started;
    const source = this._activeSource();
    const filters = started.filters;
    const page = started.page;
    const requestGeneration = this._browseRequestGeneration;
    const entryId = this.entryId;
    if (!entryId || !this.hass.callWS || !source) {
      this._browse = failLoadMore(this._browse, filters, page, "This gallery source isn’t available right now.");
      return;
    }
    const request = exploreSearchRequest(entryId, {
      source: filters.source,
      sort: filters.sort,
      page,
      query: source.supports_search ? filters.query : undefined,
      size: filters.size,
      animatedOnly: filters.animatedOnly,
      category: filters.category,
    });
    try {
      const result = await this.hass.callWS<ExploreSearchResult>(request);
      if (requestGeneration !== this._browseRequestGeneration || entryId !== this.entryId) return;
      const next = mergePage(this._browse, filters, page, result);
      this._browse = next;
      void this._signItems(result.items);
    } catch (error) {
      if (requestGeneration !== this._browseRequestGeneration || entryId !== this.entryId) return;
      this._browse = failLoadMore(this._browse, filters, page, describeWsError(error));
    }
  }

  private _visibleItems(): readonly ExploreGalleryItem[] {
    const items = this._browse.items as readonly ExploreGalleryItem[];
    const source = this._activeSource();
    return source?.supports_search ? items : filterItemsByTitle(items, this._browse.filters.query) as readonly ExploreGalleryItem[];
  }

  private _retryBrowse(): void {
    this._browse = { ...this._browse, error: null };
    void this._loadMore();
  }

  private _openItem(item: ExploreGalleryItem, items: readonly ExploreGalleryItem[]): void {
    this._selectedItem = item;
    this._selectedItems = items;
    this._selectedRouteToken = serializeGalleryItemRoute(item.source, item.id);
    this._routeOpenedBySelection = true;
    this._sheetOpen = true;
    void this._signItems([item]);
    navigateStudioRoute({ destination: "explore", item: this._selectedRouteToken });
  }

  private _openGridItem(event: CustomEvent<{ itemId: string }>): void {
    const item = this._visibleItems().find((candidate) => itemKey(candidate) === event.detail.itemId);
    if (item) this._openItem(item, this._visibleItems());
  }

  private _openShelfItem(event: CustomEvent<{ item: ExploreGalleryItem; items: readonly ExploreGalleryItem[] }>): void {
    this._openItem(event.detail.item, event.detail.items);
  }

  private _openShelf(shelf: GalleryShelfDescriptor): void {
    const source = this._sources.find((candidate) => candidate.id === shelf.source);
    if (!source?.configured) return;
    clearTimeout(this._searchDebounce);
    this._activeQuery = this._searchInput.trim();
    this._viewSourceId = shelf.source;
    this._startBrowse({
      source: shelf.source,
      sort: resolveSort(source.sorts, source.default_sort, shelf.sort ?? source.default_sort),
      query: this._activeQuery,
      size: undefined,
      animatedOnly: false,
      category: shelf.category,
    });
  }

  private _openShelfEvent(event: CustomEvent<{ shelf: GalleryShelfDescriptor }>): void {
    this._openShelf(event.detail.shelf);
  }

  private _retryShelf(event: CustomEvent<{ shelfId: string }>): void {
    const shelf = this._shelves.find((candidate) => candidate.id === event.detail.shelfId);
    if (shelf) void this._loadShelf(shelf, this._activeQuery);
  }

  private _selectSort(sort: string): void {
    this._applyBrowseFilters({ sort });
  }

  private _selectCategory(category: string | undefined): void {
    this._applyBrowseFilters({ category });
  }

  private _toggleAnimated(): void {
    this._applyBrowseFilters({ animatedOnly: !this._browse.filters.animatedOnly });
  }

  private _selectSize(size: string): void {
    this._applyBrowseFilters({ size: size || undefined });
  }

  private _syncRouteItem(): void {
    const parsed = parseGalleryItemRoute(this.route?.item);
    if (!parsed) {
      if (this._selectedRouteToken) {
        this._selectedRouteToken = null;
        this._routeOpenedBySelection = false;
        this._sheetOpen = false;
        this._selectedItem = null;
        this._selectedItems = [];
      }
      return;
    }
    const token = serializeGalleryItemRoute(parsed.source, parsed.id);
    const source = this._sources.find((candidate) => candidate.id === parsed.source);
    if (this._sourcesLoading && !source) return;
    if (token === this._selectedRouteToken && this._sheetOpen) {
      if (!this._routeOpenedBySelection && source?.configured && this._viewSourceId !== source.id) {
        this._viewSourceId = source.id;
        this._browseRequestGeneration++;
        this._browse = initialBrowseState({ source: source.id, sort: source.default_sort, query: this._activeQuery, size: undefined, animatedOnly: false, category: undefined });
        void this._loadMore();
      }
      return;
    }
    this._routeOpenedBySelection = false;
    if (source?.configured && this._viewSourceId !== source.id) {
      this._viewSourceId = source.id;
      this._browseRequestGeneration++;
      this._browse = initialBrowseState({ source: source.id, sort: source.default_sort, query: this._activeQuery, size: undefined, animatedOnly: false, category: undefined });
      void this._loadMore();
    }
    const allItems = [
      ...this._browse.items,
      ...Object.values(this._shelfLoads).flatMap((state) => state.items),
    ] as ExploreGalleryItem[];
    const selected = allItems.find((item) => item.source === parsed.source && item.id === parsed.id)
      ?? fallbackExploreItem(source, parsed.source, parsed.id);
    const sameSourceItems = [...new Map(allItems.filter((item) => item.source === parsed.source).map((item) => [itemKey(item), item])).values()];
    this._selectedItem = selected;
    this._selectedItems = sameSourceItems.length > 0 ? sameSourceItems : [selected];
    this._selectedRouteToken = token;
    this._sheetOpen = true;
    void this._signItems([selected]);
  }

  private _closeItemSheet(): void {
    if (this._routeOpenedBySelection && this.route?.item === this._selectedRouteToken) {
      this._routeOpenedBySelection = false;
      window.history.back();
      return;
    }
    if (this.route?.item) {
      navigateStudioRoute({ ...this.route, destination: "explore", item: undefined }, true);
      return;
    }
    this._sheetOpen = false;
    this._selectedItem = null;
  }

  private _navigateItem(event: CustomEvent<{ delta: -1 | 1 }>): void {
    if (!this._selectedItem) return;
    const index = this._selectedItems.findIndex((item) => itemKey(item) === itemKey(this._selectedItem!));
    const next = this._selectedItems[index + event.detail.delta];
    if (!next) return;
    this._selectedItem = next;
    this._selectedRouteToken = serializeGalleryItemRoute(next.source, next.id);
    void this._signItems([next]);
    navigateStudioRoute({ destination: "explore", item: this._selectedRouteToken }, true);
  }

  private _retrySources(): void {
    if (this.entryId) void this._loadSources(this.entryId);
  }


  private _renderToolbar() {
    const configured = this._configuredSources();
    const divoom = this._accountSource();
    const accountOptionsPath = this.entryId
      ? `${INTEGRATION_OPTIONS_PATH}?config_entry=${encodeURIComponent(this.entryId)}`
      : INTEGRATION_OPTIONS_PATH;
    return html`<div class="toolbar">
      <div class="search-row">
        <label class="search-box">
          <span class="search-icon" aria-hidden="true">⌕</span>
          <span class="visually-hidden">Search pixel art</span>
          <input type="search" placeholder="Search pixel art" .value=${this._searchInput} @input=${(event: Event) => this._setSearch((event.target as HTMLInputElement).value)} />
        </label>
        ${this._searchInput ? html`<lu-icon-button icon="mdi:close" tooltip="Clear search" aria-label="Clear search" @lu-press=${this._clearSearch}></lu-icon-button>` : nothing}
      </div>
      <nav class="source-pills" aria-label="Gallery sources">
        <button type="button" class="source-pill" aria-pressed=${this._viewSourceId === FOR_YOU} @click=${() => this._selectView(FOR_YOU)}>For you</button>
        ${configured.map((source) => html`<button type="button" class="source-pill" aria-pressed=${this._viewSourceId === source.id} @click=${() => this._selectView(source.id)}>${exploreSourceLabel(source)}</button>`)}
      </nav>
      ${divoom ? html`<a class="account-row" href=${accountOptionsPath}><span class="account-spark" aria-hidden="true">✦</span><span>Add a free Divoom account to browse 700k+ designs</span><span class="account-arrow" aria-hidden="true">›</span></a>` : nothing}
      ${this._sourcesError ? html`<lu-error title="Gallery sources couldn’t load" .message=${this._sourcesError} retry-label="Retry sources" @retry=${this._retrySources}></lu-error>` : nothing}
      ${this._sourcesLoading && this._sources.length === 0 ? html`<p class="loading-hint" role="status">Loading gallery sources…</p>` : nothing}
    </div>`;
  }

  private _renderForYou() {
    if (this._sourcesError && this._sources.length === 0) return nothing;
    if (this._shelfCatalogError && this._shelves.length === 0 && !this._activeQuery) {
      return html`<lu-error title="Your shelves couldn’t load" .message=${this._shelfCatalogError} retry-label="Retry shelves" @retry=${() => void this._loadShelfCatalog()}></lu-error>`;
    }
    if (this._shelfCatalogLoading && this._shelves.length === 0) {
      return html`<div class="shelf-loading" role="status" aria-busy="true"><lu-skeleton variant="line" width="190px" label="Loading recommendations"></lu-skeleton><div class="shelf-placeholder"><lu-skeleton variant="card" label="Loading shelf"></lu-skeleton></div></div>`;
    }
    if (this._shelves.length === 0) {
      return html`<lu-empty title=${this._activeQuery ? "No source results yet" : "No shelves are available"} .message=${this._activeQuery ? "Try a different search or choose a gallery above." : "There are no recommendations to show right now. Choose a source to browse."}></lu-empty>`;
    }
    return html`<div class="shelves">
      ${this._shelves.map((shelf) => {
        const state = this._shelfLoads[shelf.id];
        const source = this._sources.find((candidate) => candidate.id === shelf.source);
        const items = (state?.items ?? []) as readonly ExploreGalleryItem[];
        return html`<iledclock-explore-shelf
          .shelf=${shelf}
          .source=${source}
          .sourceName=${source ? exploreSourceLabel(source) : shelf.source}
          .items=${items}
          .signedPaths=${this._signedPaths}
          .status=${state?.status ?? "idle"}
          .error=${state?.error ?? undefined}
          @explore-item-open=${this._openShelfItem}
          @explore-shelf-open=${this._openShelfEvent}
          @shelf-retry=${this._retryShelf}
          @media-retry-request=${this._onMediaRetry}
        ></iledclock-explore-shelf>`;
      })}
    </div>`;
  }

  private _renderFilters(source: ExploreSource) {
    const categories = source.categories ?? [];
    return html`<div class="filters" aria-label="Filter designs">
      ${categories.length > 0 ? html`<div class="filter-set" role="group" aria-label="Category">
        <button class="filter-pill ${this._browse.filters.category ? "" : "selected"}" type="button" aria-pressed=${!this._browse.filters.category} @click=${() => this._selectCategory(undefined)}>All</button>
        ${categories.map((category) => html`<button class="filter-pill ${this._browse.filters.category === category.id ? "selected" : ""}" type="button" aria-pressed=${this._browse.filters.category === category.id} @click=${() => this._selectCategory(category.id)}>${category.label}</button>`)}
      </div>` : nothing}
      ${source.sorts.length > 0 ? html`<iledclock-segmented-picker group-label="Sort" content-fit .options=${source.sorts.map((sort) => ({ value: sort.id, label: sort.label }))} .value=${this._browse.filters.sort} @option-selected=${(event: CustomEvent<{ value: string }>) => this._selectSort(event.detail.value)}></iledclock-segmented-picker>` : nothing}
      <div class="filter-set options" role="group" aria-label="Additional filters">
        <button class="filter-pill ${this._browse.filters.animatedOnly ? "selected" : ""}" type="button" aria-pressed=${this._browse.filters.animatedOnly} @click=${this._toggleAnimated}>Animated only</button>
        ${source.sizes.length > 1 ? html`<iledclock-segmented-picker group-label="Size" content-fit .options=${[{ value: "", label: "All sizes" }, ...source.sizes.map((size) => ({ value: size, label: size }))]} .value=${this._browse.filters.size ?? ""} @option-selected=${(event: CustomEvent<{ value: string }>) => this._selectSize(event.detail.value)}></iledclock-segmented-picker>` : nothing}
      </div>
    </div>`;
  }

  private _renderTile(item: ExploreGalleryItem) {
    const exact = fitsClockExactly(item);
    const noTitle = !item.title || /^Trending\s+\d+$/i.test(item.title);
    const category = this._activeSource()?.categories?.find((entry) => entry.id === item.category)?.label;
    return html`<iledclock-art-tile
      .itemId=${itemKey(item)}
      .imageUrl=${this._signedPaths[itemKey(item)] ?? ""}
      .mediaPath=${item.media_path}
      .pixelWidth=${item.width}
      .pixelHeight=${item.height}
      .aspect=${exploreTileAspect(item)}
      .animated=${item.animated}
      .title=${noTitle ? "" : item.title}
      .subtitle=${noTitle ? "" : tileMetaLine(item) ?? ""}
      @tile-selected=${this._openGridItem}
    >
      ${noTitle
        ? category ? html`<span slot="badges" class="tile-badge">${category}</span>` : nothing
        : html`${exact ? html`<span slot="badges" class="tile-badge exact">Fits exactly</span>` : nothing}
            ${item.animated ? html`<span slot="badges" class="tile-badge">${item.frames && item.frames > 1 ? `${item.frames} frames` : "Animated"}</span>` : nothing}
            <span slot="badges" class="tile-badge size">${item.width}×${item.height}</span>`}
    </iledclock-art-tile>`;
  }

  private _renderSourceGrid(source: ExploreSource) {
    const items = this._visibleItems();
    return html`<section class="source-view" aria-label=${`${exploreSourceLabel(source)} designs`}>
      ${this._renderFilters(source)}
      <div class="grid" aria-busy=${this._browse.loading}>
        ${items.map((item) => this._renderTile(item))}
        ${this._browse.loading ? Array.from({ length: GRID_SKELETON_COUNT }, () => html`<div class="grid-skeleton"><lu-skeleton variant="card" label="Loading artwork"></lu-skeleton></div>`) : nothing}
      </div>
      ${this._browse.error
        ? html`<lu-error title="This gallery couldn’t load" .message=${this._browse.error} retry-label="Retry results" @retry=${this._retryBrowse}></lu-error>`
        : nothing}
      ${items.length === 0 && !this._browse.loading && !this._browse.error && !this._browse.hasMore
        ? html`<lu-empty title="No designs match your search" .message=${this._browse.filters.query ? "Try another title or clear your search." : "Try another category or sort."}></lu-empty>`
        : items.length === 0 && !this._browse.loading && !this._browse.error
          ? html`<p class="end-of-list" role="status">Looking through more designs…</p>`
          : nothing}
      ${this._browse.hasMore && !this._browse.error
        ? html`<div class="paging"><button class="load-more" type="button" ?disabled=${this._browse.loading} @click=${() => void this._loadMore()}>${this._browse.loading ? "Loading…" : "Load more"}</button><div class="sentinel" ${ref(this._sentinelRef)} aria-hidden="true"></div></div>`
        : items.length > 0 ? html`<p class="end-of-list" role="status">You’ve reached the end of this gallery.</p>` : nothing}
    </section>`;
  }

  render() {
    const source = this._activeSource();
    return html`<div class="explore" @media-retry-request=${this._onMediaRetry}>
      ${this._renderToolbar()}
      ${this._viewSourceId === FOR_YOU ? this._renderForYou() : source ? this._renderSourceGrid(source) : html`<lu-empty title="This source isn’t available" .message=${"Choose a configured gallery source above."}></lu-empty>`}
      <iledclock-explore-item-sheet
        .hass=${this.hass}
        .entryId=${this.entryId}
        .item=${this._selectedItem}
        .source=${this._sources.find((candidate) => candidate.id === this._selectedItem?.source)}
        .imageUrl=${this._selectedItem ? this._signedPaths[itemKey(this._selectedItem)] ?? "" : ""}
        .items=${this._selectedItems}
        .importCache=${this._importCache}
        .open=${this._sheetOpen}
        @close-requested=${this._closeItemSheet}
        @item-navigate=${this._navigateItem}
      ></iledclock-explore-item-sheet>
    </div>`;
  }

  static styles = [TOKENS_CSS, css`
    :host { display: block; min-width: 0; height: 100%; overflow: auto; container-type: inline-size; color: var(--lu-ink); }
    .explore { box-sizing: border-box; width: min(100%, 1200px); min-width: 0; margin: 0 auto; padding: var(--lu-space-4); }
    .toolbar { display: flex; min-width: 0; flex-direction: column; gap: var(--lu-space-3); margin-bottom: var(--lu-space-5); }
    .search-row { display: flex; align-items: center; gap: var(--lu-space-2); }
    .search-box { display: flex; align-items: center; gap: var(--lu-space-2); flex: 1; min-width: 0; min-height: var(--lu-target, 48px); padding: 0 var(--lu-space-3); border: 1px solid var(--lu-edge); border-radius: var(--lu-radius-pill); background: var(--lu-card); box-shadow: var(--lu-highlight-rest, none); }
    .search-icon { color: var(--lu-ink-3); font: 400 24px/1 var(--lu-font); }
    input[type="search"] { width: 100%; min-width: 0; min-height: 44px; border: 0; outline: 0; background: transparent; color: var(--lu-ink); font: 400 var(--lu-type-body)/1.3 var(--lu-font); }
    input[type="search"]::placeholder { color: var(--lu-ink-3); }
    .search-box:focus-within { border-color: var(--lu-focus, var(--lu-accent)); }
    input[type="search"]:focus-visible { outline: 2px solid var(--lu-focus, var(--lu-accent)); outline-offset: 2px; border-radius: var(--lu-radius-control); }
    .source-pills, .filter-set { display: flex; align-items: center; gap: var(--lu-space-2); min-width: 0; overflow-x: auto; padding: 2px 1px; scrollbar-width: thin; }
    .source-pill, .filter-pill { flex: none; min-height: var(--lu-target, 48px); padding: 0 var(--lu-space-3); border: 1px solid var(--lu-edge); border-radius: var(--lu-radius-pill); background: var(--lu-tile); color: var(--lu-ink-2); font: 500 var(--lu-type-label)/1 var(--lu-font); cursor: pointer; white-space: nowrap; }
    .source-pill[aria-pressed="true"], .filter-pill.selected { border-color: transparent; background: var(--lu-accent); color: var(--lu-accent-ink); }
    .source-pill:focus-visible, .filter-pill:focus-visible, .load-more:focus-visible, .account-row:focus-visible, .see-all:focus-visible { outline: 2px solid var(--lu-focus, var(--lu-accent)); outline-offset: 2px; }
    .account-row { display: flex; align-items: center; gap: var(--lu-space-2); min-height: var(--lu-target, 48px); padding: var(--lu-space-2) var(--lu-space-3); border: 1px dashed var(--lu-edge); border-radius: var(--lu-radius-control); color: var(--lu-ink-2); text-decoration: none; font: 400 var(--lu-type-body)/1.35 var(--lu-font); }
    .account-spark, .account-arrow { flex: none; color: var(--lu-ink-3); }
    .account-row span:nth-child(2) { flex: 1; }
    .loading-hint { margin: 0; color: var(--lu-ink-3); font: 400 var(--lu-type-caption)/1.3 var(--lu-font); }
    .shelves { display: flex; flex-direction: column; gap: var(--lu-space-6); }
    .shelf-loading { display: flex; flex-direction: column; gap: var(--lu-space-3); }
    .shelf-placeholder { width: 100%; height: 180px; }
    .filters { display: flex; flex-direction: column; gap: var(--lu-space-2); margin: 0 0 var(--lu-space-4); }
    .options { flex-wrap: wrap; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 120px), 1fr)); gap: var(--lu-space-4) var(--lu-space-3); align-items: start; }
    .grid-skeleton { aspect-ratio: .78; }
    .grid-skeleton lu-skeleton { display: block; height: 100%; }
    .paging { display: flex; flex-direction: column; align-items: center; gap: var(--lu-space-2); padding-top: var(--lu-space-4); }
    .load-more { min-width: 160px; min-height: var(--lu-target, 48px); padding: 0 var(--lu-space-4); border: 1px solid var(--lu-edge); border-radius: var(--lu-radius-pill); background: var(--lu-tile); color: var(--lu-ink); font: 500 var(--lu-type-label)/1 var(--lu-font); cursor: pointer; }
    .load-more:disabled { opacity: .55; cursor: default; }
    .sentinel { width: 1px; height: 1px; }
    .end-of-list { margin: var(--lu-space-4) 0; color: var(--lu-ink-3); text-align: center; font: 400 var(--lu-type-caption)/1.4 var(--lu-font); }
    .visually-hidden { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
    @container (min-width: 720px) { .explore { padding: var(--lu-space-6); } .grid { grid-template-columns: repeat(auto-fill, minmax(min(100%, 148px), 1fr)); } .toolbar { margin-bottom: var(--lu-space-6); } }
    @media (prefers-reduced-motion: reduce) { * { scroll-behavior: auto !important; transition-duration: var(--lu-motion-label, 120ms) !important; } }
  `];
}

customElements.define("iledclock-explore-browser", IledclockExploreBrowser);

declare global { interface HTMLElementTagNameMap { "iledclock-explore-browser": IledclockExploreBrowser; } }
