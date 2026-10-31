// Flexible days (owner, 31 October 2026, on the employment types: a part-timer's "3 days a week" and an intern's "1 day a
// week" were only printed on the contract, while attendance and payroll took every working day of the shift, so the days
// they weren't meant to work counted as absent; asked, "yes please" to a warning when the contract's days a week and the
// shift's differ, and to a shift worked on any N of its days a week). A shift may say "any 3 of these days" (daysPerWeek
// on the shift, fewer than its working days): a day of the week only counts as absent once the person can no longer
// work their days that week. A week runs Sunday to Saturday. Its days are the shift's working days that week, within the
// employment and not an official holiday; it asks the shift's days a week of them, in proportion for a week with fewer
// (3 of Sunday–Thursday: a week with a holiday asks round(3 × 4 ÷ 5) = 2, a first week from a Wednesday round(3 × 2 ÷ 5) =
// 1). A day worked, on leave or kept as present counts towards them; a day still to come may yet; a day gone by with
// nothing kept (before their first check-in) is taken as done. The absent days left over are the week's latest days gone
// by without a check-in, as many as the week is short; its other days without one are days off (rest, flexOff). So with
// every working day asked (a shift without daysPerWeek) nothing changes. Payroll takes those days off out of the month's
// expected hours as it does no-show and leave days (payroll.ts PayrollInputs.flexDaysOff). Pure: the API, the web and
// the payroll read the same.

import type { AttendanceDayStatus } from './attendance-import.js';

/** A shift's week as these rules read it: its working days (0 = Sunday … 6 = Saturday) and, when flexible, how many of them. */
export interface ShiftWeek {
  workingDays: readonly number[];
  /** Any this many of its working days a week; null or missing: every one of them. */
  daysPerWeek?: number | null;
}

/** Whether a shift is worked on any N of its days a week: N set and fewer than its working days. */
export function isFlexibleDays(shift: ShiftWeek | null | undefined): shift is ShiftWeek & { daysPerWeek: number } {
  return !!shift && typeof shift.daysPerWeek === 'number' && Number.isInteger(shift.daysPerWeek) && shift.daysPerWeek >= 1 && shift.daysPerWeek < new Set(shift.workingDays).size;
}

/** The days a week a shift asks: its N when flexible, else every working day. */
export const shiftDaysAWeek = (shift: ShiftWeek): number => (isFlexibleDays(shift) ? shift.daysPerWeek : new Set(shift.workingDays).size);

const SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/** A shift's days as the screens say them: "Sun, Mon, Tue, Wed, Thu", or "Any 3 of Sun, Mon, Tue, Wed, Thu". */
export function shiftWeekText(shift: ShiftWeek): string {
  const days = [...new Set(shift.workingDays)].sort((a, b) => a - b).map((d) => SHORT[d] ?? String(d)).join(', ');
  return isFlexibleDays(shift) ? `Any ${shift.daysPerWeek} of ${days}` : days;
}

/**
 * Why a shift's days a week can't be saved (null: they can): none (every working day), or a whole number from 1 to one
 * fewer than its working days.
 */
export function flexibleDaysProblem(daysPerWeek: number | null | undefined, workingDays: readonly number[]): string | null {
  if (daysPerWeek === null || daysPerWeek === undefined) return null;
  const most = new Set(workingDays).size - 1;
  if (most < 1) return 'Any days a week needs two working days or more to choose from: tick more working days, or choose every working day.';
  if (!Number.isInteger(daysPerWeek) || daysPerWeek < 1 || daysPerWeek > most) {
    return `Days a week: a whole number from 1 to ${most}, fewer than the ${most + 1} working days ticked, or every working day.`;
  }
  return null;
}

/**
 * The warning on a contract whose days a week differ from its employment's shift (owner, 31 October 2026): attendance and
 * payroll follow the shift, so a contract for 3 days a week on a Sunday–Thursday shift has 2 days a week counted absent.
 * Null when they agree, when the contract leaves its days a week to the shift (null), or without a shift.
 */
export function contractDaysMismatch(contractDays: number | null | undefined, shift: (ShiftWeek & { code: string }) | null | undefined): string | null {
  if (contractDays === null || contractDays === undefined || !shift || !shift.workingDays.length) return null;
  const shiftDays = shiftDaysAWeek(shift);
  if (shiftDays === contractDays) return null;
  return `The contract says ${daysText(contractDays)} a week; shift ${shift.code} asks ${daysText(shiftDays)} (${shiftWeekText(shift)}). Attendance and payroll follow the shift: change the shift, or the contract's days a week.`;
}

const daysText = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`;

/** The days a week asks of `available` of the shift's working days: its N in proportion, rounded, never more than N. */
export function weekAskedDays(daysPerWeek: number, workingDayCount: number, available: number): number {
  if (!(workingDayCount > 0) || !(available > 0)) return 0;
  return Math.min(daysPerWeek, Math.round((daysPerWeek * Math.min(available, workingDayCount)) / workingDayCount));
}

/** A day as these rules read it: its date (YYYY-MM-DD) and status; flexOff once made a day off by them. */
export interface FlexDay {
  date: string;
  status: AttendanceDayStatus;
  flexOff?: boolean;
}

/** What a person's weeks are read with besides their days. Dates: YYYY-MM-DD. */
export interface FlexWeekContext {
  /** The shift: its working days and any N of them. */
  shift: ShiftWeek;
  holidays: readonly string[];
  /** Their employment's first and last day (null: current, or not known). */
  employedFrom: string | null;
  employedTo: string | null;
  /** Today in Cairo: today and the days after it may still be worked. */
  today: string;
}

/** The statuses that count towards a week's days: worked, kept as present, or on leave. */
const COUNTS: ReadonlySet<AttendanceDayStatus> = new Set(['worked', 'no_check_in', 'leave', 'zoho_leave']);

const DAY_MS = 86_400_000;
const shift = (ymd: string, n: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
const weekdayOf = (ymd: string) => new Date(`${ymd}T00:00:00Z`).getUTCDay();
/** The Sunday a date's week starts on. */
export const flexWeekStart = (ymd: string) => shift(ymd, -weekdayOf(ymd));

/**
 * A person's days with the flexible days rule applied (see the top of this file): each week any of `days` falls in is
 * read with `around` too (the days of the same weeks in the months next to it, as kept, without this rule), and its
 * absent days the week doesn't need become days off (status rest, flexOff), the latest kept absent. Only `days` are
 * returned, in their order; a shift that isn't flexible returns them as they are.
 */
export function flexibleWeeks<D extends FlexDay>(days: readonly D[], ctx: FlexWeekContext, around: readonly FlexDay[] = []): D[] {
  if (!isFlexibleDays(ctx.shift) || !days.length) return [...days];
  const asked = ctx.shift.daysPerWeek;
  const working = new Set(ctx.shift.workingDays);
  const holidays = new Set(ctx.holidays);
  const byDate = new Map<string, FlexDay>();
  for (const d of around) byDate.set(d.date, d);
  for (const d of days) byDate.set(d.date, d);
  const off = new Set<string>();
  for (const start of new Set(days.map((d) => flexWeekStart(d.date)))) {
    const pool: string[] = [];
    for (let i = 0; i < 7; i++) {
      const date = shift(start, i);
      if (!working.has(i) || holidays.has(date)) continue;
      if ((ctx.employedFrom && date < ctx.employedFrom) || (ctx.employedTo && date > ctx.employedTo)) continue;
      pool.push(date);
    }
    let done = 0;
    const absent: string[] = [];
    for (const date of pool) {
      const day = byDate.get(date);
      if (day && COUNTS.has(day.status)) done++;
      // still to come, or gone by with nothing kept (before their first check-in): may be, or taken as, worked
      else if (date >= ctx.today || !day) done++;
      else if (day.status === 'absent') absent.push(date);
    }
    const short = Math.max(0, weekAskedDays(asked, working.size, pool.length) - done);
    // the latest days gone by without a check-in stay absent, as many as the week is short; the others are days off
    for (const date of absent.slice(0, Math.max(0, absent.length - short))) off.add(date);
  }
  return days.map((d) => (off.has(d.date) && d.status === 'absent' ? { ...d, status: 'rest' as const, flexOff: true } : d));
}

/** The months (YYYY-MM) next to `month` that share a week with it: the one before when it doesn't start on a Sunday, the one after when it doesn't end on a Saturday. */
export function flexNeighbourMonths(month: string): { before: string | null; after: string | null } {
  const first = `${month}-01`;
  const [y, m] = [Number(month.slice(0, 4)), Number(month.slice(5, 7))];
  const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const prev = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
  const next = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);
  return { before: weekdayOf(first) === 0 ? null : prev, after: weekdayOf(last) === 6 ? null : next };
}
