import { test } from "node:test";
import assert from "node:assert/strict";
import { isEditorSessionCurrent } from "../../frontend/src/lib/editor-session.ts";

test("async editor actions are valid only for the entry and revision they captured", () => {
  assert.equal(isEditorSessionCurrent("clock-a", 3, "clock-a", 3), true);
  assert.equal(isEditorSessionCurrent("clock-b", 4, "clock-a", 3), false);
  assert.equal(isEditorSessionCurrent("clock-a", 4, "clock-a", 3), false);
  assert.equal(isEditorSessionCurrent(null, 3, "clock-a", 3), false);
});
