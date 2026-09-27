/** Independent load state for each Explore shelf. A source that stalls or fails cannot hold up its neighbours. */

import type { GalleryItem } from "./gallery-api.ts";

export interface GalleryShelfDescriptor {
  readonly id: string;
  readonly title: string;
  readonly source: string;
  readonly category?: string;
  readonly sort?: string;
}

export type ShelfStatus = "idle" | "loading" | "ready" | "error";

export interface ShelfLoadState {
  readonly status: ShelfStatus;
  readonly items: readonly GalleryItem[];
  readonly error: string | null;
  /** Increments on every retry/reset so late responses cannot overwrite newer work. */
  readonly requestId: number;
}

export type ShelfLoadStates = Readonly<Record<string, ShelfLoadState>>;

const EMPTY_SHELF: ShelfLoadState = { status: "idle", items: [], error: null, requestId: 0 };

export function initialShelfLoadStates(shelves: readonly GalleryShelfDescriptor[]): Record<string, ShelfLoadState> {
  return Object.fromEntries(shelves.map((shelf) => [shelf.id, { ...EMPTY_SHELF }]));
}

export function beginShelfLoad(states: ShelfLoadStates, shelfId: string): { states: Record<string, ShelfLoadState>; requestId: number } | null {
  const current = states[shelfId];
  if (!current) return null;
  const requestId = current.requestId + 1;
  return {
    requestId,
    states: { ...states, [shelfId]: { status: "loading", items: [], error: null, requestId } },
  };
}

export function resolveShelfLoad(states: ShelfLoadStates, shelfId: string, requestId: number, items: readonly GalleryItem[]): ShelfLoadStates {
  const current = states[shelfId];
  if (!current || current.requestId !== requestId || current.status !== "loading") return states;
  return { ...states, [shelfId]: { ...current, status: "ready", items: items.slice(), error: null } };
}

export function rejectShelfLoad(states: ShelfLoadStates, shelfId: string, requestId: number, error: string): ShelfLoadStates {
  const current = states[shelfId];
  if (!current || current.requestId !== requestId || current.status !== "loading") return states;
  return { ...states, [shelfId]: { ...current, status: "error", items: [], error } };
}
