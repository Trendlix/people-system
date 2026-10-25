// People exempt from check-in (owner, 25 October 2026: "allow me to select people that are not eligable for attendance
// checkins and outs, trat them as if they achived their full working hours"; asked, "Optional check-in" and "Profile + a
// list in Check-in Setup"). HR, Admin and the Super Admin mark someone exempt with a reason, from a day (today unless
// said) and until a day or with no end; a C-level person's only the CEO or a Super Admin, as their other details. Each
// exemption is a dated period of its own (CheckInExemption), so a month always reads the periods that applied to it.
// A working day inside a period (a working day of their shift, not an official holiday, not a day of approved leave,
// within their employment, up to today):
// - counts as full: the shift's hours to work a day (payroll.ts shiftWorkHours), whatever was pressed: never absent,
//   late or short, no missing check-in or check-out, no extra time, no flags; the payroll's attendance and the KPIs'
//   Attendance metric read it full, since both count the attendance days (attendance-days.ts, attendance-import.ts);
// - checking in stays optional: their presses are kept and shown for reference (the place, the pairs), never counted;
//   neither the office network's lock nor the GPS lock refuses them, and no check-in or check-out reminder goes;
// - approved leave (unpaid included) stays leave, and holidays and rest days are as they are.
// The days are read so whenever a month is read (exemptDays), never written: what HR changes counts at once, and an
// exemption whose days would fall in a month whose payroll is with the CEO, approved or paid is refused (approved and
// paid months never change; a run with the CEO would miss it). Adding or ending one refills the drafts of its months.
// Claude's defaults where the owner was silent: periods of one person never overlap; "End now" ends it today (today
// still exempt), and cancels one that hasn't started (kept, never read: only a Super Admin deletes records); someone
// never exempts themself (a Super Admin may); only someone with a current employment, not a freelancer (they don't check
// in), is exempted. Pure: the API enforces these and the web shows the same words. Dates YYYY-MM-DD (Cairo).

import type { SourcedDay } from './attendance-days.js';

/** What the screens call it, its short badge, and its reason's longest. */
export const EXEMPTION_LABEL = 'Exempt from check-in';
export const EXEMPT_BADGE = 'Exempt';
export const EXEMPTION_REASON_MAX = 500;

/** The most people one "Add people" exempts at once. */
export const EXEMPTION_PEOPLE_MAX = 100;

/** What the check-in panel says on an exempt day (owner, 25 October 2026: "Optional check-in"). */
export const EXEMPT_CHECK_IN_TEXT = 'You’re exempt from check-in: your working days count as full hours. Checking in is optional, and your presses are kept for reference only.';

/** A period of exemption: its first day and its last (null: no end). */
export interface ExemptionPeriod {
  startDate: string;
  endDate: string | null;
}

/** Where a period stands on a day: not started, current, or ended. */
export type ExemptionState = 'upcoming' | 'current' | 'ended';

export const EXEMPTION_STATE_LABELS: Record<ExemptionState, string> = { upcoming: 'Upcoming', current: 'Current', ended: 'Ended' };

/** Where a period stands on `today`. */
export function exemptionState(p: ExemptionPeriod, today: string): ExemptionState {
  if (p.startDate > today) return 'upcoming';
  return p.endDate !== null && p.endDate < today ? 'ended' : 'current';
}

/** Whether a day is inside one of the periods. */
export const exemptOn = (date: string, periods: readonly ExemptionPeriod[]): boolean => periods.some((p) => p.startDate <= date && (p.endDate === null || p.endDate >= date));

/** "From 01/11/2026 until 30/11/2026", "From 01/11/2026, no end date". */
export const exemptionWhenText = (p: ExemptionPeriod): string => `From ${shown(p.startDate)}${p.endDate ? ` until ${shown(p.endDate)}` : ', no end date'}`;

/** An exemption as asked: why, from (none: today) and until (none: no end). */
export interface ExemptionInput {
  reason?: string | null;
  startDate?: string | null;
  endDate?: string | null;
}

/**
 * Why an exemption can't be read (none: it can): the reason (required, at most 500 characters), the first day, and the
 * last day (none: no end) on or after the first.
 */
export function exemptionInputProblems(input: ExemptionInput, today: string): string[] {
  const problems: string[] = [];
  const reason = (input.reason ?? '').trim();
  if (!reason) problems.push('Write why they are exempt from check-in, e.g. works at the client’s site all month.');
  else if (reason.length > EXEMPTION_REASON_MAX) problems.push(`Keep the reason to ${EXEMPTION_REASON_MAX} characters; it has ${reason.length}.`);
  const start = blank(input.startDate) ?? today;
  const end = blank(input.endDate);
  if (!isDate(start)) problems.push('Enter the first day of the exemption, e.g. 2026-11-01.');
  if (end !== null && !isDate(end)) problems.push('Enter the last day of the exemption, e.g. 2026-11-30, or leave it empty for no end date.');
  if (isDate(start) && end !== null && isDate(end) && end < start) problems.push("The last day can't be before the first.");
  return problems;
}

/** Whether two periods share a day. */
export const periodsMeet = (a: ExemptionPeriod, b: ExemptionPeriod): boolean => a.startDate <= (b.endDate ?? '9999-12-31') && b.startDate <= (a.endDate ?? '9999-12-31');

/**
 * Why a new period can't be kept beside a person's others (null: it can): it shares a day with one of them. `name`: the
 * person's, as HR is told.
 */
export function exemptionOverlapProblem(period: ExemptionPeriod, others: readonly ExemptionPeriod[], name: string): string | null {
  const other = others.find((o) => periodsMeet(period, o));
  return other ? `${name} is exempt from check-in already, ${exemptionWhenText(other).toLowerCase()}: end that one first, or start this one after it.` : null;
}

/** The months (YYYY-MM) from one day to another (none: the first day's month only). */
export function exemptionMonths(from: string, to: string | null): string[] {
  const out: string[] = [];
  const last = (to ?? from).slice(0, 7);
  for (let m = from.slice(0, 7); m <= last && out.length < 1200; m = nextMonth(m)) out.push(m);
  return out;
}

/** A month whose payroll is with the CEO, approved or paid: its days never change. */
export interface LockedMonth {
  month: string;
  status: string;
}

/** Whether a payroll status keeps a month's days as they are: with the CEO, approved, paid. */
export const locksMonth = (status: string): boolean => status === 'pending_ceo' || status === 'approved' || status === 'paid';

/**
 * Why days from `from` to `to` (null: no end) can't change for an exemption (null: they can): the first month among them
 * whose payroll is with the CEO, approved or paid (owner, 25 October 2026: approved or paid months never change; a run
 * with the CEO would miss the change). `doing`: "start", "end".
 */
export function exemptionLockProblem(from: string, to: string | null, locked: readonly LockedMonth[], doing: 'start' | 'end'): string | null {
  const hit = [...locked].filter((l) => locksMonth(l.status) && l.month >= from.slice(0, 7) && (to === null || l.month <= to.slice(0, 7))).sort((a, b) => a.month.localeCompare(b.month))[0];
  if (!hit) return null;
  const words = hit.status === 'pending_ceo' ? 'is with the CEO' : hit.status === 'paid' ? 'is paid' : 'is approved';
  const after = `${nextMonth(hit.month)}-01`;
  return doing === 'start'
    ? `The ${monthName(hit.month)} payroll ${words}, so its days can't change: start the exemption from ${shown(after)} or later.`
    : `The ${monthName(hit.month)} payroll ${words}, so its days can't change: the exemption can't end before ${shown(lastOfMonth(hit.month))}.`;
}

/** What a month's days are read against for its exemptions. */
export interface ExemptionContext {
  /** YYYY-MM. */
  month: string;
  /** Today in Cairo: the days after it aren't read yet. */
  today: string;
  /** Their shift's working days (0 = Sunday); null: Sunday to Thursday. */
  workingDays: readonly number[] | null;
  holidays: readonly string[];
  /** The days of the month they have approved leave in the system. */
  leaveDays: readonly string[];
  employedFrom: string | null;
  employedTo: string | null;
  /** The shift's hours to work a day (payroll.ts shiftWorkHours): an exempt day's hours; null without a shift: 0. */
  hoursADay: number | null;
}

const SUN_TO_THU: readonly number[] = [0, 1, 2, 3, 4];

/**
 * A person's days of a month with their exemptions (owner, 25 October 2026: "trat them as if they achived their full
 * working hours"): each exempt day (a working day of their shift inside a period, not an official holiday, not a day of
 * approved leave, within their employment, up to today) worked for the shift's hours a day, exempt, without flags,
 * whatever its source said (absent, short, a missing press, Zoho's present without a check-in or its leave not in the
 * system); its presses kept on it for reference (the check-in and check-out, the pairs, the place). A day kept as leave,
 * a holiday or a rest day stays as it is. An exempt day with no day at all is added (source 'system'). In date order.
 */
export function exemptDays<D extends SourcedDay>(days: readonly D[], periods: readonly ExemptionPeriod[], ctx: ExemptionContext): (D | SourcedDay)[] {
  if (!periods.length) return [...days];
  const holidays = new Set(ctx.holidays);
  const leave = new Set(ctx.leaveDays);
  const working = new Set(ctx.workingDays ?? SUN_TO_THU);
  const hours = typeof ctx.hoursADay === 'number' && ctx.hoursADay > 0 ? ctx.hoursADay : 0;
  const exemptDay = (date: string) =>
    date.startsWith(ctx.month) &&
    date <= ctx.today &&
    exemptOn(date, periods) &&
    working.has(new Date(`${date}T00:00:00Z`).getUTCDay()) &&
    !holidays.has(date) &&
    !leave.has(date) &&
    (!ctx.employedFrom || date >= ctx.employedFrom) &&
    (!ctx.employedTo || date <= ctx.employedTo);
  const out: (D | SourcedDay)[] = days.map((d) =>
    exemptDay(d.date) && d.status !== 'leave' && d.status !== 'holiday' && d.status !== 'rest' ? { ...d, status: 'worked', hoursCounted: hours, exempt: true, flags: [] } : d,
  );
  const known = new Set(days.map((d) => d.date));
  for (let date = `${ctx.month}-01`; date.startsWith(ctx.month); date = plusDays(date, 1)) {
    if (known.has(date) || !exemptDay(date)) continue;
    out.push({ date, status: 'worked', checkIn: null, checkOut: null, place: null, zohoStatus: null, permissionHours: 0, hoursCounted: hours, source: 'system', flags: [], exempt: true });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

// ---------- helpers ----------

const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const isDate = (s: unknown): s is string => typeof s === 'string' && DATE.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
const blank = (s: string | null | undefined) => (typeof s === 'string' && s.trim() !== '' ? s.trim() : null);
const plusDays = (ymd: string, n: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const nextMonth = (m: string) => {
  const i = Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7));
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
};
const lastOfMonth = (m: string) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).toISOString().slice(0, 10);
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthName = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
/** A date as messages show it: DD/MM/YYYY. */
const shown = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}`;
