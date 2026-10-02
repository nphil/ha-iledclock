/** Keyboard travel for a radio group (WAI-ARIA radio pattern): the arrow keys move to the next enabled option
 * and wrap around, Home and End jump to the first and last enabled one. Returns the index to move to, the
 * current index when nothing else can be reached, or null when the key is not a navigation key at all. */
export function radioTargetIndex(key: string, current: number, enabled: readonly boolean[]): number | null {
  const count = enabled.length;
  if (count === 0) return null;
  let step = 0;
  if (key === "ArrowRight" || key === "ArrowDown") step = 1;
  else if (key === "ArrowLeft" || key === "ArrowUp") step = -1;
  if (step !== 0) {
    for (let offset = 1; offset <= count; offset++) {
      const index = (((current + step * offset) % count) + count) % count;
      if (enabled[index]) return index;
    }
    return current;
  }
  if (key === "Home") {
    const first = enabled.indexOf(true);
    return first < 0 ? current : first;
  }
  if (key === "End") {
    const last = enabled.lastIndexOf(true);
    return last < 0 ? current : last;
  }
  return null;
}
