/** Mocked gallery catalogue + WS handlers for the dev harness, so `iledclock-gallery-browser`/
 * `-item-sheet`/`-import-sheet` can be exercised end to end with no real Home Assistant behind
 * them: LaMetric + AWTRIX configured with real pagination (2 pages each), Divoom left
 * UNCONFIGURED (matches Nitin's actual current state -- no Divoom account -- and exercises the
 * "add a free Divoom account" prompt row honestly rather than faking one). Every item's
 * `media_path` is a small inline SVG data-URI, not a real HTTP media-proxy path -- this harness
 * has no server to serve that route, and `SignedMediaCache.sign()` (see `lib/gallery-api.ts`)
 * already degrades to handing back the path unchanged when `auth/sign_path` fails or is
 * unimplemented, so a data URI "just works" as-is with zero signing support needed here.
 *
 * Wiring into `dev/mock-hass.ts`'s `callWS` switch (mirrors its own existing gallery/import-file
 * branches, just backed by richer data) -- import `GALLERY_SOURCES`, `gallerySearch`,
 * `galleryPreview`, and `importFilePreview` from this module, then:
 *
 * - `iledclock/gallery/sources` returns `GALLERY_SOURCES` (cloned).
 * - `iledclock/gallery/search` returns `gallerySearch({ source, sort, page, query, size,
 *   animatedOnly })`, reading each field off the request message the same way the existing
 *   branch already does.
 * - `iledclock/gallery/preview` returns `galleryPreview(source, id)`.
 * - `iledclock/gallery/import` and `iledclock/import/file` (when `save`) still own pushing a new
 *   entry into the shared `designs` array and minting a `design_id` themselves (that array is
 *   private to `createMockHass`'s own closure) -- just build the saved frames from
 *   `galleryPreview(source, id)`/`importFilePreview(filename)` instead of the existing branches'
 *   own inline preview logic.
 */

import type { GalleryItem, GalleryPreviewResult, GallerySearchResult, GallerySource } from "../src/lib/gallery-api.ts";
import { createFrame, GRID_HEIGHT, GRID_WIDTH } from "../src/lib/grid.ts";
import { frameToBase64 } from "../src/lib/design-codec.ts";
import { plotEllipse } from "../src/lib/rasterize.ts";
import type { RGB } from "../src/lib/color.ts";

const PAGE_SIZE = 8;

export const GALLERY_SOURCES: GallerySource[] = [
  {
    id: "lametric",
    name: "LaMetric",
    configured: true,
    requires_account: false,
    sorts: [
      { id: "popular", label: "Popular" },
      { id: "newest", label: "Newest" },
      { id: "title", label: "A\u2013Z" },
    ],
    default_sort: "popular",
    sizes: [],
    supports_search: false,
    homepage: "https://developer.lametric.com/icons",
  },
  {
    id: "awtrix",
    name: "AWTRIX Hub",
    configured: true,
    requires_account: false,
    sorts: [
      { id: "popular", label: "Most downloaded" },
      { id: "newest", label: "Newest" },
      { id: "handpicked", label: "Hand-picked" },
      { id: "title", label: "A\u2013Z" },
    ],
    default_sort: "popular",
    sizes: ["8x8", "32x8"],
    supports_search: true,
    homepage: "https://awtrix.de/icons",
  },
  {
    id: "divoom",
    name: "Divoom Cloud",
    configured: false,
    requires_account: true,
    sorts: [
      { id: "recommended", label: "Recommended" },
      { id: "new", label: "New" },
      { id: "popular", label: "Popular" },
    ],
    default_sort: "recommended",
    sizes: ["16x16", "32x32", "64x64"],
    supports_search: true,
    homepage: "https://app.divoom-gz.com",
  },
];

// ---- deterministic, genuinely-renderable placeholder art (no real decoder in a dev harness) ----

function hashString(seed: string): number {
  let hash = 0;
  for (const ch of seed) hash = (hash * 31 + ch.charCodeAt(0)) & 0xffffff;
  return hash;
}

function hueToRgb(hue: number): RGB {
  const chroma = 200;
  const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const [r, g, b] = hue < 60 ? [chroma, x, 0] : hue < 120 ? [x, chroma, 0] : hue < 180 ? [0, chroma, x] : hue < 240 ? [0, x, chroma] : hue < 300 ? [x, 0, chroma] : [chroma, 0, x];
  return [Math.round(r + 40), Math.round(g + 40), Math.round(b + 40)];
}

function rgbToHexColor(rgb: RGB): string {
  const hex = (n: number) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, "0");
  return `#${hex(rgb[0])}${hex(rgb[1])}${hex(rgb[2])}`;
}

/** A small, deterministic coloured-ring SVG `data:` URI at the item's own native size -- a
 * genuinely renderable stand-in for the source's real artwork (never a broken-image icon), honest
 * about not being real pixel art (same "well-formed, non-blank, right size, not pretending to be
 * real" bar `dev/mock-hass.ts`'s own preview mocks already hold themselves to). */
function iconDataUri(seed: string, width: number, height: number): string {
  const hue = hashString(seed) % 360;
  const color = rgbToHexColor(hueToRgb(hue));
  const cx = width / 2;
  const cy = height / 2;
  const r = Math.max(1, Math.min(width, height) / 2 - 0.5);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}"><circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const LAMETRIC_TITLES = ["Sunny cloud", "Coffee cup", "Pixel heart", "Rocket ship", "Music note", "Umbrella", "Snowflake", "Birthday cake", "Alarm bell", "Wifi signal", "Battery full", "Thumbs up"];
const AWTRIX_TITLES = ["Flame", "Rain drop", "Sun rise", "Moon phase", "Leaf fall", "Snow storm", "Lightning", "Rainbow arc", "Wind gust", "Fog bank"];

const BASE_CREATED_S = 1_700_000_000;

function buildLametricItems(): GalleryItem[] {
  return LAMETRIC_TITLES.map((title, i) => ({
    source: "lametric",
    id: String(1000 + i),
    title,
    author: i % 3 === 0 ? "LaMetric" : undefined,
    width: 8,
    height: 8,
    animated: i % 4 === 0,
    likes: 40 + i * 23,
    created: BASE_CREATED_S + i * 86_400,
    media_path: iconDataUri(`lametric-${i}`, 8, 8),
    url: null, // confirmed with GalleryEngine: LaMetric has no per-icon page, falls back to source.homepage
  }));
}

function buildAwtrixItems(): GalleryItem[] {
  return AWTRIX_TITLES.map((title, i) => {
    const size: "8x8" | "32x8" = i % 3 === 0 ? "32x8" : "8x8";
    const [width, height] = size === "32x8" ? [32, 8] : [8, 8];
    const slug = title.toLowerCase().replace(/\s+/g, "-");
    return {
      source: "awtrix",
      id: slug,
      title,
      author: i % 4 === 0 ? undefined : "awtrix-community",
      width,
      height,
      animated: i % 2 === 0,
      downloads: 120 + i * 340,
      created: BASE_CREATED_S + i * 43_200,
      media_path: iconDataUri(`awtrix-${i}`, width, height),
      url: `https://awtrix.de/icons/${slug}`,
    };
  });
}

const GALLERY_ITEMS: Readonly<Record<string, GalleryItem[]>> = {
  lametric: buildLametricItems(),
  awtrix: buildAwtrixItems(),
  divoom: [],
};

export function findGalleryItem(source: string, id: string): GalleryItem | undefined {
  return (GALLERY_ITEMS[source] ?? []).find((item) => item.id === id);
}

function sortItems(items: readonly GalleryItem[], sort: string): GalleryItem[] {
  const copy = items.slice();
  if (sort === "newest" || sort === "new") return copy.sort((a, b) => (b.created ?? 0) - (a.created ?? 0));
  if (sort === "title") return copy.sort((a, b) => a.title.localeCompare(b.title));
  if (sort === "popular" || sort === "recommended" || sort === "handpicked") return copy.sort((a, b) => (b.likes ?? b.downloads ?? 0) - (a.likes ?? a.downloads ?? 0));
  return copy;
}

export interface GallerySearchParams {
  source: string;
  sort: string;
  page: number;
  query?: string;
  size?: string;
  animatedOnly?: boolean;
}

export function gallerySearch(params: GallerySearchParams): GallerySearchResult {
  let items: readonly GalleryItem[] = GALLERY_ITEMS[params.source] ?? [];
  if (params.query) {
    const needle = params.query.toLowerCase();
    items = items.filter((item) => item.title.toLowerCase().includes(needle));
  }
  if (params.animatedOnly) items = items.filter((item) => item.animated);
  if (params.size) items = items.filter((item) => `${item.width}x${item.height}` === params.size);
  const sorted = sortItems(items, params.sort);
  const start = Math.max(0, params.page) * PAGE_SIZE;
  const page = sorted.slice(start, start + PAGE_SIZE);
  return { items: page, page: params.page, has_more: start + PAGE_SIZE < sorted.length };
}

/** Deterministic "adapted" 32x16 preview -- a hue-shifting ring whose colour/animation derive
 * from a hash of `seed`, not a real adaptation pipeline (that's GalleryEngine's `adapt.py`); the
 * `plotEllipse` default `quantize` (curved `quantizePreviewRgb`) already matches the real
 * pipeline's own "animation" content path, so these frames' colours round-trip through the exact
 * same 4-bit-per-channel curve a genuine adapted preview would. */
function previewFrames(seed: string, animated: boolean): { framesB64: string[]; delaysMs: number[] } {
  const hue = hashString(seed) % 360;
  const frameCount = animated ? 6 : 1;
  const framesB64: string[] = [];
  for (let i = 0; i < frameCount; i++) {
    const color = hueToRgb((hue + i * 25) % 360);
    const frame = plotEllipse(createFrame(GRID_WIDTH, GRID_HEIGHT, [0, 0, 0]), 8, 2, 23, 13, color, true);
    framesB64.push(frameToBase64(frame));
  }
  return { framesB64, delaysMs: framesB64.map(() => 120) };
}

export function galleryPreview(source: string, id: string): GalleryPreviewResult {
  const item = findGalleryItem(source, id);
  const { framesB64, delaysMs } = previewFrames(`${source}/${id}`, item?.animated ?? false);
  return {
    frames: framesB64,
    delays_ms: delaysMs,
    layout: "auto",
    layouts_available: ["auto", "center", "fit", "fill", "stretch"],
    report: {
      native_size: [item?.width ?? GRID_WIDTH, item?.height ?? GRID_HEIGHT],
      detected_scale: 1,
      trimmed_box: null,
      frames_in: framesB64.length,
      frames_out: framesB64.length,
      duration_in_ms: framesB64.length * 120,
      duration_out_ms: framesB64.length * 120,
      notes: ["dev-harness mock: not the real adapt.py pipeline"],
    },
  };
}

/** Same mock preview machinery, keyed by an uploaded filename instead of a catalogue id -- backs
 * `iledclock/import/file`'s preview response (and, once the mock saves it, the frames it stores
 * for the `{design_id}` it returns). `native_size` falls back to the full 32x16 grid since a mock
 * upload has no real decoded source dimensions to report. */
export function importFilePreview(filename: string): GalleryPreviewResult {
  const animated = /\.(gif|apng)$/i.test(filename);
  const { framesB64, delaysMs } = previewFrames(filename, animated);
  return {
    frames: framesB64,
    delays_ms: delaysMs,
    layout: "auto",
    layouts_available: ["auto", "center", "fit", "fill", "stretch"],
    report: {
      native_size: [GRID_WIDTH, GRID_HEIGHT],
      detected_scale: 1,
      trimmed_box: null,
      frames_in: framesB64.length,
      frames_out: framesB64.length,
      duration_in_ms: framesB64.length * 120,
      duration_out_ms: framesB64.length * 120,
      notes: ["dev-harness mock: not the real adapt.py pipeline"],
    },
  };
}
