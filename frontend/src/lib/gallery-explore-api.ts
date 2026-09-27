import { galleryLayoutLabel, type GalleryItem, type GallerySource } from "./gallery-api.ts";

export interface ExploreCategory {
  id: string;
  label: string;
}

export interface ExploreSource extends GallerySource {
  categories?: ExploreCategory[];
  kind?: "native" | "adapted";
}

export interface ExploreGalleryItem extends GalleryItem {
  category?: string | null;
  frames?: number | null;
  native_fit?: boolean;
  url?: string | null;
}

export interface ExploreSearchResult {
  items: ExploreGalleryItem[];
  page: number;
  has_more: boolean;
}

export interface ExploreSearchFilters {
  source: string;
  sort: string;
  /** Client pages are zero-based; the HA WebSocket contract is one-based. */
  page: number;
  query?: string;
  category?: string;
  size?: string;
  animatedOnly?: boolean;
}

/** Builds the gallery request locally so this destination can use the newer category contract
 * without changing the shared gallery API helper while its signing work is in progress. */
export function exploreSearchRequest(entryId: string, filters: ExploreSearchFilters): Record<string, unknown> {
  const message: Record<string, unknown> = {
    type: "iledclock/gallery/search",
    entry_id: entryId,
    source: filters.source,
    sort: filters.sort,
    page: filters.page + 1,
  };
  const query = filters.query?.trim();
  if (query) message.query = query;
  if (filters.category) message.category = filters.category;
  if (filters.size) message.size = filters.size;
  if (filters.animatedOnly) message.animated_only = true;
  return message;
}


export const EXPLORE_SOURCE_ORDER = ["iledclock", "iledclock_anim", "lametric", "awtrix", "divoom"] as const;

export function exploreSourceLabel(source: Pick<ExploreSource, "id" | "name">): string {
  switch (source.id) {
    case "iledclock": return "iLedClock";
    case "iledclock_anim": return "Animations";
    case "lametric": return "LaMetric";
    case "awtrix": return "AWTRIX";
    case "divoom": return "Divoom";
    default: return source.name;
  }
}

const EXPLORE_LAYOUT_ORDER = ["auto", "fit", "fill", "tile", "icon_with_clock"] as const;

export function exploreLayoutOptions(layoutsAvailable: readonly string[]): string[] {
  const available = new Set(layoutsAvailable);
  return EXPLORE_LAYOUT_ORDER.filter((layout) => layout === "auto" || available.has(layout));
}

export function exploreLayoutLabel(layout: string): string {
  return layout === "icon_with_clock" ? "With clock" : galleryLayoutLabel(layout);
}

export function orderedExploreSources(sources: readonly ExploreSource[]): ExploreSource[] {
  const configured = sources.filter((source) => source.configured);
  const ordered: ExploreSource[] = [];
  for (const id of EXPLORE_SOURCE_ORDER) {
    const source = configured.find((candidate) => candidate.id === id);
    if (source) ordered.push(source);
  }
  for (const source of configured) if (!EXPLORE_SOURCE_ORDER.includes(source.id as (typeof EXPLORE_SOURCE_ORDER)[number])) ordered.push(source);
  return ordered;
}
export function fitsClockExactly(item: Pick<ExploreGalleryItem, "native_fit" | "width" | "height">): boolean {
  return item.native_fit === true || (item.native_fit === undefined && item.width === 32 && item.height === 16);
}

/** Native 32×16 and all other non-square artwork use the wide design plate; square sources stay square. */
export function exploreTileAspect(item: Pick<ExploreGalleryItem, "width" | "height">): "square" | "design" {
  return item.width === item.height ? "square" : "design";
}

export function parseExploreSize(size: string | undefined): readonly [number, number] | null {
  if (!size) return null;
  const match = /^(\d+)x(\d+)$/i.exec(size);
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  return width > 0 && height > 0 ? [width, height] : null;
}

export function fallbackExploreItem(source: ExploreSource | undefined, sourceId: string, id: string): ExploreGalleryItem {
  const size = parseExploreSize(source?.sizes[0]);
  const filename = id.split("/").pop() || id;
  const title = filename.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ") || "Pixel art";
  const mediaId = id.split("/").map((part) => encodeURIComponent(part)).join("/");
  return {
    source: sourceId,
    id,
    title,
    width: size?.[0] ?? 32,
    height: size?.[1] ?? 16,
    animated: false,
    media_path: `/api/iledclock/gallery/media/${encodeURIComponent(sourceId)}/${mediaId}`,
    url: source?.homepage,
  };
}

