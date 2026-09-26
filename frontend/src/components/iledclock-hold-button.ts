/** Press-and-hold confirm: the touch-safe lock in front of every destructive/overwrite action
 * (the studio's "Send to clock" -- it replaces the whole playlist -- library delete, "confirm
 * all"). A tap does nothing; the accent sweeps in behind the label as the hold charges, a small
 * ring on the left fills in lockstep, and releasing early drains back out instead of firing.
 * `prefers-reduced-motion` keeps the same timing (the state machine in `hold-progress.ts` is
 * unaffected) but swaps the continuous sweep for plain opacity/no transition, per DESIGN.md.
 */

import { LitElement, css, html, nothing, svg, type PropertyValues } from "lit";
import {
  DEFAULT_HOLD_CONFIG,
  HOLD_IDLE,
  holdPress,
  holdProgress,
  holdRelease,
  holdTick,
  type HoldConfig,
  type HoldState,
} from "../lib/hold-progress.ts";
import { fireHaptic } from "../lib/haptics.ts";
import { prefersReducedMotion, TOKENS_CSS } from "../styles/tokens.ts";
import { mdiIcon } from "../lib/mdi-icons.ts";

/** How long the checkmark + `completeLabel` stay up before the button silently resets to idle,
 * ready for another press -- long enough to register as confirmation, short enough not to block
 * a second action if the caller's own state hasn't changed the label yet. */
const SETTLE_MS = 900;

export class IledclockHoldButton extends LitElement {
  static properties = {
    label: { type: String },
    completeLabel: { type: String, attribute: "complete-label" },
    disabled: { type: Boolean },
    danger: { type: Boolean },
    config: { attribute: false },
  };

  declare label: string;
  declare completeLabel: string;
  declare disabled: boolean;
  declare danger: boolean;
  declare config: HoldConfig;

  private _hold: HoldState = HOLD_IDLE;
  private _settled = false;
  private _rafId: number | null = null;
  private _lastTs = 0;
  private _settleTimer: ReturnType<typeof setTimeout> | undefined = undefined;

  constructor() {
    super();
    this.label = "Hold to confirm";
    this.completeLabel = "Done";
    this.disabled = false;
    this.danger = false;
    this.config = DEFAULT_HOLD_CONFIG;
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this._stopLoop();
    clearTimeout(this._settleTimer);
  }

  protected updated(changed: PropertyValues): void {
    if (changed.has("disabled") && this.disabled) this._reset();
  }

  private _reset(): void {
    this._stopLoop();
    this._hold = HOLD_IDLE;
    this._settled = false;
    this.requestUpdate();
  }

  private _stopLoop(): void {
    if (this._rafId !== null) cancelAnimationFrame(this._rafId);
    this._rafId = null;
  }

  private _startLoop(): void {
    if (this._rafId !== null) return;
    this._lastTs = performance.now();
    const step = (ts: number) => {
      const deltaMs = ts - this._lastTs;
      this._lastTs = ts;
      const previousPhase = this._hold.phase;
      this._hold = holdTick(this._hold, deltaMs, this.config);
      this.requestUpdate();
      if (previousPhase === "charging" && this._hold.phase === "completed") this._onCompleted();
      if (this._hold.phase === "idle" || this._hold.phase === "completed") {
        this._rafId = null;
        return;
      }
      this._rafId = requestAnimationFrame(step);
    };
    this._rafId = requestAnimationFrame(step);
  }

  private _onCompleted(): void {
    this._settled = true;
    fireHaptic("success");
    this.dispatchEvent(new CustomEvent("confirmed", { bubbles: true, composed: true }));
    this._settleTimer = setTimeout(() => {
      this._hold = HOLD_IDLE;
      this._settled = false;
      this.requestUpdate();
    }, SETTLE_MS);
  }

  private _onPointerDown = (event: PointerEvent): void => {
    if (this.disabled || this._settled) return;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    event.preventDefault();
    this._hold = holdPress();
    fireHaptic("light");
    this._startLoop();
  };

  private _release(): void {
    if (this._hold.phase !== "charging") return;
    this._hold = holdRelease(this._hold);
    this._startLoop();
  }

  private _onPointerUp = (): void => this._release();
  private _onPointerLeave = (): void => this._release();

  render() {
    const progress = holdProgress(this._hold, this.config);
    const reduced = prefersReducedMotion();
    const showCheck = this._settled;
    return html`
      <button
        type="button"
        class="hold ${this.danger ? "danger" : ""} ${reduced ? "reduced" : ""}"
        ?disabled=${this.disabled}
        aria-label=${showCheck ? this.completeLabel : this.label}
        @pointerdown=${this._onPointerDown}
        @pointerup=${this._onPointerUp}
        @pointercancel=${this._onPointerUp}
        @pointerleave=${this._onPointerLeave}
      >
        <span class="fill" style="transform: scaleX(${progress})"></span>
        <span class="content">
          <span class="ring">
            ${showCheck
              ? mdiIcon("check")
              : svg`<svg viewBox="0 0 24 24" width="20" height="20">
                  <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-opacity="0.25" stroke-width="2.5" />
                  <circle
                    cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2.5"
                    stroke-dasharray=${2 * Math.PI * 9}
                    stroke-dashoffset=${2 * Math.PI * 9 * (1 - progress)}
                    stroke-linecap="round"
                    transform="rotate(-90 12 12)"
                  />
                </svg>`}
          </span>
          <span class="label">${showCheck ? this.completeLabel : this.label}</span>
        </span>
      </button>
    `;
  }

  static styles = [
    TOKENS_CSS,
    css`
    :host {
      display: block;
    }
    .hold {
      position: relative;
      width: 100%;
      min-height: var(--lu-target, 48px);
      border-radius: var(--lu-radius-pill);
      border: 1px solid var(--divider-color);
      background: color-mix(in srgb, var(--primary-text-color) 6%, transparent);
      color: var(--primary-text-color);
      overflow: hidden;
      cursor: pointer;
      padding: 0;
      touch-action: none;
      user-select: none;
      -webkit-user-select: none;
    }
    .hold:disabled {
      opacity: 0.45;
      cursor: default;
    }
    .hold:focus-visible {
      outline: 2px solid var(--lu-accent);
      outline-offset: 2px;
    }
    .fill {
      position: absolute;
      inset: 0;
      background: var(--lu-accent);
      transform-origin: left center;
      transform: scaleX(0);
      pointer-events: none;
    }
    .hold:not(.reduced) .fill {
      transition: transform 60ms linear;
    }
    .hold.danger .fill {
      background: var(--lu-danger);
    }
    .content {
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      padding: 12px 20px;
      font-size: 15px;
      font-weight: 700;
    }
    .ring {
      display: inline-flex;
      color: var(--lu-accent);
      flex: none;
    }
    .hold.danger .ring {
      color: var(--lu-danger);
    }
    `,
  ];
}

customElements.define("iledclock-hold-button", IledclockHoldButton);

declare global {
  interface HTMLElementTagNameMap {
    "iledclock-hold-button": IledclockHoldButton;
  }
}
