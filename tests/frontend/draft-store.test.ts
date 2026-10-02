import { test } from "node:test";
import assert from "node:assert/strict";
import { createFrame, setPixel } from "../../frontend/src/lib/grid.ts";
import {
  clearEditorDraft,
  deserializeEditorDraft,
  editorDraftKey,
  editorStateFingerprint,
  isEditorDraftDirty,
  makeEditorDraft,
  readEditorDraft,
  serializeEditorDraft,
  writeEditorDraft,
  type DraftStorage,
} from "../../frontend/src/lib/draft-store.ts";

class MemoryStorage implements DraftStorage {
  readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
  removeItem(key: string): void { this.values.delete(key); }
}

function draftState() {
  const frame = setPixel(createFrame(), 4, 7, [170, 85, 34]);
  return { name: "Orbit", frames: [frame], clockRegion: true };
}

test("draft serialization restores frame pixels, delay, entry and clock-region state", () => {
  const state = { ...draftState(), frames: [{ ...draftState().frames[0]!, durationMs: 230 }] };
  const source = makeEditorDraft("entry/one", state, "baseline", 1234);
  const result = deserializeEditorDraft(serializeEditorDraft(source), "entry/one");
  assert.ok(result);
  assert.equal(result.name, "Orbit");
  assert.equal(result.clockRegion, true);
  assert.equal(result.savedAt, 1234);
  assert.equal(result.frames[0]!.durationMs, 230);
  assert.deepEqual(result.frames[0]!.pixels, state.frames[0]!.pixels);
  assert.equal(deserializeEditorDraft(serializeEditorDraft(source), "entry/two"), null);
});

test("dirty detection compares the saved baseline with current pixels and editor metadata", () => {
  const state = draftState();
  const baseline = editorStateFingerprint(state);
  const clean = makeEditorDraft("entry", state, baseline);
  assert.equal(isEditorDraftDirty(clean), false);
  assert.equal(isEditorDraftDirty(makeEditorDraft("entry", { ...state, name: "Changed" }, baseline)), true);
  assert.equal(isEditorDraftDirty(makeEditorDraft("entry", { ...state, clockRegion: false }, baseline)), true);
  const edited = { ...state, frames: [setPixel(state.frames[0]!, 5, 7, [0, 255, 0])] };
  assert.equal(isEditorDraftDirty(makeEditorDraft("entry", edited, baseline)), true);
});

test("draft storage is scoped per entry and can be cleared", () => {
  const storage = new MemoryStorage();
  const draft = makeEditorDraft("entry/a", draftState(), "baseline");
  assert.equal(writeEditorDraft(storage, draft), true);
  assert.equal(readEditorDraft(storage, "entry/a")?.entryId, "entry/a");
  assert.equal(readEditorDraft(storage, "entry/b"), null);
  assert.equal(clearEditorDraft(storage, "entry/a"), true);
  assert.equal(storage.getItem(editorDraftKey("entry/a")), null);
});

test("quota and storage failures are tolerated without losing the running editor", () => {
  const blocked: DraftStorage = {
    getItem() { throw new Error("unavailable"); },
    setItem() { throw new Error("quota exceeded"); },
    removeItem() { throw new Error("unavailable"); },
  };
  const draft = makeEditorDraft("entry", draftState(), "baseline");
  assert.equal(writeEditorDraft(blocked, draft), false);
  assert.equal(readEditorDraft(blocked, "entry"), null);
  assert.equal(clearEditorDraft(blocked, "entry"), false);
});

test("malformed or unsupported drafts are ignored", () => {
  assert.equal(deserializeEditorDraft("not json"), null);
  const source = makeEditorDraft("entry", draftState(), "baseline");
  const malformed = JSON.parse(serializeEditorDraft(source)) as Record<string, unknown>;
  malformed.version = 99;
  assert.equal(deserializeEditorDraft(JSON.stringify(malformed)), null);
});

test("a speed or smooth change alone makes the draft unsaved, and it survives a reload", () => {
  const state = { ...draftState(), playback: { speed: null, smooth: "off" as const } };
  const baseline = editorStateFingerprint(state);
  assert.equal(isEditorDraftDirty(makeEditorDraft("entry", state, baseline)), false);
  assert.equal(isEditorDraftDirty(makeEditorDraft("entry", { ...state, playback: { speed: 40, smooth: "off" } }, baseline)), true);
  assert.equal(isEditorDraftDirty(makeEditorDraft("entry", { ...state, playback: { speed: 0, smooth: "off" } }, baseline)), true);
  assert.equal(isEditorDraftDirty(makeEditorDraft("entry", { ...state, playback: { speed: null, smooth: "on" } }, baseline)), true);
  assert.equal(isEditorDraftDirty(makeEditorDraft("entry", { ...state, playback: { speed: null, smooth: null } }, baseline)), true);

  const edited = makeEditorDraft("entry", { ...state, playback: { speed: 40, smooth: "on" } }, baseline);
  const restored = deserializeEditorDraft(serializeEditorDraft(edited), "entry");
  assert.ok(restored);
  assert.deepEqual(restored.playback, { speed: 40, smooth: "on" });
  assert.equal(isEditorDraftDirty(restored), true);
});

test("a draft written before Speed existed still loads, with no playback to restore", () => {
  const old = makeEditorDraft("entry", { ...draftState(), name: "Edited" }, editorStateFingerprint(draftState()));
  const raw = JSON.parse(serializeEditorDraft(old)) as Record<string, unknown>;
  assert.equal("playback" in raw, false);
  const restored = deserializeEditorDraft(JSON.stringify(raw), "entry");
  assert.ok(restored);
  assert.equal(restored.playback, undefined);
  assert.equal(isEditorDraftDirty(restored), true);
  assert.equal(isEditorDraftDirty({ ...restored, name: "Orbit" }), false);
});

test("an unreadable playback field is dropped instead of discarding the whole draft", () => {
  const source = makeEditorDraft("entry", { ...draftState(), playback: { speed: 10, smooth: "off" } }, "baseline");
  const raw = JSON.parse(serializeEditorDraft(source)) as Record<string, unknown>;
  for (const bad of [{ speed: 250, smooth: "off" }, { speed: 10, smooth: "maybe" }, "fast", { speed: "10", smooth: null }]) {
    raw.playback = bad;
    const restored = deserializeEditorDraft(JSON.stringify(raw), "entry");
    assert.ok(restored);
    assert.equal(restored.playback, undefined);
  }
});
