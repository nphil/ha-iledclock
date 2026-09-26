/** The alarm/timer-switch repeat bitmask (bit0=Monday .. bit6=Sunday, 0=once/never, 0x7F=every
 * day -- ARCHITECTURE.md Contract D's `RepeatDays`, confirmed by the Integration agent to also
 * cover timer switches now, not just alarms). Centralised here so the settings sheet's day
 * chips and any future repeat-editing UI toggle bits and summarise them identically.
 */

export const DAY_LABELS = ["M", "T", "W", "T", "F", "S", "S"] as const;
export const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
export const EVERY_DAY = 0x7f;
const WEEKDAYS = 0b0011111; // Mon-Fri, bits 0-4

export function isRepeatDayOn(repeat: number, dayIndex: number): boolean {
  return (repeat & (1 << dayIndex)) !== 0;
}

export function toggleRepeatDay(repeat: number, dayIndex: number): number {
  return repeat ^ (1 << dayIndex);
}

/** A short, sentence-case summary for a repeat bitmask -- "Once", "Every day", "Weekdays", or
 * a comma list of the days it's on ("Mon, Wed, Fri"), matching DESIGN.md's ban on eyebrow/
 * middle-dot metadata strings: this always reads as a plain phrase. */
export function repeatSummary(repeat: number): string {
  if (repeat === 0) return "Once";
  if (repeat === EVERY_DAY) return "Every day";
  if (repeat === WEEKDAYS) return "Weekdays";
  const days: string[] = [];
  for (let i = 0; i < 7; i++) if (isRepeatDayOn(repeat, i)) days.push(DAY_NAMES[i]!);
  return days.join(", ");
}
