// Attendance (not built yet: payroll's worked hours are a month's total HR types on the run). The rules it will follow,
// kept here for the attendance module to find.
// The most hours counted a day (owner, 16 October 2026: "maximum working hours to be recorded per day is 9 hours between
// checkin and check out"): a day counts the time between check-in and check-out, never more than the shift's hours to
// work a day, however long the person stayed. The hours to work are the shift's (owner, 16 October 2026: "my company
// shift is to maintain 9 hours within the shift window, its like flexible shift"): set on the shift, else its whole
// window (payroll.ts shiftWorkHours); they are also the most counted a day, with no separate setting. Payroll warns when
// a month's worked hours typed are more than the most attendance could count (payroll.ts mostCountedHours).

import { shiftWorkHours, type ShiftTimes } from './payroll.js';

/**
 * The most hours attendance counts a day on a shift: its hours to work a day (owner, 16 October 2026: "maximum working
 * hours to be recorded per day is 9 hours between checkin and check out"). Null when the shift's hours can't be told.
 */
export function mostHoursCountedADay(shift: ShiftTimes): number | null {
  return shiftWorkHours(shift);
}

/** A moment as a time in milliseconds; NaN when it isn't one. */
const momentOf = (v: Date | string) => (v instanceof Date ? v.getTime() : Date.parse(v));

/**
 * The hours a day counts from a check-in and a check-out (moments: Dates or ISO strings with their offset, so a
 * check-out past midnight is after the check-in): the time between them in whole minutes, never more than `mostHours`
 * (the shift's: mostHoursCountedADay; null: no shift, not capped), never below 0. 0 when either isn't a moment.
 */
export function hoursCountedForDay(checkIn: Date | string, checkOut: Date | string, mostHours: number | null): number {
  const [from, to] = [momentOf(checkIn), momentOf(checkOut)];
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return 0;
  // whole minutes: a part minute isn't counted
  const hours = Math.floor((to - from) / 60_000) / 60;
  return typeof mostHours === 'number' && mostHours >= 0 ? Math.min(hours, mostHours) : hours;
}
