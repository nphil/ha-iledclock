import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildClockRenderSpec,
  buildGenerativeRenderSpec,
  buildTextRenderSpec,
  clampPlaylistDuration,
  commandRequest,
  normalizePlaylist,
  playlistSetRequest,
  reorderPlaylist,
  renderRequest,
  showRequest,
  stateRequest,
  subscribeRequest,
} from "../../frontend/src/lib/ws-api.ts";
import type { PlaylistItem } from "../../frontend/src/types.ts";

test("stateRequest and subscribeRequest carry the exact Contract D message type and entry_id", () => {
  assert.deepEqual(stateRequest("e1"), { type: "iledclock/state", entry_id: "e1" });
  assert.deepEqual(subscribeRequest("e1"), { type: "iledclock/subscribe", entry_id: "e1" });
});

test("commandRequest defaults params to an empty object", () => {
  assert.deepEqual(commandRequest("e1", "brightness"), { type: "iledclock/command", entry_id: "e1", command: "brightness", params: {} });
  assert.deepEqual(commandRequest("e1", "brightness", { level: 80 }), { type: "iledclock/command", entry_id: "e1", command: "brightness", params: { level: 80 } });
});

test("showRequest passes through either a design id or an inline spec unchanged", () => {
  assert.deepEqual(showRequest("e1", { design_id: "d1" }), { type: "iledclock/show", entry_id: "e1", item: { design_id: "d1" } });
  const spec = buildGenerativeRenderSpec("fire", 10);
  assert.deepEqual(showRequest("e1", { spec }), { type: "iledclock/show", entry_id: "e1", item: { spec } });
});

test("renderRequest wraps the entry id and spec verbatim", () => {
  const spec = buildClockRenderSpec(3, [255, 0, 0], true, 41);
  assert.deepEqual(renderRequest("e1", spec), { type: "iledclock/render", entry_id: "e1", spec });
});

test("clampPlaylistDuration bounds into [1, 3600] and rounds", () => {
  assert.equal(clampPlaylistDuration(0), 1);
  assert.equal(clampPlaylistDuration(-5), 1);
  assert.equal(clampPlaylistDuration(4000), 3600);
  assert.equal(clampPlaylistDuration(5.6), 6);
});

test("normalizePlaylist drops unknown kinds, clamps durations and truncates to capabilities max", () => {
  const items: PlaylistItem[] = [
    { kind: "clock", params: {}, duration_s: 0 },
    // @ts-expect-error -- deliberately malformed kind from a stale/foreign payload
    { kind: "bogus", params: {}, duration_s: 10 },
    { kind: "text", params: {}, duration_s: 20 },
    { kind: "design", params: {}, duration_s: 30 },
  ];
  const normalized = normalizePlaylist(items, 2);
  assert.equal(normalized.length, 2);
  assert.deepEqual(normalized.map((i) => i.kind), ["clock", "text"]);
  assert.equal(normalized[0]!.duration_s, 1); // 0 clamped up to the 1s floor
});

test("normalizePlaylist with maxItems 0 empties the playlist", () => {
  const items: PlaylistItem[] = [{ kind: "clock", params: {}, duration_s: 10 }];
  assert.deepEqual(normalizePlaylist(items, 0), []);
});

test("reorderPlaylist moves an item to a new position", () => {
  const items: PlaylistItem[] = [
    { kind: "clock", params: {}, duration_s: 1 },
    { kind: "text", params: {}, duration_s: 2 },
    { kind: "design", params: {}, duration_s: 3 },
  ];
  const reordered = reorderPlaylist(items, 2, 0);
  assert.deepEqual(reordered.map((i) => i.kind), ["design", "clock", "text"]);
});

test("playlistSetRequest carries the normalised playlist verbatim (shaping happens before the call)", () => {
  const playlist: PlaylistItem[] = [{ kind: "clock", params: {}, duration_s: 5 }];
  assert.deepEqual(playlistSetRequest("e1", playlist), { type: "iledclock/playlist/set", entry_id: "e1", playlist });
});

test("buildTextRenderSpec trims whitespace and rejects blank text", () => {
  const spec = buildTextRenderSpec("  hello  ", [255, 255, 255]);
  assert.ok(spec && spec.type === "text");
  assert.equal(spec!.type === "text" ? spec.text : undefined, "hello");
  assert.equal(buildTextRenderSpec("   ", [255, 255, 255]), null);
});

test("buildTextRenderSpec clamps the colour to valid bytes (full precision, not RGB444) and clamps speed", () => {
  const spec = buildTextRenderSpec("hi", [10, 130.6, 999], { speed: 9999 });
  assert.ok(spec && spec.type === "text");
  if (spec && spec.type === "text") {
    assert.deepEqual(spec.color, [10, 131, 255]);
    assert.equal(spec.speed, 255);
  }
});

test("buildGenerativeRenderSpec clamps seconds to at least 1 and passes an integer seed through", () => {
  const spec = buildGenerativeRenderSpec("plasma", 0, 42.9);
  assert.equal(spec.type === "generative" ? spec.seconds : undefined, 1);
  assert.equal(spec.type === "generative" ? spec.seed : undefined, 42);
});

test("buildClockRenderSpec clamps the style index into [1, styleCount]", () => {
  const low = buildClockRenderSpec(0, [255, 255, 255], true, 41);
  const high = buildClockRenderSpec(999, [255, 255, 255], true, 41);
  assert.equal(low.type === "clock" ? low.style : undefined, 1);
  assert.equal(high.type === "clock" ? high.style : undefined, 41);
});
