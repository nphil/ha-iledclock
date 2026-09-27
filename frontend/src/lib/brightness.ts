/** HA's own brightness convention: light.* entities store brightness as 1-255; user controls use 1-100%. */
export function brightnessToPercent(brightness255: number): number {
  if (!Number.isFinite(brightness255)) return 1;
  return Math.max(1, Math.min(100, Math.round((brightness255 / 255) * 100)));
}

export function percentToBrightness(percent: number): number {
  if (!Number.isFinite(percent)) return 1;
  return Math.max(1, Math.min(255, Math.round((percent / 100) * 255)));
}
