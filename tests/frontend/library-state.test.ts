import { test } from "node:test";
import assert from "node:assert/strict";
import type { PlaylistItem, StoredDesign } from "../../frontend/src/types.ts";
import {
  appendDesignsToRotation,
  designHasClockRegion,
  filterAndSortDesigns,
  moveRotationItem,
  removeRotationItem,
  rotationIsDirty,
  updateRotationDuration,
} from "../../frontend/src/lib/library-state.ts";
import { MAX_IMPORT_FILE_BYTES, validateImportFile } from "../../frontend/src/lib/gallery-api.ts";

function design(id: string, name: string, kind: StoredDesign["kind"], updated: number, extra: Partial<StoredDesign> = {}): StoredDesign {
  return { id, name, kind, width: 32, height: 16, frames: [], delays: [], created: updated, updated, ...extra };
}

function playlistItem(kind: PlaylistItem["kind"], params: Record<string, unknown> = {}, duration_s = 10): PlaylistItem {
  return { kind, params, duration_s };
}

const DESIGNS = [
  design("d1", "Sunrise", "image", 20, { tags: ["with_clock"] }),
  design("d2", "Fire Loop", "animation", 40),
  design("d3", "Tea", "image", 10, { origin: { source: "explore", title: "Tea cup" } } as Partial<StoredDesign>),
];

test("Library filters combine animation, clock-region tags, Explore origin, and text search", () => {
  assert.deepEqual(filterAndSortDesigns(DESIGNS, { filter: "animated" }).map((item) => item.id), ["d2"]);
  assert.deepEqual(filterAndSortDesigns(DESIGNS, { filter: "still" }).map((item) => item.id), ["d1", "d3"]);
  assert.deepEqual(filterAndSortDesigns(DESIGNS, { filter: "with-clock" }).map((item) => item.id), ["d1"]);
  assert.deepEqual(filterAndSortDesigns(DESIGNS, { filter: "from-explore" }).map((item) => item.id), ["d3"]);
  assert.deepEqual(filterAndSortDesigns(DESIGNS, { filter: "from-explore", query: "TEA" }).map((item) => item.id), ["d3"]);
});

test("Library sort orders recent updates newest-first and names without case sensitivity", () => {
  assert.deepEqual(filterAndSortDesigns(DESIGNS, { sort: "recent" }).map((item) => item.id), ["d2", "d1", "d3"]);
  assert.deepEqual(filterAndSortDesigns(DESIGNS, { sort: "name" }).map((item) => item.name), ["Fire Loop", "Sunrise", "Tea"]);
});

test("With clock recognizes the persisted tag and explicit region metadata", () => {
  assert.equal(designHasClockRegion(DESIGNS[0]!), true);
  assert.equal(designHasClockRegion({ ...DESIGNS[1]!, clock_region: { x: 0, y: 0, w: 16, h: 7 } } as StoredDesign), true);
  assert.equal(designHasClockRegion(DESIGNS[2]!), false);
});

test("rotation reorder and removal preserve input and produce the requested order", () => {
  const original = [playlistItem("clock"), playlistItem("text", { text: "Hi" }), playlistItem("humidity")];
  const moved = moveRotationItem(original, 0, 2);
  assert.deepEqual(moved.map((item) => item.kind), ["text", "humidity", "clock"]);
  assert.deepEqual(original.map((item) => item.kind), ["clock", "text", "humidity"]);
  assert.deepEqual(removeRotationItem(moved, 1).map((item) => item.kind), ["text", "clock"]);
  assert.deepEqual(removeRotationItem(moved, -1), moved);
});

test("rotation duration is clamped and editing one row marks the draft dirty", () => {
  const saved = [playlistItem("clock"), playlistItem("temperature")];
  assert.equal(rotationIsDirty(saved, saved), false);
  assert.equal(rotationIsDirty([{ ...saved[0]!, params: { color: [255, 255, 255], style: 1 } }, saved[1]!], [{ ...saved[0]!, params: { style: 1, color: [255, 255, 255] } }, saved[1]!]), false);
  const updated = updateRotationDuration(saved, 1, 5000);
  assert.equal(updated[1]!.duration_s, 3600);
  assert.equal(rotationIsDirty(updated, saved), true);
  assert.equal(saved[1]!.duration_s, 10);
});

test("adding selected designs deduplicates ids and respects the device's remaining slots", () => {
  const current = [playlistItem("clock")];
  const result = appendDesignsToRotation(current, ["a", "a", "b", "c"], 3);
  assert.deepEqual(result.map((item) => item.kind), ["clock", "design", "design"]);
  assert.deepEqual(result.slice(1).map((item) => item.params.design_id), ["a", "b"]);
  assert.equal(appendDesignsToRotation(result, ["d"], 3).length, 3);
});

test("Import validation accepts .ase and the exact 8 MB cap, and rejects one byte over", () => {
  assert.equal(validateImportFile("sprite.ase", MAX_IMPORT_FILE_BYTES), null);
  assert.equal(validateImportFile("sprite.aseprite", MAX_IMPORT_FILE_BYTES), null);
  assert.match(validateImportFile("sprite.gif", MAX_IMPORT_FILE_BYTES + 1) ?? "", /too large/);
  assert.match(validateImportFile("sprite.bmp", 1) ?? "", /supported type/);
});
