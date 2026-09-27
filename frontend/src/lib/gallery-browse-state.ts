/** Pure pagination and filter state for Explore’s source grid. Kept separate from the Lit browser
 * so paging, deduplication, filter changes and stale-response rejection can be verified without
 * a WebSocket or DOM. A response only applies to the exact filters and page currently in flight.
 */

import type { GalleryItem } from "./gallery-api.ts";

export interface BrowseFilters {
  readonly source: string;
  readonly sort: string;
  readonly query: string;
  readonly size: string | undefined;
  readonly animatedOnly: boolean;
  readonly category?: string;
}

export interface BrowseState {
  readonly filters: BrowseFilters;
  readonly items: readonly GalleryItem[];
  readonly page: number;
  readonly hasMore: boolean;
  readonly loading: boolean;
  readonly error: string | null;
}
export function browseFiltersEqual(a: BrowseFilters, b: BrowseFilters): boolean {
  return a.source === b.source && a.sort === b.sort && a.query === b.query && a.size === b.size && a.animatedOnly === b.animatedOnly && a.category === b.category;
}

export function initialBrowseState(filters: BrowseFilters): BrowseState {
  return { filters, items: [], page: 0, hasMore: true, loading: false, error: null };
}

/** Applies a filter change. Any actual change resets the grid to empty/page 0 -- items fetched
 * under the old filters don't belong in the new set, and a subsequent "load more" must ask the
 * server for page 0 of the NEW filters, never page N of the old ones. A patch identical to what's
 * already active (e.g. reselecting the sort that was already selected) is a no-op that keeps the
 * existing grid and its scroll position. */
export function applyFilters(state: BrowseState, patch: Partial<BrowseFilters>): BrowseState {
  const next: BrowseFilters = { ...state.filters, ...patch };
  return browseFiltersEqual(next, state.filters) ? state : initialBrowseState(next);
}

/** Marks a fetch of the next page as in flight. A no-op while already loading or once the source
 * has reported no more pages, so a caller (an IntersectionObserver sentinel callback) can call
 * this unconditionally without its own guard. */
export function beginLoadMore(state: BrowseState): BrowseState {
  if (state.loading || !state.hasMore) return state;
  return { ...state, loading: true, error: null };
}

export function itemKey(item: Pick<GalleryItem, "source" | "id">): string {
  return `${item.source}:${item.id}`;
}

/** Merges one search response into `state`. Dropped unchanged if `forFilters`/`forPage` no longer
 * match what `state` is currently waiting on -- the user changed source/sort/query while the
 * request was in flight, and an older response must never land on top of a newer filter's grid.
 * Items already present (a source repeating a row across a page boundary) are skipped rather than
 * duplicated. */
export function mergePage(
  state: BrowseState,
  forFilters: BrowseFilters,
  forPage: number,
  response: { items: readonly GalleryItem[]; page: number; has_more: boolean },
): BrowseState {
  if (!browseFiltersEqual(forFilters, state.filters) || forPage !== state.page) return state;
  const seen = new Set(state.items.map((item) => itemKey(item)));
  const merged = state.items.slice();
  for (const item of response.items) {
    const key = itemKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }
  return { ...state, items: merged, page: state.page + 1, hasMore: response.has_more, loading: false, error: null };
}

/** Records a failed page fetch, subject to the same stale-response guard as `mergePage`. */
export function failLoadMore(state: BrowseState, forFilters: BrowseFilters, forPage: number, message: string): BrowseState {
  if (!browseFiltersEqual(forFilters, state.filters) || forPage !== state.page) return state;
  return { ...state, loading: false, error: message };
}

/** Client-side title filter for a source with no server-side search (the sources table's LaMetric
 * note: cache the full list and filter titles locally). A source with `supports_search: true`
 * should send `query` in the WS request instead and never call this against its own results --
 * `iledclock-explore-browser.ts` picks between the two per the active source’s own flag. */
export function filterItemsByTitle(items: readonly GalleryItem[], query: string): readonly GalleryItem[] {
  const needle = query.trim().toLowerCase();
  return needle ? items.filter((item) => item.title.toLowerCase().includes(needle)) : items;
}

/** Falls back to `defaultSort` when `requested` isn't one of `sorts` -- switching from a source
 * with a "Hand-picked" sort to one without it, etc. */
export function resolveSort(sorts: ReadonlyArray<{ id: string }>, defaultSort: string, requested: string): string {
  return sorts.some((sort) => sort.id === requested) ? requested : defaultSort;
}

// ---- compact artwork facts for the single caption line beneath each tile ----

/** Compact "1.2k"/"3.4M" count for tile captions. */
export function formatCount(n: number): string {
  const trimZero = (s: string) => (s.endsWith(".0") ? s.slice(0, -2) : s);
  if (n >= 1_000_000) return `${trimZero((n / 1_000_000).toFixed(1))}M`;
  if (n >= 1_000) return `${trimZero((n / 1_000).toFixed(1))}k`;
  return String(Math.max(0, Math.round(n)));
}

/** One quiet caption line: dimensions, animation count and optional attribution. */
export type GalleryTileMetadata = Partial<Pick<GalleryItem, "author" | "likes" | "downloads" | "width" | "height" | "animated">> & { frames?: number | null };

export function tileMetaLine(item: GalleryTileMetadata): string | null {
  const facts: string[] = [];
  if (item.width != null && item.width > 0 && item.height != null && item.height > 0) facts.push(`${item.width}×${item.height}`);
  if (item.animated && item.frames && item.frames > 1) facts.push(`${item.frames} frames`);
  const author = item.author?.trim();
  if (author) facts.push(`by ${author}`);
  if (item.likes != null) facts.push(`${formatCount(item.likes)} likes`);
  if (item.downloads != null) facts.push(`${formatCount(item.downloads)} downloads`);
  return facts.length > 0 ? facts.join(" · ") : null;
}
