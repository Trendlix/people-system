// Attendance (not built yet: payroll's worked hours are a month's total HR types on the run). The rules it will follow,
// kept here for the attendance module to find.
// The most hours counted a day (owner, 16 October 2026: "maximum working hours to be recorded per day is 9 hours between
// checkin and check out"): a day counts the time between check-in and check-out, never more than the shift's hours to
// work a day, however long the person stayed. The hours to work are the shift's (owner, 16 October 2026: "my company
// shift is to maintain 9 hours within the shift window, its like flexible shift"): set on the shift, else its whole
// window (payroll.ts shiftWorkHours); they are also the most counted a day, with no separate setting. Payroll warns when
// a month's worked hours typed are more than the most attendance could count (payroll.ts mostCountedHours). Only the
// time within the shift's window counts (owner, 17 October 2026: "i have a window the employee have to fill 9 hours
// within the window"): hoursCountedForDay with shiftWindowOn.

import { shiftWorkHours, type ShiftTimes } from './payroll.js';

/**
 * The most hours attendance counts a day on a shift: its hours to work a day (owner, 16 October 2026: "maximum working
 * hours to be recorded per day is 9 hours between checkin and check out"). Null when the shift's hours can't be told.
 */
export function mostHoursCountedADay(shift: ShiftTimes): number | null {
  return shiftWorkHours(shift);
}

/** A moment as a time in milliseconds; NaN when it isn't one. */
const momentOf = (v: Date | string | number) => (v instanceof Date ? v.getTime() : typeof v === 'number' ? v : Date.parse(v));

/** How far a time zone's clock is ahead of UTC at a moment, in milliseconds (Cairo: +2 hours, +3 in summer time). */
function zoneOffset(moment: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(moment));
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return Date.UTC(part('year'), part('month') - 1, part('day'), part('hour'), part('minute'), part('second')) - moment;
}

/**
 * The moment a day's local time is in a time zone, Cairo by default (its summer time included): "2026-10-18", "09:00" →
 * 2026-10-18T06:00:00Z. NaN when the day or the time isn't one.
 */
export function zonedMoment(day: string, time: string, timeZone = 'Africa/Cairo'): number {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  const t = /^(\d{2}):(\d{2})/.exec(time);
  if (!d || !t) return Number.NaN;
  const asUtc = Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3]), Number(t[1]), Number(t[2]));
  // twice, so a day the clocks change on lands on the right side of the change
  const first = asUtc - zoneOffset(asUtc, timeZone);
  return asUtc - zoneOffset(first, timeZone);
}

/** A shift's window on a day, as moments: its start that day and its end, the next day when it ends past midnight. */
export interface ShiftWindow {
  start: number;
  end: number;
}

/** A shift's window on a day (YYYY-MM-DD, in Cairo): 09:00–19:00 on 18 October; 22:00–06:00 runs into the 19th. */
export function shiftWindowOn(day: string, shift: Pick<ShiftTimes, 'startTime' | 'endTime'>, timeZone = 'Africa/Cairo'): ShiftWindow | null {
  // a shift that starts and ends at the same time has no hours to tell, as shiftHours says too
  if (shift.startTime.slice(0, 5) === shift.endTime.slice(0, 5)) return null;
  const start = zonedMoment(day, shift.startTime, timeZone);
  let end = zonedMoment(day, shift.endTime, timeZone);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (end <= start) {
    const next = new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)) + 1));
    end = zonedMoment(next.toISOString().slice(0, 10), shift.endTime, timeZone);
  }
  return end > start ? { start, end } : null;
}

/**
 * The hours a day counts from a check-in and a check-out (moments: Dates or ISO strings with their offset, so a
 * check-out past midnight is after the check-in): the time between them within the shift's window that day (owner, 17
 * October 2026: "i have a window the employee have to fill 9 hours within the window": coming early or staying late
 * adds nothing; shiftWindowOn; none given: not clipped), in whole minutes, never more than `mostHours` (the shift's:
 * mostHoursCountedADay; null: no shift, not capped), never below 0. 0 when either isn't a moment.
 */
export function hoursCountedForDay(
  checkIn: Date | string,
  checkOut: Date | string,
  mostHours: number | null,
  window: ShiftWindow | null = null,
): number {
  let [from, to] = [momentOf(checkIn), momentOf(checkOut)];
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 0;
  if (window) {
    from = Math.max(from, window.start);
    to = Math.min(to, window.end);
  }
  if (to <= from) return 0;
  // whole minutes: a part minute isn't counted
  const hours = Math.floor((to - from) / 60_000) / 60;
  return typeof mostHours === 'number' && mostHours >= 0 ? Math.min(hours, mostHours) : hours;
}
