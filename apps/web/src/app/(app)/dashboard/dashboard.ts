import { daysBetween } from '../employees/[id]/contracts/dates';
import { bannerMessage } from '../employees/confirmation';
import { weekdayOf } from '../organization/holidays/holidays';
import { formatDate } from '../../../lib/format';
import type { EmployeeProfile, Holiday } from '../../../lib/types';

// The employee's dashboard (owner, 17 October 2026: "create a dashboard for the employee relevant to his role, and dont
// show him the organization tab, the dashboard may contain the data he might need such as Holidays"): the home page of
// someone who is only an employee and/or a direct manager, in a few cards: Your Job, Upcoming Holidays, My Requests, To
// Do and, for a manager, My Team. This folder holds its parts; it has no page of its own (the dashboard is at /). Pure
// code, tested: how long someone has worked here, the shift's days, the holidays coming up, "in 5 days", and which To Do
// items apply. Relative imports: the tests run without the "@/" alias. Dates are YYYY-MM-DD; today is Cairo's.

const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

function ymd(date: string): [number, number, number] | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/**
 * How long someone has worked here, from their join date to today: "2 years 3 months", "1 year", "5 months"; under a
 * month, the days ("12 days"), and "First day today" on the day they join. A month is counted on the same day of the
 * month, or the month's last day when it is shorter (joined 31/01: a month on 28/02). Null for a join date still to come
 * or one that can't be read.
 */
export function serviceLength(joinDate: string | null, today: string): string | null {
  // a developer gets no join date (owner, 22 October 2026: "Hide per-person details")
  if (!joinDate) return null;
  const from = ymd(joinDate);
  const to = ymd(today);
  if (!from || !to) return null;
  const days = daysBetween(joinDate.slice(0, 10), today.slice(0, 10));
  if (!(days >= 0)) return null;
  const [jy, jm, jd] = from;
  const [ty, tm, td] = to;
  const monthEnd = new Date(Date.UTC(ty, tm, 0)).getUTCDate();
  const months = (ty - jy) * 12 + (tm - jm) - (td < Math.min(jd, monthEnd) ? 1 : 0);
  if (months < 1) return days === 0 ? 'First day today' : plural(days, 'day');
  const years = Math.floor(months / 12);
  const rest = months % 12;
  return [years > 0 && plural(years, 'year'), rest > 0 && plural(rest, 'month')].filter(Boolean).join(' ');
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * A shift's working days (0 = Sunday … 6 = Saturday), with a run of three or more days as a range: "Sun–Thu", "Sat–Wed"
 * (a week starting on Saturday), "Sun, Tue, Thu", "Fri, Sat"; "Every day" for all seven; "" for none.
 */
export function workingDaysText(days: readonly number[]): string {
  const on = new Set(days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6));
  if (on.size === 7) return 'Every day';
  if (on.size === 0) return '';
  // the week read from a day that starts a run (the day before it is off), so a run over Saturday into Sunday is one
  const start = [...on].sort((a, b) => a - b).find((d) => !on.has((d + 6) % 7))!;
  const runs: number[][] = [];
  for (let i = 0; i < 7; i++) {
    const d = (start + i) % 7;
    if (!on.has(d)) continue;
    const last = runs.at(-1);
    if (last && last.at(-1) === (d + 6) % 7) last.push(d);
    else runs.push([d]);
  }
  return runs.map((r) => (r.length >= 3 ? `${DAYS[r[0]]}–${DAYS[r.at(-1)!]}` : r.map((d) => DAYS[d]).join(', '))).join(', ');
}

// ---------- Upcoming Holidays ----------

/** From October, next year's holidays are read too, so the next ones still show near the end of the year. */
export const NEXT_YEAR_FROM_MONTH = 10;

/** How many holidays the card shows. */
export const UPCOMING_HOLIDAYS = 5;

/** The years whose holidays the card reads: this year's, and next year's too from October (NEXT_YEAR_FROM_MONTH). */
export function holidayYears(today: string): number[] {
  const year = Number(today.slice(0, 4));
  return Number(today.slice(5, 7)) >= NEXT_YEAR_FROM_MONTH ? [year, year + 1] : [year];
}

/**
 * A holiday as the card shows it: one day, or days in a row with the same name (each day is a holiday of its own on
 * file, e.g. Eid al-Fitr over three days), from `from` to `to`; `inDays`: how many days until it starts, 0 when it is
 * today or has started.
 */
export interface UpcomingHoliday {
  from: string;
  to: string;
  days: number;
  nameEn: string;
  nameAr: string | null;
  inDays: number;
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * The next official holidays from today (today's included), soonest first, at most `limit`: days in a row with the same
 * English name as one. From the holidays of the years read (holidayYears), in any order.
 */
export function upcomingHolidays(holidays: readonly Holiday[], today: string, limit = UPCOMING_HOLIDAYS): UpcomingHoliday[] {
  const sorted = [...holidays].sort((a, b) => a.date.localeCompare(b.date));
  const runs: UpcomingHoliday[] = [];
  for (const h of sorted) {
    const last = runs.at(-1);
    if (last && sameName(last.nameEn, h.nameEn) && daysBetween(last.to, h.date) === 1) {
      last.to = h.date;
      last.days += 1;
      last.nameAr ??= h.nameAr;
    } else {
      runs.push({ from: h.date, to: h.date, days: 1, nameEn: h.nameEn, nameAr: h.nameAr, inDays: 0 });
    }
  }
  return runs
    .filter((r) => r.to >= today)
    .slice(0, limit)
    .map((r) => ({ ...r, inDays: Math.max(0, daysBetween(today, r.from)) }));
}

/** "Sunday 25/04/2027"; days in a row "Thursday 26/03/2026 – Sunday 29/03/2026". */
export function holidayWhen(h: Pick<UpcomingHoliday, 'from' | 'to'>): string {
  const day = (d: string) => `${weekdayOf(d)} ${formatDate(d)}`;
  return h.from === h.to ? day(h.from) : `${day(h.from)} – ${day(h.to)}`;
}

/** How far off a day is, as its badge says it: "Today", "Tomorrow", "In 5 days"; "Passed" for a day gone by. */
export function inDaysText(days: number): string {
  if (days < 0) return 'Passed';
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  return `In ${days} days`;
}

// ---------- To Do ----------

/**
 * What the employee still has to do, only what applies: confirm their details while they aren't confirmed, or changed
 * since (the words of the banner on every page), and bring the papers HR still needs from them (their profile's
 * completeness, the Documents gaps: read only, as the employee file is HR's).
 */
export type ToDo = { key: 'confirm'; text: string } | { key: 'papers'; papers: string[] };

export function toDoItems(p: Pick<EmployeeProfile, 'confirmation' | 'completeness'>): ToDo[] {
  const items: ToDo[] = [];
  const confirm = bannerMessage(p.confirmation);
  if (confirm) items.push({ key: 'confirm', text: confirm });
  const papers = p.completeness.missing.filter((m) => m.tab === 'documents').map((m) => m.label);
  if (papers.length > 0) items.push({ key: 'papers', papers });
  return items;
}

/** The name to greet them by: the one they go by, else the first of their English name. */
export function greetingName(p: Pick<EmployeeProfile, 'displayName' | 'fullNameEn'>): string {
  return p.displayName?.trim() || p.fullNameEn.trim().split(/\s+/)[0] || p.fullNameEn;
}

// ---------- the owner's design (Figma, 30 October 2026): the greeting, the week's hours ----------

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const dayOf = (iso: string) => new Date(`${iso}T00:00:00Z`);
const isoOf = (d: Date) => d.toISOString().slice(0, 10);

/** The small capitals over the greeting: "Friday · 30 October". */
export function dayEyebrow(today: string): string {
  const d = dayOf(today);
  return `${WEEKDAYS[d.getUTCDay()]} · ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** The hour in Cairo now, 0–23. */
export function cairoHour(now: Date = new Date()): number {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', hour: 'numeric', hourCycle: 'h23' }).format(now));
}

/** Good morning (before noon), Good afternoon (before 5 PM), Good evening. */
export function greetingAt(hour: number): string {
  return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
}

/** The week `today` is in, Sunday to Saturday (the working week here starts on Sunday), as dates; `back` weeks before. */
export function weekOf(today: string, back = 0): string[] {
  const d = dayOf(today);
  const sunday = new Date(d.getTime() - (d.getUTCDay() + 7 * back) * 86_400_000);
  return Array.from({ length: 7 }, (_, i) => isoOf(new Date(sunday.getTime() + i * 86_400_000)));
}

/** The months ("2026-10") some dates fall in, in order. */
export function monthsOf(dates: readonly string[]): string[] {
  return [...new Set(dates.map((d) => d.slice(0, 7)))].sort();
}

/** A day's short name and number: "Sun 25". */
export function shortDay(iso: string): string {
  const d = dayOf(iso);
  return `${WEEKDAYS[d.getUTCDay()].slice(0, 3)} ${d.getUTCDate()}`;
}

/** The hours counted on some dates, up to and with `upTo`, from the month's days (the API's hoursCounted). */
export function hoursOn(days: readonly { date: string; hoursCounted: number }[], dates: readonly string[], upTo: string): Map<string, number> {
  const wanted = new Set(dates.filter((d) => d <= upTo));
  const out = new Map<string, number>();
  for (const day of days) if (wanted.has(day.date)) out.set(day.date, (out.get(day.date) ?? 0) + day.hoursCounted);
  return out;
}

/** The change from last week's hours to this week's so far, in whole tenths of a percent; null without last week's. */
export function weeklyChange(thisWeek: number, lastWeek: number): number | null {
  if (lastWeek <= 0) return null;
  return Math.round(((thisWeek - lastWeek) / lastWeek) * 1000) / 10;
}

/** 35.6 (hours to one decimal); 7h 07m for a day's average. */
export const hoursFigure = (hours: number) => (Math.round(hours * 10) / 10).toString();

export function hoursAndMinutes(hours: number): string {
  const minutes = Math.round(hours * 60);
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
}
