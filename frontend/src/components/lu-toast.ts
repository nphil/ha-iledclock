import { LitElement, css, html } from "lit";
import { SURFACES_CSS, TOKENS_CSS } from "../styles/tokens.ts";
import "./lu-icon-button.ts";
import "./lu-pill-button.ts";

export interface LuToastRequest {
  message: string;
  actionLabel?: string;
  action?: () => void | Promise<void>;
  timeoutMs?: number;
}

export class LuToast extends LitElement {
  static properties = {
    _current: { state: true },
    _queue: { state: true },
  };

  declare _current: LuToastRequest | null;
  declare _queue: LuToastRequest[];

  private _timer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    super();
    this._current = null;
    this._queue = [];
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    clearTimeout(this._timer);
  }

  enqueue(request: LuToastRequest): void {
    if (!request.message) return;
    if (!this._current) {
      this._show(request);
      return;
    }
    this._queue = [...this._queue, request];
  }

  private _show(request: LuToastRequest): void {
    clearTimeout(this._timer);
    this._current = request;
    const timeout = request.timeoutMs ?? 5000;
    if (timeout > 0) this._timer = setTimeout(() => this._dismiss(), timeout);
  }

  private _dismiss(): void {
    clearTimeout(this._timer);
    this._timer = undefined;
    this._current = null;
    const [next, ...rest] = this._queue;
    this._queue = rest;
    if (next) this._show(next);
  }

  private _runAction = (): void => {
    const action = this._current?.action;
    if (!action) return;
    void action();
    this._dismiss();
  };

  render() {
    const current = this._current;
    if (!current) return html``;
    return html`<div class="toast" role="status" aria-live="polite" aria-atomic="true">
      <span class="message">${current.message}</span>
      ${current.actionLabel && current.action ? html`<lu-pill-button class="action" variant="quiet" .label=${current.actionLabel} @lu-press=${this._runAction}></lu-pill-button>` : ""}
      <lu-icon-button icon="mdi:close" tooltip="Dismiss" aria-label="Dismiss notification" @lu-press=${this._dismiss}></lu-icon-button>
    </div>`;
  }

  static styles = [TOKENS_CSS, SURFACES_CSS, css`
    :host { container-type: inline-size; display: block; pointer-events: none; }
    .toast { position: fixed; z-index: 1100; left: max(var(--lu-space-4), env(safe-area-inset-left)); right: max(var(--lu-space-4), env(safe-area-inset-right)); bottom: calc(var(--lu-space-4) + env(safe-area-inset-bottom)); display: flex; align-items: center; justify-content: space-between; gap: var(--lu-space-3); width: auto; max-width: 560px; box-sizing: border-box; margin: 0 auto; padding: var(--lu-space-2) var(--lu-space-3); color: var(--lu-ink); background: var(--lu-sheet); backdrop-filter: var(--lu-sheet-blur); border: 1px solid var(--lu-edge); border-radius: var(--lu-radius-pill); box-shadow: var(--lu-highlight-rest), var(--lu-shadow-rest); pointer-events: auto; }
    .message { min-width: 0; overflow-wrap: anywhere; font: 500 var(--lu-type-label)/1.4 var(--lu-font); }
    .action { color: var(--lu-accent); }
    :host([mobile]) .toast { bottom: calc(64px + var(--lu-space-4) + env(safe-area-inset-bottom)); }
  `];
}

customElements.define("lu-toast", LuToast);

declare global { interface HTMLElementTagNameMap { "lu-toast": LuToast; } }
