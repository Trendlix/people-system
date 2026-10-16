import { shiftDaysIn, shiftExpectedHours, shiftWorkHours } from '@trendlix/shared';
import { parseDate } from '../../../../lib/format';
import type { Holiday } from '../../../../lib/types';

// Organization → Holidays (owner, 16 October 2026: "make holiday a separate tab"; it was a section of Payroll Setup):
// the year's official holidays, and each shift's working days they come out of for a run's expected hours. Pure code,
// tested: the year in the address, a holiday's form read into what the API takes, and the working days. Relative
// imports: the tests run without the "@/" alias.

const text = (fd: FormData, key: string) => String(fd.get(key) ?? '');
const pad = (n: number) => String(n).padStart(2, '0');

/** The years a holiday can be in (the API's). */
export const HOLIDAY_YEARS = { from: 2000, to: 2100 } as const;

/** The year the holidays are shown for: the address's (?year=2027) when it is one, else this year. */
export function holidaysYear(asked: string | string[] | undefined, today: string): number {
  const typed = Array.isArray(asked) ? asked[0] : asked;
  const year = /^\d{4}$/.test(typed ?? '') ? Number(typed) : NaN;
  return year >= HOLIDAY_YEARS.from && year <= HOLIDAY_YEARS.to ? year : Number(today.slice(0, 4));
}

/** The Holidays tab for a year: the year before or after it, or the one an old Payroll Setup link asked for. */
export const holidaysHref = (year?: number) => (year === undefined ? '/organization/holidays' : `/organization/holidays?year=${year}`);

/** What POST and PATCH /payroll/holidays take. */
export interface HolidayBody {
  date: string;
  nameEn: string;
  nameAr: string | null;
}

/**
 * A holiday's form as the API takes it, and what is wrong with it: the day typed DD/MM/YYYY, its name in English, its
 * name in Arabic if any (empty: none).
 */
export function holidayBody(fd: FormData): { body: HolidayBody; errors: string[] } {
  const errors: string[] = [];
  const typedDate = text(fd, 'date');
  const date = parseDate(typedDate);
  if (!date) errors.push('Enter the date as DD/MM/YYYY, e.g. 25/04/2027.');
  else if (Number(date.slice(0, 4)) < HOLIDAY_YEARS.from || Number(date.slice(0, 4)) > HOLIDAY_YEARS.to) {
    errors.push(`Enter a date from ${HOLIDAY_YEARS.from} to ${HOLIDAY_YEARS.to}.`);
  }
  const nameEn = text(fd, 'nameEn').trim();
  if (!nameEn) errors.push("Enter the holiday's name in English.");
  const nameAr = text(fd, 'nameAr').trim();
  if (nameEn.length > 100 || nameAr.length > 100) errors.push('Keep each name to 100 characters or fewer.');
  return { body: { date: date || typedDate, nameEn, nameAr: nameAr || null }, errors };
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** A day's weekday: "2027-04-25" → "Sunday". */
export const weekdayOf = (date: string) => WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()] ?? '';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** A shift as the Working Days table reads it: its times, its hours to work a day (null: the whole window), its days. */
export interface WorkingShift {
  code: string;
  startTime: string;
  endTime: string;
  hoursPerDay?: number | null;
  workingDays: readonly number[];
}

/** One month of the Working Days table: each shift's working days, the holidays on them, and the hours they come to. */
export interface WorkingMonth {
  month: string;
  name: string;
  /** In the shifts' order; `hours` null when the shift's hours can't be told. */
  shifts: { code: string; workingDays: number; holidays: number; hours: number | null }[];
}

/**
 * Each month of a year with each shift's working days in it, the holidays on them and the expected hours they come to:
 * what a run expects of someone on that shift employed all month (owner's request, 16 October 2026), worked out as the
 * API works it out (packages/shared payroll.ts), at the shift's hours to work a day, else its window (owner, 16 October
 * 2026: "my company shift is to maintain 9 hours within the shift window").
 */
export function workingMonths(year: number, shifts: readonly WorkingShift[], holidays: readonly Pick<Holiday, 'date'>[]): WorkingMonth[] {
  const days = holidays.map((h) => h.date);
  return MONTHS.map((name, i) => {
    const month = `${year}-${pad(i + 1)}`;
    return {
      month,
      name,
      shifts: shifts.map((s) => {
        // as if employed the whole month
        const counted = shiftDaysIn(month, `${month}-01`, null, s.workingDays, days);
        const perDay = shiftWorkHours(s);
        return { code: s.code, ...counted, hours: perDay === null ? null : shiftExpectedHours(counted, perDay) };
      }),
    };
  });
}
