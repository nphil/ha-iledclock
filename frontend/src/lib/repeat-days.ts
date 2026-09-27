/** Alarm/timer-switch repeat bitmask: bit 0 = Monday through bit 6 = Sunday. */
export const DAY_LABELS = ["M", "T", "W", "T", "F", "S", "S"] as const;
export const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
export const EVERY_DAY = 0x7f;
const WEEKDAYS = 0b0011111;

export function isRepeatDayOn(repeat: number, dayIndex: number): boolean {
  return Number.isInteger(dayIndex) && dayIndex >= 0 && dayIndex < 7 && (repeat & (1 << dayIndex)) !== 0;
}

export function toggleRepeatDay(repeat: number, dayIndex: number): number {
  if (!Number.isInteger(dayIndex) || dayIndex < 0 || dayIndex >= 7) return repeat & EVERY_DAY;
  return (repeat ^ (1 << dayIndex)) & EVERY_DAY;
}

export function repeatSummary(repeat: number): string {
  repeat &= EVERY_DAY;
  if (repeat === 0) return "Once";
  if (repeat === EVERY_DAY) return "Every day";
  if (repeat === WEEKDAYS) return "Weekdays";
  const days: string[] = [];
  for (let i = 0; i < 7; i++) if (isRepeatDayOn(repeat, i)) days.push(DAY_NAMES[i]!);
  return days.join(", ");
}
