/** Lucent v1 (Nitin's active design language) — Home Assistant adapter, adopted verbatim from
 * `skill://design-language/languages/lucent/ha.css`. Every component includes `TOKENS_CSS`
 * alongside its own `static styles` (`static styles = [TOKENS_CSS, css\`...\`]`) so colour,
 * radius, shadow and motion all resolve through this one `--lu-*` custom-property surface.
 * Inside Home Assistant the user's HA theme IS the palette: nothing here names a colour of its
 * own, every role is an HA theme variable or a `color-mix` of one, so the card looks native in
 * Neumorphism, default, Liquid Glass, Frosted Glass or any other theme and follows theme
 * switches live. The LED matrix canvas is the one exception -- it shows the clock's true,
 * RGB444-quantised LED colours, never themed (`iledclock-matrix-canvas.ts` reads `color.ts`
 * directly, not these tokens).
 */

import { css } from "lit";

export const TOKENS_CSS = css`
  :host {
    /* host-theme colour roles */
    --lu-accent: var(--primary-color);
    --lu-accent-ink: var(--text-primary-color, #fff);
    --lu-ink: var(--primary-text-color);
    --lu-ink-2: var(--secondary-text-color);
    --lu-ink-3: var(--disabled-text-color, var(--secondary-text-color));
    --lu-positive: var(--success-color, #43a047);
    --lu-warning: var(--warning-color, #ffa600);
    --lu-danger: var(--error-color, #db4437);
    --lu-info: var(--info-color, #039be5);
    --lu-live: var(--error-color, #db4437);

    /* glass levels derived from the theme's own card colour and text colour */
    --lu-card: var(--ha-card-background, var(--card-background-color));
    --lu-edge: var(--ha-card-border-color, var(--divider-color));
    --lu-tile: color-mix(in srgb, var(--primary-text-color) 6%, transparent);
    --lu-glass-raised: color-mix(in srgb, var(--primary-text-color) 12%, transparent);
    --lu-edge-raised: color-mix(in srgb, var(--primary-text-color) 22%, transparent);
    --lu-track-off: color-mix(in srgb, var(--primary-text-color) 16%, transparent);
    --lu-accent-soft: color-mix(in srgb, var(--primary-color) 18%, transparent);
    --lu-scrim: color-mix(in srgb, var(--primary-background-color) 55%, transparent);

    /* shape: concentric with whatever radius the theme gives cards */
    --lu-radius-card: var(--ha-card-border-radius, 24px);
    --lu-radius-tile: max(calc(var(--lu-radius-card) - 4px), 8px);
    --lu-radius-row: max(calc(var(--lu-radius-card) - 6px), 8px);
    --lu-radius-control: max(calc(var(--lu-radius-card) - 10px), 6px);
    --lu-radius-pill: 999px;
    --lu-target: 48px;

    /* material: soft and theme-relative; heavy lift only on raised elements */
    --lu-highlight-raised: inset 0 1px 0 color-mix(in srgb, #fff 18%, transparent);
    --lu-shadow-raised: 0 10px 24px color-mix(in srgb, #000 22%, transparent);
    --lu-shadow-pressed: 0 4px 10px color-mix(in srgb, #000 18%, transparent);

    /* motion and type */
    --lu-ease: cubic-bezier(0.33, 1, 0.68, 1);
    --lu-motion-press: 90ms;
    --lu-motion-focus: 150ms;
    --lu-motion-card: 180ms;
    --lu-motion-layer: 220ms;
    --lu-hold: 1500ms;
    --lu-font: var(--ha-font-family-body, var(--paper-font-body1_-_font-family, inherit));
  }

  @media (prefers-reduced-motion: reduce) {
    :host {
      --lu-motion-focus: 0ms;
      --lu-motion-card: 0ms;
      --lu-motion-layer: 120ms;
    }
  }
`;

/** The hold-to-confirm duration Lucent specifies for destructive/overwrite actions (section 10),
 * shared by `hold-progress.ts`'s state machine and every `iledclock-hold-button` instance so the
 * timing constant lives in exactly one place. */
export const HOLD_TO_CONFIRM_MS = 1500;

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}
