/** Lucent structural tokens — HA supplies every colour. LED canvas content remains untinted. */
import { css } from "lit";

export const TOKENS_CSS = css`
  :host {
    /* Home Assistant theme roles */
    --lu-accent: var(--primary-color);
    --lu-accent-ink: var(--text-primary-color, var(--primary-background-color));
    --lu-ink: var(--primary-text-color);
    --lu-ink-2: var(--secondary-text-color);
    --lu-ink-3: var(--disabled-text-color, var(--secondary-text-color));
    --lu-positive: var(--success-color, var(--state-active-color, var(--primary-color)));
    --lu-warning: var(--warning-color, var(--primary-color));
    --lu-danger: var(--error-color, var(--primary-color));
    --lu-info: var(--info-color, var(--primary-color));
    --lu-live: var(--error-color, var(--primary-color));

    /* Theme-derived glass and edges */
    --lu-card: var(--ha-card-background, var(--card-background-color));
    /* Overlays (sheet, toast) are made of what Home Assistant's own dialogs are made of: glass themes make
       --ha-card-background translucent, dialogs stay readable (Lucent LANGUAGE.md, "Surfaces in Home Assistant"). */
    --lu-sheet: var(--ha-dialog-surface-background, var(--mdc-theme-surface, var(--card-background-color)));
    --lu-sheet-blur: var(--ha-dialog-surface-backdrop-filter, none);
    --lu-scrim-blur: var(--ha-dialog-scrim-backdrop-filter, none);
    --lu-edge: var(--ha-card-border-color, var(--divider-color));
    --lu-tile: color-mix(in srgb, var(--primary-text-color) 6%, transparent);
    --lu-glass-raised: color-mix(in srgb, var(--primary-text-color) 12%, transparent);
    --lu-edge-raised: color-mix(in srgb, var(--primary-text-color) 22%, transparent);
    --lu-track-off: color-mix(in srgb, var(--primary-text-color) 16%, transparent);
    --lu-accent-soft: color-mix(in srgb, var(--primary-color) 18%, transparent);
    --lu-scrim: color-mix(in srgb, var(--primary-background-color) 55%, transparent);
    --lu-scrim-top: color-mix(in srgb, var(--primary-background-color) 24%, transparent);
    --lu-scrim-bottom: color-mix(in srgb, var(--primary-background-color) 72%, transparent);
    --lu-blur: 18px;

    /* Eight steps on Lucent's four-pixel spacing grid */
    --lu-space-1: 4px;
    --lu-space-2: 8px;
    --lu-space-3: 12px;
    --lu-space-4: 16px;
    --lu-space-5: 20px;
    --lu-space-6: 24px;
    --lu-space-7: 32px;
    --lu-space-8: 40px;

    /* Radii stay concentric with the user's HA card theme */
    --lu-radius-card: var(--ha-card-border-radius, 24px);
    --lu-radius-sheet: max(var(--lu-radius-card), 28px);
    --lu-radius-tile: max(calc(var(--lu-radius-card) - 4px), 8px);
    --lu-radius-row: max(calc(var(--lu-radius-card) - 6px), 8px);
    --lu-radius-control: max(calc(var(--lu-radius-card) - 10px), 6px);
    --lu-radius-pill: 999px;
    --lu-target: 48px;

    /* Theme-relative lift */
    --lu-highlight-rest: inset 0 1px 0 color-mix(in srgb, var(--primary-text-color) 7%, transparent);
    --lu-highlight-raised: inset 0 1px 0 color-mix(in srgb, var(--primary-text-color) 18%, transparent);
    --lu-shadow-rest: var(--ha-card-box-shadow, 0 24px 60px color-mix(in srgb, var(--primary-text-color) 14%, transparent));
    --lu-shadow-raised: 0 10px 24px color-mix(in srgb, var(--primary-text-color) 22%, transparent);
    --lu-shadow-pressed: 0 4px 10px color-mix(in srgb, var(--primary-text-color) 18%, transparent);

    /* Type roles */
    --lu-type-display: 2.5rem;
    --lu-type-title: 1.125rem;
    --lu-type-body: 0.9375rem;
    --lu-type-label: 0.875rem;
    --lu-type-caption: 0.75rem;
    --lu-type-numeral: 1.25rem;

    /* Feedback and layering motion */
    --lu-ease: cubic-bezier(0.33, 1, 0.68, 1);
    --lu-motion-press: 90ms;
    --lu-motion-label: 120ms;
    --lu-motion-focus: 150ms;
    --lu-motion-card: 180ms;
    --lu-motion-layer: 220ms;
    --lu-motion-scroll: 300ms;
    --lu-hold: 1500ms;
    --lu-font: var(--ha-font-family-body, var(--paper-font-body1_-_font-family, inherit));
  }

  @media (prefers-reduced-motion: reduce) {
    :host {
      --lu-motion-focus: 0ms;
      --lu-motion-card: 0ms;
      --lu-motion-layer: 120ms;
      --lu-motion-scroll: 120ms;
    }
  }
`;

/** Shared Lucent surface classes; component sheets use one fill per group. */
export const SURFACES_CSS = css`
  .lu-sheet,
  .lu-sheet-surface {
    background: var(--lu-card);
    border: 1px solid var(--lu-edge);
    border-radius: var(--lu-radius-sheet);
    box-shadow: var(--lu-highlight-rest), var(--lu-shadow-rest);
  }
  .lu-section,
  .lu-section-surface {
    background: var(--lu-card);
    border: 1px solid var(--lu-edge);
    border-radius: var(--lu-radius-card);
    box-shadow: var(--lu-highlight-rest), var(--lu-shadow-rest);
  }
  .lu-tile,
  .lu-tile-surface {
    background: transparent;
    border: 1px solid var(--lu-edge);
    border-radius: var(--lu-radius-tile);
  }
  .lu-raised,
  .lu-raised-surface {
    background: var(--lu-glass-raised);
    border: 1px solid var(--lu-edge-raised);
    border-radius: var(--lu-radius-tile);
    box-shadow: var(--lu-highlight-raised), var(--lu-shadow-raised);
  }
  .lu-row,
  .lu-row-surface {
    background: transparent;
    border-radius: var(--lu-radius-row);
    border-bottom: 1px solid var(--lu-edge);
  }
  .lu-pill,
  .lu-pill-surface {
    border-radius: var(--lu-radius-pill);
  }
  .lu-chip,
  .lu-chip-surface {
    color: var(--lu-ink-2);
    background: var(--lu-tile);
    border: 1px solid var(--lu-edge);
    border-radius: var(--lu-radius-pill);
  }
  .lu-focus-ring:focus-visible {
    outline: 2px solid var(--lu-accent);
    outline-offset: 2px;
  }
`;

/** The single hold duration used by destructive and overwrite actions. */
export const HOLD_TO_CONFIRM_MS = 1500;

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}
