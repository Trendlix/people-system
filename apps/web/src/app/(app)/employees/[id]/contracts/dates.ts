import type { NoticeUnit } from '@trendlix/shared';
import { NOTICE_UNIT_LABELS } from '@trendlix/shared';

// The dates the contract and ending forms preview while HR types: a contract's end, the probation end, and the last
// working day after a notice. Dates are YYYY-MM-DD, as the API sends them, counted in whole days (no time zone). The
// API works the same dates out again when it saves, and its answer is the one kept.

const pad = (n: number) => String(n).padStart(2, '0');
const DAY = 86_400_000;

function parts(ymd: string): [number, number, number] {
  const [y, m, d] = ymd.split('-').map(Number);
  return [y, m, d];
}

function ymdOf(date: Date): string {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

/** A date plus some days (fewer when negative): 2026-10-15 + 14 → 2026-10-29. */
export function addDays(ymd: string, days: number): string {
  const [y, m, d] = parts(ymd);
  return ymdOf(new Date(Date.UTC(y, m - 1, d + days)));
}

/**
 * A date plus some months, on the same day of the month, or the month's last day when it is shorter (31/01 + 1 month
 * = 28/02, or 29/02 in a leap year). The API counts months the same way (e.g. the join date + 3 months of probation).
 */
export function addMonths(ymd: string, months: number): string {
  const [y, m, d] = parts(ymd);
  const lastDay = new Date(Date.UTC(y, m - 1 + months + 1, 0)).getUTCDate();
  return ymdOf(new Date(Date.UTC(y, m - 1 + months, Math.min(d, lastDay))));
}

/** Whole days from one date to another: negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = parts(from);
  const [ty, tm, td] = parts(to);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / DAY);
}

/**
 * The last day of a fixed-term contract: the day before the same date that many months later, so a 12-month contract
 * from 01/11/2026 ends on 31/10/2027 and its renewal starts on 01/11/2027.
 */
export function contractEnd(start: string, months: number): string {
  return addDays(addMonths(start, months), -1);
}

/**
 * When a contract's probation ends, counted like its term: the day before the same date that many months later, so 3
 * months from 15/10/2026 end on 14/01/2027. Null without probation.
 */
export function probationEnd(start: string, months: number): string | null {
  return months > 0 ? addDays(addMonths(start, months), -1) : null;
}

/** The days of the working week when the employee has no shift: Sunday to Thursday (0 = Sunday … 6 = Saturday). */
export const SUN_TO_THU: readonly number[] = [0, 1, 2, 3, 4];

/** The working day that many working days after a date (the date itself not counted), in a Sun–Thu week by default. */
export function addWorkingDays(ymd: string, count: number, week: readonly number[] = SUN_TO_THU): string {
  if (week.length === 0) throw new Error('A working week needs at least one day.');
  const [y, m, d] = parts(ymd);
  const date = new Date(Date.UTC(y, m - 1, d));
  let left = count;
  while (left > 0) {
    date.setUTCDate(date.getUTCDate() + 1);
    if (week.includes(date.getUTCDay())) left -= 1;
  }
  return ymdOf(date);
}

/**
 * The last working day after a notice given (or received) on a date: the date + the notice in days, weeks or months.
 * Working days are counted Sun–Thu, while the API follows the employee's shift, so that day is `approximate`. Without
 * notice, it is the date itself.
 */
export function noticeLastDay(given: string, amount: number, unit: NoticeUnit): { date: string; approximate: boolean } {
  if (amount <= 0) return { date: given, approximate: false };
  switch (unit) {
    case 'days':
      return { date: addDays(given, amount), approximate: false };
    case 'weeks':
      return { date: addDays(given, amount * 7), approximate: false };
    case 'months':
      return { date: addMonths(given, amount), approximate: false };
    case 'working_days':
      return { date: addWorkingDays(given, amount), approximate: true };
  }
}

/** "3 months", "1 month", "45 working days", "No notice". */
export function noticeLabel(amount: number, unit: NoticeUnit): string {
  if (amount <= 0) return 'No notice';
  const words = NOTICE_UNIT_LABELS[unit];
  return `${amount} ${amount === 1 ? words.replace(/s$/, '') : words}`;
}

/** "12 days", "1 day". */
export function daysLabel(days: number): string {
  return `${days} ${days === 1 ? 'day' : 'days'}`;
}
