const WIRE_MIN = 5;
const WIRE_MAX = 255;
const PERCENT_MIN = 1;
const PERCENT_MAX = 100;

function clamp(value: number, min: number, max: number): number {
  return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : min;
}

/** Convert the clock's native brightness byte (5-255) to its user-facing 1-100% range. */
export function brightnessToPercent(wireBrightness: number): number {
  const clamped = clamp(wireBrightness, WIRE_MIN, WIRE_MAX);
  return Math.round(PERCENT_MIN + ((clamped - WIRE_MIN) / (WIRE_MAX - WIRE_MIN)) * (PERCENT_MAX - PERCENT_MIN));
}

/** Convert a user percentage to the clock's native brightness byte for the brightness command. */
export function percentToWireBrightness(percent: number): number {
  const clamped = clamp(percent, PERCENT_MIN, PERCENT_MAX);
  return Math.round(WIRE_MIN + ((clamped - PERCENT_MIN) / (PERCENT_MAX - PERCENT_MIN)) * (WIRE_MAX - WIRE_MIN));
}

/** Convert a HA light's brightness (1-255) to the same 1-100% user range. */
export function haBrightnessToPercent(haBrightness: number): number {
  const clamped = clamp(haBrightness, 1, 255);
  return Math.round(PERCENT_MIN + ((clamped - 1) / 254) * (PERCENT_MAX - PERCENT_MIN));
}

/** Map user 1-100% to HA's 1-255 brightness so the integration maps it back to wire 5-255. */
export function percentToBrightness(percent: number): number {
  const clamped = clamp(percent, PERCENT_MIN, PERCENT_MAX);
  return Math.round(1 + ((clamped - PERCENT_MIN) / (PERCENT_MAX - PERCENT_MIN)) * 254);
}
