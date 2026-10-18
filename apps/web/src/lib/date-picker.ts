// The mini calendar that opens on every date field (owner, 19 October 2026: "open a date picker in a mini calendar
// when choosing any date"): the dates it shows and moves through. Dates are YYYY-MM-DD; months are a year and a month
// (1–12). Weeks start on Sunday, the first day of the company's working week (shifts work Sunday to Thursday).

/** A day in the month's grid: its date, its day of the month, and whether it is in the month shown. */
export interface GridDay {
  date: string;
  day: number;
  inMonth: boolean;
}

export const WEEKDAY_SHORT = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'] as const;
export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] as const;

const pad = (n: number) => String(n).padStart(2, '0');

/** A year, month and day as YYYY-MM-DD, whatever the month's length (32 January → 1 February). */
export function dateOf(year: number, month: number, day: number): string {
  const d = new Date(Date.UTC(year, month - 1, day));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

const partsOf = (date: string) => ({ year: Number(date.slice(0, 4)), month: Number(date.slice(5, 7)), day: Number(date.slice(8, 10)) });

/** The date `n` days later (earlier when `n` is negative). */
export function addDays(date: string, n: number): string {
  const { year, month, day } = partsOf(date);
  return dateOf(year, month, day + n);
}

/** The same day `n` months later, or the month's last day when it has fewer days (31 January + 1 → 28 February). */
export function addMonthsKeepingDay(date: string, n: number): string {
  const { year, month, day } = partsOf(date);
  const first = new Date(Date.UTC(year, month - 1 + n, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return dateOf(first.getUTCFullYear(), first.getUTCMonth() + 1, Math.min(day, last));
}

/** The month `n` months after `year`/`month`. */
export function shiftMonth(year: number, month: number, n: number): { year: number; month: number } {
  const index = year * 12 + (month - 1) + n;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

/** The six weeks shown for a month, Sunday first: the days before and after it to fill the weeks, marked not in it. */
export function monthGrid(year: number, month: number): GridDay[] {
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  return Array.from({ length: 42 }, (_, i) => {
    const date = dateOf(year, month, 1 - firstWeekday + i);
    return { date, day: Number(date.slice(8, 10)), inMonth: Number(date.slice(5, 7)) === month };
  });
}

/**
 * The twelve years a page of the year view shows around `year`: ten before it and one after (2016–2027 for 2026), as
 * most dates typed are of the past (a birth, a joining) or of this year and the next; ‹ › page by twelve.
 */
export const yearPage = (year: number): number[] => Array.from({ length: 12 }, (_, i) => year - 10 + i);

/** Today in Cairo, as YYYY-MM-DD, whatever the computer's own time zone. */
export function todayInCairo(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** "Sunday, 18 October 2026": a day as a screen reader says it. */
export function spokenDate(date: string): string {
  const { year, month, day } = partsOf(date);
  return `${WEEKDAY_NAMES[new Date(Date.UTC(year, month - 1, day)).getUTCDay()]}, ${day} ${MONTH_NAMES[month - 1]} ${year}`;
}
