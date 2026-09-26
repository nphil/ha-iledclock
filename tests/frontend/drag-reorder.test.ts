import { test } from "node:test";
import assert from "node:assert/strict";
import { dragTargetIndex, moveItem, type AxisRect } from "../../frontend/src/lib/drag-reorder.ts";

/** Three stacked 40px-tall rows starting at y=100: row 0 spans [100,140), row 1 [140,180), row 2
 * [180,220). X geometry is irrelevant for a vertical drag. */
const ROWS: AxisRect[] = [
  { left: 0, top: 100, width: 300, height: 40 },
  { left: 0, top: 140, width: 300, height: 40 },
  { left: 0, top: 180, width: 300, height: 40 },
];

test("dragTargetIndex picks the row whose span contains the pointer", () => {
  assert.equal(dragTargetIndex(ROWS, "y", { clientX: 10, clientY: 100 }), 0);
  assert.equal(dragTargetIndex(ROWS, "y", { clientX: 10, clientY: 139 }), 0);
  assert.equal(dragTargetIndex(ROWS, "y", { clientX: 10, clientY: 140 }), 1);
  assert.equal(dragTargetIndex(ROWS, "y", { clientX: 10, clientY: 219 }), 2);
});

test("dragTargetIndex clamps a pointer dragged past either edge of the list", () => {
  assert.equal(dragTargetIndex(ROWS, "y", { clientX: 10, clientY: 5 }), 0);
  assert.equal(dragTargetIndex(ROWS, "y", { clientX: 10, clientY: 900 }), 2);
});

test("dragTargetIndex reads the horizontal axis for a horizontal strip", () => {
  const cells: AxisRect[] = [
    { left: 20, top: 0, width: 96, height: 120 },
    { left: 116, top: 0, width: 96, height: 120 },
  ];
  assert.equal(dragTargetIndex(cells, "x", { clientX: 20, clientY: 60 }), 0);
  assert.equal(dragTargetIndex(cells, "x", { clientX: 116, clientY: 60 }), 1);
  assert.equal(dragTargetIndex(cells, "x", { clientX: 500, clientY: 60 }), 1);
});

test("dragTargetIndex on an empty list reports slot 0 so a drag can never index out of range", () => {
  assert.equal(dragTargetIndex([], "y", { clientX: 0, clientY: 0 }), 0);
});

test("moveItem shifts the items between the two indices back by one when moving forward", () => {
  assert.deepEqual(moveItem(["a", "b", "c", "d"], 0, 2), ["b", "c", "a", "d"]);
});

test("moveItem shifts the items between the two indices forward by one when moving backward", () => {
  assert.deepEqual(moveItem(["a", "b", "c", "d"], 3, 1), ["a", "d", "b", "c"]);
});

test("moveItem leaves the input array untouched and copies on a no-op move", () => {
  const source = ["a", "b", "c"];
  const same = moveItem(source, 1, 1);
  assert.notEqual(same, source);
  assert.deepEqual(same, source);
  assert.deepEqual(moveItem(source, 0, 9), source);
  assert.deepEqual(moveItem(source, -2, 1), source);
});

test("moveItem is the exact inverse of itself for a round trip", () => {
  const moved = moveItem(["a", "b", "c", "d"], 0, 3);
  assert.deepEqual(moveItem(moved, 3, 0), ["a", "b", "c", "d"]);
});
