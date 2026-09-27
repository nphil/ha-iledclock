import type { GalleryAdjustOptions } from "./gallery-api.ts";

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([, child]) => child !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, stableValue(child)]));
  }
  return value;
}

export function galleryImportCacheKey(source: string, id: string, options: GalleryAdjustOptions): string {
  return JSON.stringify([source, id, stableValue(options)]);
}

/** Reuses a single saved design for the same source item and adapted options during this Studio session. */
export class GalleryImportCache {
  private static _generation = 0;
  private _generation = GalleryImportCache._generation;
  private readonly _pending = new Map<string, Promise<string>>();

  getOrImport(source: string, id: string, options: GalleryAdjustOptions, importDesign: () => Promise<string>): Promise<string> {
    if (this._generation !== GalleryImportCache._generation) {
      this._pending.clear();
      this._generation = GalleryImportCache._generation;
    }
    const key = galleryImportCacheKey(source, id, options);
    const existing = this._pending.get(key);
    if (existing) return existing;
    const pending = Promise.resolve().then(importDesign).catch((error: unknown) => {
      if (this._pending.get(key) === pending) this._pending.delete(key);
      throw error;
    });
    this._pending.set(key, pending);
    return pending;
  }

  clear(): void {
    this._pending.clear();
  }

  static clearAll(): void {
    GalleryImportCache._generation++;
  }
}
