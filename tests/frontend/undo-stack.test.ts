import { test } from "node:test";
import assert from "node:assert/strict";
import { historyInit, historyPush, historyRedo, historyUndo } from "../../frontend/src/lib/undo-stack.ts";

test("historyUndo/historyRedo walk back and forward through pushed states", () => {
  let history = historyInit("a");
  history = historyPush(history, "b");
  history = historyPush(history, "c");
  assert.equal(history.present, "c");

  history = historyUndo(history);
  assert.equal(history.present, "b");
  history = historyUndo(history);
  assert.equal(history.present, "a");

  history = historyRedo(history);
  assert.equal(history.present, "b");
  history = historyRedo(history);
  assert.equal(history.present, "c");
});

test("historyUndo past the start is a no-op", () => {
  const history = historyInit("only");
  assert.equal(historyUndo(history), history);
});

test("historyRedo past the end is a no-op", () => {
  const history = historyPush(historyInit("a"), "b");
  assert.equal(historyRedo(history), history);
});

test("a new push after undo discards the abandoned redo branch", () => {
  let history = historyInit("a");
  history = historyPush(history, "b");
  history = historyPush(history, "c");
  history = historyUndo(history); // present: b, future: [c]
  history = historyPush(history, "d"); // abandons c
  assert.equal(history.present, "d");
  assert.equal(history.future.length, 0);
  history = historyUndo(history);
  assert.equal(history.present, "b"); // c is gone, not reachable by redo either
});

test("pushing the same reference as the current present is a no-op", () => {
  const history = historyInit("a");
  const value = { n: 1 };
  const pushed = historyPush(history, value);
  const pushedAgain = historyPush(pushed, value);
  assert.equal(pushedAgain, pushed);
  assert.equal(pushedAgain.past.length, 1);
});

test("history is capped: the oldest past entries drop once the limit is exceeded", () => {
  let history = historyInit(0);
  for (let i = 1; i <= 5; i++) history = historyPush(history, i, 3);
  assert.equal(history.present, 5);
  assert.equal(history.past.length, 3);
  assert.deepEqual(history.past, [2, 3, 4]); // 0 and 1 fell off the front
});
