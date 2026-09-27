import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createPlaylistItem,
  DEFAULT_PLAYLIST_ITEM_DURATION_S,
  defaultPlaylistItemParams,
  describePlaylistItem,
  playlistItemIcon,
  playlistKindLabel,
} from "../../frontend/src/lib/playlist-item.ts";
import type { PlaylistItem, StoredDesign } from "../../frontend/src/types.ts";

function design(id: string, kind: "image" | "animation", name: string): StoredDesign {
  return { id, name, kind, width: 32, height: 16, frames: [], delays: [], created: 0, updated: 0 };
}

function item(kind: PlaylistItem["kind"], params: Record<string, unknown>): PlaylistItem {
  return { kind, params, duration_s: 10 };
}

const LIBRARY = [design("d1", "image", "Sunset"), design("d2", "animation", "Fire loop")];

test("playlistKindLabel sentence-cases each kind word", () => {
  assert.equal(playlistKindLabel("clock"), "Clock");
  assert.equal(playlistKindLabel("humidity"), "Humidity");
});

test("describePlaylistItem names a known clock face and base colour", () => {
  assert.equal(describePlaylistItem(item("clock", { style: 3, color: [255, 255, 255] })), "Style 3, white");
});

test("describePlaylistItem appends the 12-hour note only when h24 is explicitly off", () => {
  assert.equal(describePlaylistItem(item("clock", { style: 1, color: [255, 0, 0], h24: false })), "Style 1, red, 12-hour");
  assert.equal(describePlaylistItem(item("clock", { style: 1, color: [255, 0, 0], h24: true })), "Style 1, red");
});

test("describePlaylistItem falls back to hex for a colour outside the 8 base colours", () => {
  assert.equal(describePlaylistItem(item("clock", { style: 1, color: [12, 34, 56] })), "Style 1, #0c2238");
});

test("describePlaylistItem degrades a clock item missing its style or colour honestly", () => {
  assert.equal(describePlaylistItem(item("clock", { color: [255, 0, 0] })), "Custom face, red");
  assert.equal(describePlaylistItem(item("clock", {})), "Custom face, custom colour");
});

test("describePlaylistItem quotes the trimmed text and lowercases a named effect", () => {
  assert.equal(describePlaylistItem(item("text", { text: "  Hi  " })), "“Hi”");
  assert.equal(describePlaylistItem(item("text", { text: "Hi", effect: "Rainbow" })), "“Hi”, rainbow");
  assert.equal(describePlaylistItem(item("text", { text: "" })), "No text yet");
});

test("describePlaylistItem resolves a design id to its library name, or says so when absent", () => {
  assert.equal(describePlaylistItem(item("design", { design_id: "d2" }), LIBRARY), "Fire loop");
  assert.equal(describePlaylistItem(item("design", { design_id: "gone" }), LIBRARY), "No design chosen");
});

test("describePlaylistItem names the timer mode and the live-value kinds", () => {
  assert.equal(describePlaylistItem(item("timer", { mode: "stopwatch" })), "Stopwatch");
  assert.equal(describePlaylistItem(item("timer", {})), "Countdown");
  assert.equal(describePlaylistItem(item("scoreboard", {})), "Live scores");
  assert.equal(describePlaylistItem(item("temperature", {})), "Live reading");
  assert.equal(describePlaylistItem(item("humidity", {})), "Live reading");
});

test("playlistItemIcon upgrades a resolved animation design to the gif glyph", () => {
  assert.equal(playlistItemIcon(item("design", { design_id: "d2" }), LIBRARY), "gif");
  assert.equal(playlistItemIcon(item("design", { design_id: "d1" }), LIBRARY), "image");
  assert.equal(playlistItemIcon(item("design", { design_id: "gone" }), LIBRARY), "image");
});

test("playlistItemIcon maps every other kind to its own glyph", () => {
  assert.equal(playlistItemIcon(item("clock", {})), "clock");
  assert.equal(playlistItemIcon(item("date", {})), "clock");
  assert.equal(playlistItemIcon(item("text", {})), "text");
  assert.equal(playlistItemIcon(item("timer", { mode: "stopwatch" })), "stopwatch");
  assert.equal(playlistItemIcon(item("timer", { mode: "countdown" })), "countdown");
  assert.equal(playlistItemIcon(item("scoreboard", {})), "scoreboard");
  assert.equal(playlistItemIcon(item("temperature", {})), "thermometer");
  assert.equal(playlistItemIcon(item("humidity", {})), "humidity");
});

test("defaultPlaylistItemParams carries exactly the keys the integration requires per kind", () => {
  assert.deepEqual(defaultPlaylistItemParams("clock"), { style: 1, color: [255, 255, 255] });
  assert.deepEqual(defaultPlaylistItemParams("date"), { color: [255, 255, 255] });
  assert.deepEqual(defaultPlaylistItemParams("text"), { text: "Hello" });
  assert.deepEqual(defaultPlaylistItemParams("timer"), { mode: "countdown" });
  assert.deepEqual(defaultPlaylistItemParams("scoreboard"), {});
  assert.deepEqual(defaultPlaylistItemParams("temperature"), {});
  assert.deepEqual(defaultPlaylistItemParams("humidity"), {});
});

test("defaultPlaylistItemParams picks the first library design when there is one", () => {
  assert.deepEqual(defaultPlaylistItemParams("design", LIBRARY), { design_id: "d1" });
  assert.deepEqual(defaultPlaylistItemParams("design"), { design_id: "" });
});

test("createPlaylistItem appends the shared default duration alongside the kind defaults", () => {
  const created = createPlaylistItem("clock", LIBRARY);
  assert.equal(created.kind, "clock");
  assert.equal(created.duration_s, DEFAULT_PLAYLIST_ITEM_DURATION_S);
  assert.deepEqual(created.params, { style: 1, color: [255, 255, 255] });
});
