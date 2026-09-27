import type { PlaylistItem, StoredDesign } from "../types.ts";
import { moveItem } from "./drag-reorder.ts";
import { createPlaylistItem } from "./playlist-item.ts";
import { clampPlaylistDuration } from "./ws-api.ts";

export type LibraryFilter = "all" | "animated" | "still" | "with-clock" | "from-explore";
export type LibrarySort = "recent" | "name";

type DesignMetadata = Omit<StoredDesign, "clock_region"> & {
  origin?: unknown;
  with_clock?: unknown;
  clock_region?: unknown;
  icon_with_clock?: unknown;
};

const CLOCK_REGION_TAGS: Readonly<Record<string, true>> = {
  with_clock: true,
  "with-clock": true,
  clock_region: true,
  "clock-region": true,
  icon_with_clock: true,
  "icon-with-clock": true,
};

export function designHasClockRegion(design: StoredDesign): boolean {
  const metadata = design as DesignMetadata;
  const region = metadata.clock_region;
  if (metadata.with_clock === true || metadata.icon_with_clock === true || region === true || (typeof region === "object" && region !== null)) return true;
  return (design.tags ?? []).some((tag) => CLOCK_REGION_TAGS[tag.trim().toLowerCase()] === true);
}


function searchableText(design: StoredDesign): string {
  const origin = (design as DesignMetadata).origin;
  const originText = origin && typeof origin === "object"
    ? Object.values(origin as Record<string, unknown>).filter((value): value is string => typeof value === "string").join(" ")
    : typeof origin === "string" ? origin : "";
  return `${design.name} ${(design.tags ?? []).join(" ")} ${originText}`.toLocaleLowerCase();
}

export function filterAndSortDesigns(
  designs: readonly StoredDesign[],
  options: { query?: string; filter?: LibraryFilter; sort?: LibrarySort } = {},
): StoredDesign[] {
  const query = (options.query ?? "").trim().toLocaleLowerCase();
  const filter = options.filter ?? "all";
  const sort = options.sort ?? "recent";
  const result = designs.filter((design) => {
    if (query && !searchableText(design).includes(query)) return false;
    switch (filter) {
      case "animated": return design.kind === "animation";
      case "still": return design.kind === "image";
      case "with-clock": return designHasClockRegion(design);
      case "from-explore": return (design as DesignMetadata).origin !== undefined && (design as DesignMetadata).origin !== null;
      case "all": return true;
    }
  });
  if (sort === "name") {
    result.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  } else {
    result.sort((a, b) => (b.updated || b.created || 0) - (a.updated || a.created || 0));
  }
  return result;
}

function paramsEqual(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const keysA = Object.keys(a).sort();
  const keysB = Object.keys(b).sort();
  if (keysA.length !== keysB.length || keysA.some((key, index) => key !== keysB[index])) return false;
  return keysA.every((key) => JSON.stringify(a[key]) === JSON.stringify(b[key]));
}

export function sameRotation(a: readonly PlaylistItem[], b: readonly PlaylistItem[]): boolean {
  return a.length === b.length && a.every((item, index) => {
    const other = b[index];
    return other !== undefined && item.kind === other.kind && item.duration_s === other.duration_s && paramsEqual(item.params, other.params);
  });
}

export function rotationIsDirty(items: readonly PlaylistItem[], saved: readonly PlaylistItem[]): boolean {
  return !sameRotation(items, saved);
}

export function moveRotationItem(items: readonly PlaylistItem[], fromIndex: number, toIndex: number): PlaylistItem[] {
  return moveItem(items, fromIndex, toIndex);
}

export function removeRotationItem(items: readonly PlaylistItem[], index: number): PlaylistItem[] {
  if (index < 0 || index >= items.length) return items.slice();
  return items.filter((_, itemIndex) => itemIndex !== index);
}

export function updateRotationDuration(items: readonly PlaylistItem[], index: number, durationSeconds: number): PlaylistItem[] {
  if (index < 0 || index >= items.length) return items.slice();
  const next = items.slice();
  next[index] = { ...next[index]!, duration_s: clampPlaylistDuration(durationSeconds) };
  return next;
}

export function appendDesignsToRotation(items: readonly PlaylistItem[], designIds: readonly string[], maxItems: number): PlaylistItem[] {
  const room = Math.max(0, maxItems - items.length);
  if (room === 0) return items.slice();
  const uniqueIds = [...new Set(designIds)].filter(Boolean).slice(0, room);
  return [...items, ...uniqueIds.map((id) => ({ ...createPlaylistItem("design"), params: { design_id: id } }))];
}

export function cloneRotation(items: readonly PlaylistItem[]): PlaylistItem[] {
  return items.map((item) => ({ ...item, params: { ...item.params } }));
}
