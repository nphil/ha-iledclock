/** Pointer-driven list reordering, shared by every touch drag-to-reorder list in the studio (the
 * frame timeline's thumbnail strip, the playlist editor's row list): press a handle, drag along
 * the list's own axis, and the dragged item swaps live with whichever neighbour it has been
 * dragged past -- the "index-swap-on-drag-over" feel of a native reorderable list, without HTML5
 * drag-and-drop (desktop/mouse-only, no touch support).
 *
 * Deliberately geometry-only: a component measures its own rendered items (via `getBoundingClientRect`
 * on refs it already owns) and re-measures on every `pointermove` -- cheap for the handful of
 * items either list ever holds, and it sidesteps the classic "stale measurement" bug a one-shot
 * measurement-at-drag-start would have once the live preview has already swapped two items and
 * their rendered rects no longer match what was measured before the drag began. `dragTargetIndex`
 * only answers "which currently-rendered slot is the pointer over"; the component owns turning
 * that into a live preview (`moveItem`, for rendering only) and the final committed reorder goes
 * through each domain's own function instead (`timeline.ts`'s `reorderFrame`, `ws-api.ts`'s
 * `reorderPlaylist`) once the gesture ends, since this module has no domain validation to attach.
 */

export type DragAxis = "x" | "y";

/** The rect fields a drag needs -- structurally satisfied by `getBoundingClientRect()`'s
 * `DOMRect`, and trivially constructible in tests without a DOM. */
export interface AxisRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface AxisPointer {
  clientX: number;
  clientY: number;
}

/** Given every currently-rendered item's rect (index == its position in the live render order),
 * the list's drag axis and the pointer's current coordinates, returns which slot the pointer is
 * over: the first rect whose `[start, start + size)` span along `axis` contains the pointer's
 * coordinate, or the nearest end slot if the pointer has been dragged past either edge of the
 * list entirely. Comparisons are against the CURRENT render's own rects (a component re-measures
 * every `pointermove`), so this never has to reason about how many swaps have already happened. */
export function dragTargetIndex(rects: readonly AxisRect[], axis: DragAxis, pointer: AxisPointer): number {
  if (rects.length === 0) return 0;
  const pos = axis === "x" ? pointer.clientX : pointer.clientY;
  for (let i = 0; i < rects.length; i++) {
    const rect = rects[i]!;
    const end = (axis === "x" ? rect.left + rect.width : rect.top + rect.height);
    if (pos < end) return i;
  }
  return rects.length - 1;
}

/** Repositions one item from `fromIndex` to `toIndex`, shifting the items between back or
 * forward by one slot -- the live drag preview a reorderable list renders while a drag is in
 * progress (out-of-range or equal indices are a no-op copy, matching `timeline.ts`'s
 * `reorderFrame` and `ws-api.ts`'s `reorderPlaylist`, which this intentionally mirrors: those
 * remain the source of truth for the final COMMITTED reorder once a drag ends, this is only for
 * what renders in between). */
export function moveItem<T>(items: readonly T[], fromIndex: number, toIndex: number): T[] {
  if (fromIndex === toIndex || fromIndex < 0 || fromIndex >= items.length || toIndex < 0 || toIndex >= items.length) {
    return items.slice();
  }
  const next = items.slice();
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved!);
  return next;
}
