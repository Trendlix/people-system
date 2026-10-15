import { ValidateBy } from 'class-validator';

// PostgreSQL `date` columns come through Prisma as Dates at midnight UTC.
// These helpers convert between that and "YYYY-MM-DD" strings, which is what the API sends and accepts.

export const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export function toDateOnly(ymd: string): Date {
  return new Date(`${ymd}T00:00:00.000Z`);
}

export function fromDateOnly(value: Date): string;
export function fromDateOnly(value: Date | null): string | null;
export function fromDateOnly(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

/** True for a real calendar date written as YYYY-MM-DD (so 2026-02-30 is refused). */
export function isDateOnly(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE_ONLY.test(value)) return false;
  const date = toDateOnly(value);
  return !Number.isNaN(date.getTime()) && fromDateOnly(date) === value;
}

/** The same day `months` later; the 31st becomes the last day of a shorter month. */
export function addMonths(ymd: string, months: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const lastDay = new Date(Date.UTC(y, m - 1 + months + 1, 0)).getUTCDate();
  return fromDateOnly(new Date(Date.UTC(y, m - 1 + months, Math.min(d, lastDay))));
}

/** The day `days` later (or earlier, when negative). */
export function addDays(ymd: string, days: number): string {
  const date = toDateOnly(ymd);
  date.setUTCDate(date.getUTCDate() + days);
  return fromDateOnly(date);
}

/** The day of the week: 0 = Sunday … 6 = Saturday. */
export function weekday(ymd: string): number {
  return toDateOnly(ymd).getUTCDay();
}

/** A date as messages show it: DD/MM/YYYY (README: every date on screen is DD/MM/YYYY). */
export function shownDate(ymd: string): string {
  const [y, m, d] = ymd.split('-');
  return `${d}/${m}/${y}`;
}

/** Today in Cairo, as YYYY-MM-DD. */
export function todayInCairo(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date());
}

/** Validator for a YYYY-MM-DD date field. */
export const IsDateOnly = (message: string) =>
  ValidateBy({ name: 'isDateOnly', validator: { validate: isDateOnly, defaultMessage: () => message } });
