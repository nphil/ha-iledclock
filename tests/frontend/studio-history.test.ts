import { test } from "node:test";
import assert from "node:assert/strict";
import { showItemFromDescriptor } from "../../frontend/src/lib/studio-history.ts";

test("design history entries replay only their design id", () => {
  assert.deepEqual(showItemFromDescriptor({ kind: "design", design_id: "design-7", title: "Heart", shown_at: "2026-09-27T10:00:00Z" }), { design_id: "design-7" });
  assert.equal(showItemFromDescriptor({ kind: "design", title: "Missing id" }), null);
});

test("other history entries rebuild the show spec without presentation metadata", () => {
  assert.deepEqual(showItemFromDescriptor({ kind: "clock", style: 12, color: [255, 0, 0], title: "Clock", shown_at: "now", unavailable: false }), {
    spec: { type: "clock", style: 12, color: [255, 0, 0] },
  });
});

test("generative history restores the preset field expected by the show API", () => {
  assert.deepEqual(showItemFromDescriptor({ kind: "generative", effect: "plasma", seconds: 8, title: "Plasma", shown_at: "now" }), {
    spec: { type: "generative", seconds: 8, kind: "plasma" },
  });
});

test("unavailable history descriptors cannot be replayed", () => {
  assert.equal(showItemFromDescriptor({ kind: "design", design_id: "deleted", unavailable: true }), null);
});

test("design history entries keep a speed/smooth override only when they carry one", () => {
  assert.deepEqual(showItemFromDescriptor({ kind: "design", design_id: "d1", speed: 40, smooth: "off" }), { design_id: "d1", speed: 40, smooth: "off" });
  assert.deepEqual(showItemFromDescriptor({ kind: "design", design_id: "d1", speed: null }), { design_id: "d1", speed: null });
  assert.deepEqual(showItemFromDescriptor({ kind: "design", design_id: "d1", speed: "fast", smooth: "maybe" }), { design_id: "d1" });
});

test("the screen an entry was written to is not part of what is replayed (it goes to iledclock/show as its own slot)", () => {
  assert.deepEqual(showItemFromDescriptor({ kind: "clock", style: 4, color: [0, 255, 0], slot: "b", title: "Clock", shown_at: "now" }), { spec: { type: "clock", style: 4, color: [0, 255, 0] } });
  assert.deepEqual(showItemFromDescriptor({ kind: "design", design_id: "d9", slot: "b" }), { design_id: "d9" });
  assert.deepEqual(showItemFromDescriptor({ kind: "date", color: [1, 2, 3], slot: "a", source: "playlist", duration_s: 10 }), { spec: { type: "date", color: [1, 2, 3], duration_s: 10 } });
});

test("text history keeps its playback, except speeds written before screens existed (old 0-255 scale)", () => {
  assert.deepEqual(showItemFromDescriptor({ kind: "text", text: "Hi", color: [255, 255, 255], speed: 40, smooth: "off", slot: "a" }), {
    spec: { type: "text", text: "Hi", color: [255, 255, 255], speed: 40, smooth: "off" },
  });
  assert.deepEqual(showItemFromDescriptor({ kind: "text", text: "Hi", color: [255, 255, 255], speed: 128 }), { spec: { type: "text", text: "Hi", color: [255, 255, 255] } });
});
