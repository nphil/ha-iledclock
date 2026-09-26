/** Shapes and builds every `iledclock/gallery/*` and `iledclock/import/file` WebSocket call
 * (docs/GALLERY.md's WS API section), plus the option-normalisation and signed-media-path caching
 * those calls need. Mirrors `ws-api.ts`'s own split: thin envelope builders here, with the real
 * validation logic in `normalizeAdjustOptions` (bounds a permissive Adjust-disclosure UI state
 * into the payload the integration expects, exactly like `ws-api.ts`'s `normalizePlaylist`) so a
 * runaway slider drag can never reach the wire as a request the server would just reject anyway.
 */

import type { HomeAssistant } from "../types.ts";
import { clampRgb, type RGB } from "./color.ts";
import { clampCropBox, type CropBox } from "./gallery-crop.ts";

// ---- source catalogue ----

export interface GallerySortOption {
  id: string;
  label: string;
}

export interface GallerySource {
  id: string;
  name: string;
  configured: boolean;
  requires_account: boolean;
  sorts: GallerySortOption[];
  default_sort: string;
  /** Lowercase "WxH" strings ("8x8", "32x8", "16x16"), confirmed with GalleryEngine -- never
   * `{width,height}` objects. Empty for a source with only one implicit size (nothing to filter). */
  sizes: string[];
  supports_search: boolean;
  homepage: string;
}

// ---- search ----

export interface GalleryItem {
  source: string;
  id: string;
  title: string;
  author?: string | null;
  width: number;
  height: number;
  animated: boolean;
  likes?: number | null;
  downloads?: number | null;
  /** Unix epoch SECONDS (confirmed with GalleryEngine), `null`/absent when the source exposes no
   * per-item date (LaMetric). Not currently surfaced in the UI (only used server-side for the
   * "New" sort) but kept on the type for fidelity with the wire payload. */
  created?: number | null;
  /** Unsigned path of the integration's authenticated HTTP media proxy view -- sign with
   * `SignedMediaCache` before using as an `<img src>`. */
  media_path: string;
  /** The item's own page on the source site, `null` when the source has no per-item page
   * (LaMetric). Fall back to the source's own `homepage` in that case (`galleryItemUrl`). */
  url?: string | null;
}

export interface GallerySearchResult {
  items: GalleryItem[];
  page: number;
  has_more: boolean;
}

export interface GallerySearchParams {
  source: string;
  sort: string;
  page: number;
  query?: string;
  size?: string;
  animatedOnly?: boolean;
}

// ---- adaptation (adapt.py, docs/GALLERY.md section "Adaptation pipeline") ----

export const GALLERY_LAYOUTS = ["auto", "center", "fit", "fill", "stretch", "tile", "mirror"] as const;
export type GalleryLayout = (typeof GALLERY_LAYOUTS)[number];

const GALLERY_LAYOUT_LABELS: Readonly<Record<GalleryLayout, string>> = {
  auto: "Auto",
  center: "Center",
  fit: "Fit",
  fill: "Fill",
  stretch: "Stretch",
  tile: "Tile",
  mirror: "Mirror",
};

/** A layout id's display label. Falls back to turning an unrecognised snake_case/kebab-case id
 * (e.g. a future `NATIVE_LAYERS`-based composition like `icon_with_clock`) into title-cased
 * words instead of crashing or showing a raw identifier, so the layout pills stay readable the
 * moment GalleryEngine adds a new composed layout to `layouts_available`, with no change needed
 * here first. */
export function galleryLayoutLabel(layout: string): string {
  const known = GALLERY_LAYOUT_LABELS[layout as GalleryLayout];
  if (known) return known;
  if (layout.length === 0) return layout;
  return layout
    .split(/[_-]+/)
    .filter((word) => word.length > 0)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/** `layouts_available` plus "auto" (always offered even if the server's own list already
 * includes it), de-duplicated and in a stable order -- the exact option list both the item sheet
 * and the import sheet feed their layout pills, so the same "what can this be shown as" list
 * never needs re-deriving twice. */
export function availableLayoutOptions(layoutsAvailable: readonly string[]): string[] {
  const layouts: string[] = [];
  for (const layout of ["auto", ...layoutsAvailable]) if (!layouts.includes(layout)) layouts.push(layout);
  return layouts;
}

export interface GalleryAdjustOptions {
  layout?: GalleryLayout;
  crop?: CropBox;
  scale?: number;
  offset?: { x: number; y: number };
  background?: RGB;
  enhance?: boolean;
}

export interface AdaptReport {
  native_size: readonly [number, number];
  detected_scale: number;
  /** `null` when nothing needed trimming (the source already fills its own bounding box). */
  trimmed_box: readonly [number, number, number, number] | null;
  frames_in: number;
  frames_out: number;
  duration_in_ms: number;
  duration_out_ms: number;
  notes: string[];
}

export interface GalleryPreviewResult {
  frames: string[];
  delays_ms: number[];
  layout: GalleryLayout;
  layouts_available: GalleryLayout[];
  report: AdaptReport;
}

export interface GalleryImportResult {
  design_id: string;
}

/** `iledclock/import/file`'s response is the preview payload when `save` is falsy, or
 * `{design_id}` once `save: true` actually persisted it. */
export type ImportFileResult = GalleryPreviewResult | GalleryImportResult;

export function isImportFileSaved(result: ImportFileResult): result is GalleryImportResult {
  return typeof (result as Partial<GalleryImportResult>).design_id === "string";
}

/** The item's own page for a credit link, falling back to the source's `homepage` when the item
 * has none (LaMetric never does) -- `undefined` only if neither exists. */
export function galleryItemUrl(item: Pick<GalleryItem, "url">, source: Pick<GallerySource, "homepage"> | undefined): string | undefined {
  return item.url ?? source?.homepage ?? undefined;
}

// ---- WS message builders (Contract-shaped envelopes; validation happens before these are called) ----

export function gallerySourcesRequest(entryId: string): Record<string, unknown> {
  return { type: "iledclock/gallery/sources", entry_id: entryId };
}

export function gallerySearchRequest(entryId: string, params: GallerySearchParams): Record<string, unknown> {
  const msg: Record<string, unknown> = { type: "iledclock/gallery/search", entry_id: entryId, source: params.source, sort: params.sort, page: params.page + 1 };
  // The browse state counts pages from 0; the server's `page` is 1-based (0 is rejected).
  if (params.query) msg.query = params.query;
  if (params.size) msg.size = params.size;
  if (params.animatedOnly) msg.animated_only = true;
  return msg;
}

export function galleryPreviewRequest(entryId: string, source: string, id: string, options?: GalleryAdjustOptions): Record<string, unknown> {
  const msg: Record<string, unknown> = { type: "iledclock/gallery/preview", entry_id: entryId, source, item_id: id };
  if (options && Object.keys(options).length > 0) msg.options = options;
  return msg;
}

export function galleryImportRequest(entryId: string, source: string, id: string, options?: GalleryAdjustOptions, name?: string): Record<string, unknown> {
  const msg: Record<string, unknown> = { type: "iledclock/gallery/import", entry_id: entryId, source, item_id: id };
  if (options && Object.keys(options).length > 0) msg.options = options;
  if (name) msg.name = name;
  return msg;
}

export interface ImportFileParams {
  filename: string;
  dataB64: string;
  options?: GalleryAdjustOptions;
  save?: boolean;
  name?: string;
}

export function importFileRequest(entryId: string, params: ImportFileParams): Record<string, unknown> {
  const msg: Record<string, unknown> = { type: "iledclock/import/file", entry_id: entryId, filename: params.filename, data_b64: params.dataB64 };
  if (params.options && Object.keys(params.options).length > 0) msg.options = params.options;
  if (params.save) msg.save = true;
  if (params.name) msg.name = params.name;
  return msg;
}

// ---- Adjust-disclosure option bounds ----

const MIN_ADJUST_SCALE = 1;
const MAX_ADJUST_SCALE = 16;
const MAX_ADJUST_OFFSET = 512;

export function clampAdjustScale(scale: number): number {
  return Math.max(MIN_ADJUST_SCALE, Math.min(MAX_ADJUST_SCALE, Math.round(scale)));
}

export function clampAdjustOffset(value: number): number {
  return Math.max(-MAX_ADJUST_OFFSET, Math.min(MAX_ADJUST_OFFSET, Math.round(value)));
}

/** Turns permissive Adjust-disclosure UI state (crop drag, scale/offset steppers, colour picker)
 * into the bounded payload `iledclock/gallery/preview|import`/`iledclock/import/file` expect --
 * every field is independently optional (only what the user actually touched goes over the wire,
 * letting the server's own `auto` defaults apply to everything else), and every present field is
 * clamped into its valid range. `sourceWidth`/`sourceHeight` bound `crop` in source-pixel space. */
export function normalizeAdjustOptions(options: GalleryAdjustOptions, sourceWidth: number, sourceHeight: number): GalleryAdjustOptions {
  const out: GalleryAdjustOptions = {};
  if (options.layout) out.layout = options.layout;
  if (options.crop) out.crop = clampCropBox(options.crop, sourceWidth, sourceHeight);
  if (options.scale !== undefined) out.scale = clampAdjustScale(options.scale);
  if (options.offset) out.offset = { x: clampAdjustOffset(options.offset.x), y: clampAdjustOffset(options.offset.y) };
  if (options.background) out.background = clampRgb(options.background);
  if (options.enhance !== undefined) out.enhance = options.enhance;
  return out;
}

// ---- import file validation (docs/GALLERY.md: "Accepts GIF/PNG/JPEG/WebP/.aseprite/.ase/.piskel", max 8 MB) ----

export const MAX_IMPORT_FILE_BYTES = 8 * 1024 * 1024;
const RASTER_IMPORT_EXTENSIONS = ["gif", "png", "jpg", "jpeg", "webp"] as const;
const OPAQUE_IMPORT_EXTENSIONS = ["aseprite", "ase", "piskel"] as const;
const ACCEPTED_IMPORT_EXTENSIONS: readonly string[] = [...RASTER_IMPORT_EXTENSIONS, ...OPAQUE_IMPORT_EXTENSIONS];

export function importFileExtension(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot === -1 ? "" : filename.slice(dot + 1).toLowerCase();
}

/** Whether the browser can decode and display this file itself (so the import sheet can offer a
 * draggable crop box over the real source image) as opposed to an opaque `.aseprite`/`.piskel`
 * file, which only the server can decode -- those skip straight to the adapted preview with
 * numeric-only crop/scale/offset, same as a gallery item. */
export function isRasterImportFile(filename: string): boolean {
  return (RASTER_IMPORT_EXTENSIONS as readonly string[]).includes(importFileExtension(filename));
}

export function isAcceptedImportFile(filename: string): boolean {
  return ACCEPTED_IMPORT_EXTENSIONS.includes(importFileExtension(filename));
}

/** `null` when the file is acceptable; otherwise a user-facing reason, checked before ever
 * reading the file into memory or making a WS call. */
export function validateImportFile(filename: string, sizeBytes: number): string | null {
  if (!isAcceptedImportFile(filename)) return `${filename || "That file"} isn't a supported type (GIF, PNG, JPEG, WebP, .aseprite, or .piskel).`;
  if (sizeBytes > MAX_IMPORT_FILE_BYTES) return `${filename} is too large (max 8 MB).`;
  return null;
}

const MIME_IMPORT_EXTENSIONS: Readonly<Record<string, string>> = {
  "image/gif": "gif",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

/** A sensible filename for a pasted-URL import: the URL's own last path segment when it already
 * carries a recognised extension, otherwise that segment (or a generic fallback) with an
 * extension guessed from the fetched response's MIME type -- `isAcceptedImportFile`/
 * `isRasterImportFile` both key off the filename, so a URL like an API redirect with no visible
 * extension still gets validated and routed correctly. */
export function filenameForUrl(url: string, mimeType: string): string {
  const guessedExt = MIME_IMPORT_EXTENSIONS[mimeType.split(";")[0]!.trim().toLowerCase()] ?? "png";
  let base = "image";
  try {
    const pathname = new URL(url).pathname;
    const last = pathname.slice(pathname.lastIndexOf("/") + 1);
    if (last) base = last;
  } catch {
    // Not a parseable absolute URL -- fall back to the generic name below.
  }
  return importFileExtension(base) ? base : `${base}.${guessedExt}`;
}

// ---- signed media paths ----

export interface SignedPathEntry {
  readonly signedPath: string;
  readonly expiresAtMs: number;
}

/** Requested validity (seconds) for a signed media path -- long enough that a grid's worth of
 * tiles, or a slow connection re-fetching a GIF, doesn't need re-signing mid-scroll. */
export const SIGNED_PATH_TTL_S = 600;
/** Refresh once less than this much validity remains rather than waiting for outright expiry, so
 * a request started just before expiry can never resolve to an already-dead URL. */
const SIGNED_PATH_REFRESH_MARGIN_MS = 15_000;

export function isSignedPathFresh(entry: SignedPathEntry | undefined, nowMs: number): boolean {
  return entry !== undefined && entry.expiresAtMs - nowMs > SIGNED_PATH_REFRESH_MARGIN_MS;
}

/** Signs `iledclock/gallery/media/...` proxy paths with HA's own `auth/sign_path`, so this
 * bundle's `<img>` elements can load the integration's authenticated HTTP view without embedding
 * a bearer token in markup. One instance per component; a `hass` that can't sign (no `callWS`, or
 * a `callWS` that rejects -- an older `hass`, or a dev harness without this specific command)
 * degrades to handing back the unsigned path rather than throwing, since a caller with nothing to
 * check for a signature has nothing to lose by trying the plain path. */
export class SignedMediaCache {
  private readonly _entries = new Map<string, SignedPathEntry>();

  async sign(hass: HomeAssistant, path: string): Promise<string> {
    const now = Date.now();
    const cached = this._entries.get(path);
    if (isSignedPathFresh(cached, now)) return cached!.signedPath;
    if (!hass.callWS) return path;
    try {
      const result = await hass.callWS<{ path: string }>({ type: "auth/sign_path", path, expires: SIGNED_PATH_TTL_S });
      this._entries.set(path, { signedPath: result.path, expiresAtMs: now + SIGNED_PATH_TTL_S * 1000 });
      return result.path;
    } catch {
      return path;
    }
  }

  clear(): void {
    this._entries.clear();
  }
}

/** Plain-language description of what "Auto" actually did, from the server's adaptation notes
 * (`report.layout` is just "auto"; the real decision is in a note like
 * "auto layout chose majority-pool-x4"). Returns null when the report has no such note. */
export function describeAutoFit(notes: readonly string[]): string | null {
  const note = notes.find((n) => n.startsWith("auto layout chose "));
  if (!note) return null;
  const strategy = note.slice("auto layout chose ".length);
  const pool = /^majority-pool-x(\d+)$/.exec(strategy);
  if (pool) return `Auto: scaled down ${pool[1]}x, keeping every pixel edge sharp.`;
  if (strategy.startsWith("center-like")) return "Auto: shown pixel for pixel, centred on the clock.";
  if (strategy.startsWith("fit-like")) return "Auto: fitted as a photo, colours boosted for the LEDs.";
  return `Auto: ${strategy}.`;
}
