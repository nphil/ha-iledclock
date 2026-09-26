/** HA's own brightness convention: `light.*` entities always carry 1-255 (0 means off, handled
 * by the `on`/`off` state instead), but no user-facing control shows raw 1-255 -- every stock HA
 * brightness slider works in 1-100%. The card's hero corner control and settings sheet both need
 * this exact rounding so a percent typed in one place round-trips to the same percent read back
 * from `hass.states[...].attributes.brightness` after the service call lands.
 */

export function brightnessToPercent(brightness255: number): number {
  return Math.max(1, Math.min(100, Math.round((brightness255 / 255) * 100)));
}

export function percentToBrightness(percent: number): number {
  return Math.max(1, Math.min(255, Math.round((percent / 100) * 255)));
}
