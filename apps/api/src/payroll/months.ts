import { addMonths, fromDateOnly } from '../common/date-only.js';

// A payroll month is written YYYY-MM (owner's decisions, 16 October 2026) and kept as its first day.

export const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

const ENGLISH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** The months as the ACH file's sheet names them, as Egypt writes them (the owner's file: مارس 2026). */
const ARABIC = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

const parts = (month: string) => [Number(month.slice(0, 4)), Number(month.slice(5, 7))] as const;

/** The month's first day, YYYY-MM-DD. */
export const firstDay = (month: string) => `${month}-01`;

/** The month's last day, YYYY-MM-DD. */
export function lastDay(month: string): string {
  const [y, m] = parts(month);
  return fromDateOnly(new Date(Date.UTC(y, m, 0)));
}

/** The month `n` months later (earlier when negative). */
export const monthsLater = (month: string, n: number) => addMonths(firstDay(month), n).slice(0, 7);

/** "September 2026". */
export function monthName(month: string): string {
  const [y, m] = parts(month);
  return `${ENGLISH[m - 1]} ${y}`;
}

/** "SEP", as the bank files name the month. */
export const monthShort = (month: string) => ENGLISH[parts(month)[1] - 1].slice(0, 3).toUpperCase();

/** "سبتمبر 2026", the ACH file's sheet name. */
export function monthArabic(month: string): string {
  const [y, m] = parts(month);
  return `${ARABIC[m - 1]} ${y}`;
}
