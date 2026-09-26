/** Pure charge/drain/complete state machine behind every hold-to-confirm control (the studio's
 * "Send to clock" -- it overwrites the playlist -- and the library's "Confirm all"/"Delete").
 * `holdTick` is driven by a `requestAnimationFrame` loop in the button component; every other
 * function here is a plain reducer so the gesture's timing rules are unit-testable without a
 * DOM, a timer, or a pointer event.
 */

export type HoldPhase = "idle" | "charging" | "draining" | "completed";

export interface HoldState {
  readonly phase: HoldPhase;
  /** Milliseconds charged so far (or, while draining, milliseconds still left to drain). */
  readonly elapsedMs: number;
}

export interface HoldConfig {
  /** How long a press must be held to complete. */
  readonly durationMs: number;
  /** How long a full-charge drain-back-to-zero takes on early release; a partial charge drains
   * proportionally faster, so releasing at 20% into the hold doesn't linger for the full drain
   * duration. */
  readonly drainMs: number;
}

export const HOLD_IDLE: HoldState = { phase: "idle", elapsedMs: 0 };
/** Lucent section 10: hold-to-confirm for destructive/overwrite actions is 1500ms. */
export const DEFAULT_HOLD_CONFIG: HoldConfig = { durationMs: 1500, drainMs: 400 };

/** Starts a fresh charge; any prior progress (mid-drain, or a stale completed hold) is
 * discarded. */
export function holdPress(): HoldState {
  return { phase: "charging", elapsedMs: 0 };
}

/** Advances the clock by `deltaMs`. Charging that reaches `config.durationMs` settles into
 * `completed`, clamped there rather than overshooting. Draining that reaches zero settles into
 * `idle`. A no-op from `idle`/`completed`, both resting states with nothing to advance. */
export function holdTick(state: HoldState, deltaMs: number, config: HoldConfig): HoldState {
  if (state.phase === "charging") {
    const elapsedMs = state.elapsedMs + deltaMs;
    if (elapsedMs >= config.durationMs) return { phase: "completed", elapsedMs: config.durationMs };
    return { phase: "charging", elapsedMs };
  }
  if (state.phase === "draining") {
    const elapsedMs = state.elapsedMs - deltaMs;
    if (elapsedMs <= 0) return HOLD_IDLE;
    return { phase: "draining", elapsedMs };
  }
  return state;
}

/** Released before completion: `charging` -> `draining`, capturing wherever the charge had
 * reached so the drain counts back down from there. A no-op from any other phase. */
export function holdRelease(state: HoldState): HoldState {
  if (state.phase !== "charging") return state;
  return { phase: "draining", elapsedMs: state.elapsedMs };
}

/** 0..1 visual fill for the current state. */
export function holdProgress(state: HoldState, config: HoldConfig): number {
  if (state.phase === "completed") return 1;
  if (state.phase === "idle") return 0;
  return Math.max(0, Math.min(1, state.elapsedMs / config.durationMs));
}
