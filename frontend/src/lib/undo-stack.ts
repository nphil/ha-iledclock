/** A generic immutable undo/redo history, used by the studio panel over its own frame list
 * snapshots (each edit -- a stroke, a fill, a timeline reorder -- pushes one new snapshot).
 * Capped so an unbounded editing session can't grow memory forever; the oldest past entries
 * drop first, exactly like every desktop paint program's bounded undo buffer.
 */

export interface History<T> {
  readonly past: readonly T[];
  readonly present: T;
  readonly future: readonly T[];
}

export const DEFAULT_HISTORY_LIMIT = 100;

export function historyInit<T>(present: T): History<T> {
  return { past: [], present, future: [] };
}

/** Records `next` as the new present, pushing the old present onto `past` and discarding
 * `future` (the standard undo/redo rule: any new edit abandons whatever redo branch existed).
 * A no-op push (`next === present` by reference) is dropped rather than recorded, so clicking a
 * tool that happens not to change anything doesn't burn an undo step. */
export function historyPush<T>(history: History<T>, next: T, limit = DEFAULT_HISTORY_LIMIT): History<T> {
  if (next === history.present) return history;
  const past = [...history.past, history.present];
  while (past.length > limit) past.shift();
  return { past, present: next, future: [] };
}

export function historyUndo<T>(history: History<T>): History<T> {
  if (history.past.length === 0) return history;
  const present = history.past[history.past.length - 1];
  return { past: history.past.slice(0, -1), present, future: [history.present, ...history.future] };
}

export function historyRedo<T>(history: History<T>): History<T> {
  if (history.future.length === 0) return history;
  const present = history.future[0];
  return { past: [...history.past, history.present], present, future: history.future.slice(1) };
}
