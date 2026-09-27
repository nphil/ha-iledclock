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
