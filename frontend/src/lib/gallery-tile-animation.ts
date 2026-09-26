/** Pure scheduling for the browser grid's tile animation: whether a tile should be showing its
 * live, playing source right now versus a settled single frame. IntersectionObserver visibility
 * flickers during a fast scroll (a tile crosses the viewport edge and back within a frame or
 * two); debouncing that into a stable decision here means a grid component can drive every
 * tracked tile's pending transition from ONE shared interval instead of a timer per tile, and no
 * GIF restarts mid-scroll from a visibility blip that never really settled. `prefers-reduced-
 * motion` is applied at read time (`tileShouldAnimate`), never baked into the schedule itself, so
 * toggling it live doesn't need to touch any tile's pending state.
 */

export interface TileScheduleState {
  /** The settled decision: is this tile currently considered visible? */
  readonly visible: boolean;
  /** The value visibility is transitioning *to*, and when that transition was first observed --
   * `null` once nothing is pending (the settled `visible` already matches reality). */
  readonly pending: { readonly toVisible: boolean; readonly sinceMs: number } | null;
}

export const TILE_SCHEDULE_IDLE: TileScheduleState = { visible: false, pending: null };

/** IntersectionObserver reported a new visibility value for this tile. Confirms silently (clears
 * any pending transition) if it matches what's already settled; a repeat report of the same
 * pending value is a no-op (keeps the original `sinceMs`, so scroll jitter can't keep restarting
 * the settle timer); anything else starts a fresh pending transition from `nowMs`. */
export function tileVisibilityChanged(state: TileScheduleState, visible: boolean, nowMs: number): TileScheduleState {
  if (visible === state.visible) return state.pending === null ? state : { ...state, pending: null };
  if (state.pending?.toVisible === visible) return state;
  return { ...state, pending: { toVisible: visible, sinceMs: nowMs } };
}

/** Advances the schedule: a pending transition that has held for at least `settleMs` becomes the
 * new settled `visible` value. Meant to be called from one shared tick covering every tracked
 * tile, not a per-tile timer. */
export function tileScheduleTick(state: TileScheduleState, nowMs: number, settleMs: number): TileScheduleState {
  if (state.pending === null || nowMs - state.pending.sinceMs < settleMs) return state;
  return { visible: state.pending.toVisible, pending: null };
}

/** Whether a tile should render its live animated source right now: settled visible, the source
 * item is actually animated, and motion hasn't been reduced. Anything else (including a static
 * source item) shows the tile's settled single frame instead of the live source. */
export function tileShouldAnimate(state: TileScheduleState, sourceAnimated: boolean, reducedMotion: boolean): boolean {
  return state.visible && sourceAnimated && !reducedMotion;
}
