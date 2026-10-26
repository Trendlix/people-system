// Compensatory days (owner, 26 October 2026: "is there compensatory leaves in the system?"; then "my compensatory is a
// compensation with another day in the same month. and rarely to be compensated in cash"). Someone who worked a rest day
// of their shift or an official holiday asks for another day off in the same calendar month, before or after it. Like
// working from home it is a request of its own, not leave (no balance), decided "Manager, then HR" (the approver in
// charge, then HR; a C-level person's HR stage the CEO's: leave/access.ts), and HR's decision is one of:
// - approve as a day off (the default): the day off shows "Compensatory day off" in the attendance and counts as a full
//   paid day (never a no-show, never short hours), the draft payroll is filled again;
// - approve as cash instead (rarely): an addition "Compensation for working DD/MM/YYYY" of 1.5 days' pay on the draft
//   payroll of the month ("if paid in cash make it 1.5"; the labour law gives double pay for working an official holiday
//   paid in cash), the rate a Leave Setup setting; and then there is no day off;
// - reject, with a comment.
// "if the day is compensated with a day, we pay nothing" (owner, 26 October 2026): a day off adds no money anywhere. The
// day worked adds no pay, hours or overtime (its hours are left out of the month's worked hours), and only "cash
// instead" adds the addition. Pure: the API enforces these and the web shows the same checks live. Dates are YYYY-MM-DD.

import type { SourcedDay } from './attendance-days.js';
import { LEAVE_STEP_KIND_LABELS, LEAVE_STEP_KINDS } from './leaves.js';

/** What the screens call the request, and the day off once approved. */
export const COMPENSATORY_LABEL = 'Compensatory day';
export const COMPENSATORY_DAY_OFF_LABEL = 'Compensatory day off';
export const COMPENSATORY_LABEL_AR = 'يوم تعويضي';

/** HR's decision on approving: a day off (the default), or cash instead. */
export const COMPENSATORY_OUTCOMES = ['day_off', 'cash'] as const;
export type CompensatoryOutcome = (typeof COMPENSATORY_OUTCOMES)[number];
export const COMPENSATORY_OUTCOME_LABELS: Record<CompensatoryOutcome, string> = { day_off: 'Day off', cash: 'Cash instead' };

/** The steps logged on a request: leave's (sent, straight to HR, recorded by HR, each stage, cancelled). */
export const COMPENSATORY_STEP_KINDS = LEAVE_STEP_KINDS;
export const COMPENSATORY_STEP_KIND_LABELS = LEAVE_STEP_KIND_LABELS;

/**
 * Cash instead is paid at this many days' pay (owner, 26 October 2026: "if paid in cash make it 1.5"), whether the day
 * worked was a rest day or an official holiday: a Leave Setup setting, in whole or half days (the addition is in days,
 * payroll-adjustments.ts bonus_days).
 */
export const COMPENSATORY_CASH_RATE_DEFAULT = 1.5;
export const COMPENSATORY_CASH_RATE_MAX = 5;
export const COMPENSATORY_CASH_HINT = 'The labour law gives double pay for working an official holiday paid in cash.';

/** Why the Leave Setup's cash rate can't be saved (none: it can): half days from 0.5 to 5. */
export function compensatoryRateProblems(rate: unknown): string[] {
  if (typeof rate !== 'number' || !Number.isFinite(rate) || !Number.isInteger(rate * 2) || rate < 0.5 || rate > COMPENSATORY_CASH_RATE_MAX) {
    return [`Enter the days' pay for cash instead in whole or half days from 0.5 to ${COMPENSATORY_CASH_RATE_MAX}, e.g. 1.5.`];
  }
  return [];
}

/** The reason of the cash addition on the payroll: "Compensation for working 07/11/2026". */
export const compensatoryCashReason = (dayWorked: string): string => `Compensation for working ${shown(dayWorked)}`;

/** The month (YYYY-MM) a day is counted in. */
export const compensatoryMonth = (date: string): string => date.slice(0, 7);

/** The day worked, as the API finds it for the person. */
export interface CompensatoryWorkedDay {
  /** A working day of their shift (Sunday to Thursday without one). */
  workingDay: boolean;
  /** The official holiday on it, by its English name; null for none. */
  holiday: string | null;
  /** Another request (approved or being decided) already claims it. */
  claimed: boolean;
  /** A check-in is kept on it. */
  checkedIn: boolean;
}

/** The day off asked for, as the API finds it for the person. */
export interface CompensatoryOffDay {
  workingDay: boolean;
  holiday: string | null;
  /** Their leave that day, approved or being decided: its type's name and its status's words ("approved", "with HR"). */
  leave: { type: string; status: string } | null;
  /** Work from home, official duty or another compensatory day off on it: what it is. */
  other: string | null;
}

/**
 * Why a day can't be the day worked (none: it can): the date; a working day (not a rest day by the shift, nor an
 * official holiday); one already claimed by another request. `name`: the employee's when HR records it.
 */
export function compensatoryWorkedProblems(date: string, day: CompensatoryWorkedDay, name: string | null = null): string[] {
  if (!isDate(date)) return ['Enter the day worked, e.g. 2026-11-06.'];
  const when = shown(date);
  const problems: string[] = [];
  if (day.workingDay && !day.holiday) problems.push(`${when} is a working day of ${name ? `${name}'s` : 'your'} shift, not a rest day or an official holiday: there is nothing to compensate.`);
  if (day.claimed) problems.push(`${name ? `${name} has` : 'You have'} asked to compensate ${when} already.`);
  return problems;
}

/**
 * Why a day can't be the day off (none: it can): the date; a rest day of their shift or an official holiday (it must be a
 * working day); leave, work from home, official duty or another compensatory day off on it.
 */
export function compensatoryOffProblems(date: string, day: CompensatoryOffDay, name: string | null = null): string[] {
  if (!isDate(date)) return ['Enter the day off, e.g. 2026-11-10.'];
  const when = shown(date);
  const your = name ? `${name}'s` : 'your';
  const problems: string[] = [];
  if (day.holiday) problems.push(`${when} is an official holiday (${day.holiday}): the day off must be a working day.`);
  else if (!day.workingDay) problems.push(`${when} is a rest day of ${your} shift: the day off must be a working day.`);
  if (day.leave) problems.push(`${name ? `${name} has` : 'You have'} ${day.leave.type} on ${when} (${day.leave.status}): it is a day off already.`);
  if (day.other) problems.push(`${name ? `${name} has` : 'You have'} ${day.other} on ${when} already.`);
  return problems;
}

/** The day worked and the day off must be in the same calendar month (owner: "in the same month"); null when they are. */
export function compensatorySameMonthProblem(dayWorked: string, dayOff: string): string | null {
  if (!isDate(dayWorked) || !isDate(dayOff) || compensatoryMonth(dayWorked) === compensatoryMonth(dayOff)) return null;
  return `The day off must be in the same month as the day worked: ${shown(dayWorked)} is in ${monthName(dayWorked)}, ${shown(dayOff)} in ${monthName(dayOff)}.`;
}

/** An employee asks a day before the day off at the latest (as work from home): null when they do. */
export function compensatoryNoticeProblem(dayOff: string, today: string): string | null {
  if (!isDate(dayOff)) return null;
  if (dayOff < today) return `${shown(dayOff)} has gone by: only HR records a day off that is past.`;
  if (dayOff === today) return `${shown(dayOff)} is today: ask for a compensatory day a day before the day off at the latest.`;
  return null;
}

/** The day worked can't be in the future: it has to have been worked. */
export function compensatoryFutureProblem(dayWorked: string, today: string): string | null {
  return isDate(dayWorked) && dayWorked > today ? `${shown(dayWorked)} hasn't come yet: a compensatory day is asked for a day already worked.` : null;
}

/** Everything an employee's request is checked against, in the order to fix them. */
export function compensatoryRequestProblems(dayWorked: string, dayOff: string, worked: CompensatoryWorkedDay, off: CompensatoryOffDay, today: string): string[] {
  const same = compensatorySameMonthProblem(dayWorked, dayOff);
  const notice = compensatoryNoticeProblem(dayOff, today);
  const future = compensatoryFutureProblem(dayWorked, today);
  return [...compensatoryWorkedProblems(dayWorked, worked), ...(future ? [future] : []), ...compensatoryOffProblems(dayOff, off), ...(same ? [same] : []), ...(notice ? [notice] : [])];
}

/**
 * HR recording one for someone (any day, a past day off too): what refuses it (`problems`) and what it is recorded past
 * (`warnings`: a past day off, no check-in kept on the day worked). A cash one has no day off (`dayOff` null).
 */
export function compensatoryRecordCheck(
  dayWorked: string,
  dayOff: string | null,
  worked: CompensatoryWorkedDay,
  off: CompensatoryOffDay | null,
  today: string,
  name: string,
): { problems: string[]; warnings: string[] } {
  const problems = [...compensatoryWorkedProblems(dayWorked, worked, name)];
  const future = compensatoryFutureProblem(dayWorked, today);
  if (future) problems.push(future);
  const warnings: string[] = [];
  if (dayOff !== null && off) {
    problems.push(...compensatoryOffProblems(dayOff, off, name));
    const same = compensatorySameMonthProblem(dayWorked, dayOff);
    if (same) problems.push(same);
    if (isDate(dayOff) && dayOff <= today) warnings.push(`${shown(dayOff)} ${dayOff === today ? 'is today' : 'has gone by'}: it is recorded without a day's notice.`);
  }
  if (isDate(dayWorked) && !worked.checkedIn) warnings.push(NO_CHECK_IN_WARNING(dayWorked));
  return { problems, warnings };
}

/** HR confirms a day worked with no check-in kept on it when deciding. */
export const NO_CHECK_IN_WARNING = (dayWorked: string): string => `No check-in is kept on ${shown(dayWorked)}: HR confirms the day was worked when deciding.`;

// ---------- the attendance ----------

/** What the days of a month are read with to mark the compensatory ones. */
export interface CompensatoryDaysContext {
  /** YYYY-MM. */
  month: string;
  today: string;
  /** Their shift's working days (0 = Sunday); null: Sunday to Thursday. */
  workingDays: readonly number[] | null;
  holidays: readonly string[];
  leaveDays: readonly string[];
  employedFrom: string | null;
  employedTo: string | null;
  /** The shift's hours a day (null without a shift). */
  hoursADay: number | null;
  /** The days off approved as a day off, and the days worked they compensate (also those approved as cash). */
  daysOff: readonly string[];
  daysWorked: readonly string[];
}

const SUN_TO_THU: readonly number[] = [0, 1, 2, 3, 4];

/**
 * A person's days of a month with their compensatory days (owner, 26 October 2026; "if the day is compensated with a day,
 * we pay nothing"): each day off approved (a working day of their shift, not an official holiday, not a day of approved
 * leave, within their employment, up to today) worked for the shift's hours a day, exempt (never short, missing a press
 * or absent), `compensatory`, without flags; its presses kept for reference; a day off with no day at all is added
 * (source 'system'). A day worked that is compensated (either way) keeps its check-ins but is `compensated`: its hours are
 * left out of the month's worked hours, so it never adds pay or fills short hours. In date order.
 */
export function compensatoryDays<D extends SourcedDay>(days: readonly D[], ctx: CompensatoryDaysContext): (D | SourcedDay)[] {
  if (!ctx.daysOff.length && !ctx.daysWorked.length) return [...days];
  const off = new Set(ctx.daysOff);
  const worked = new Set(ctx.daysWorked);
  const holidays = new Set(ctx.holidays);
  const leave = new Set(ctx.leaveDays);
  const working = new Set(ctx.workingDays ?? SUN_TO_THU);
  const hours = typeof ctx.hoursADay === 'number' && ctx.hoursADay > 0 ? ctx.hoursADay : 0;
  const offDay = (date: string) =>
    off.has(date) &&
    date.startsWith(ctx.month) &&
    date <= ctx.today &&
    working.has(new Date(`${date}T00:00:00Z`).getUTCDay()) &&
    !holidays.has(date) &&
    !leave.has(date) &&
    (!ctx.employedFrom || date >= ctx.employedFrom) &&
    (!ctx.employedTo || date <= ctx.employedTo);
  const out: (D | SourcedDay)[] = days.map((d) => {
    if (offDay(d.date) && !d.exempt && d.status !== 'leave' && d.status !== 'holiday' && d.status !== 'rest') {
      return { ...d, status: 'worked', hoursCounted: hours, exempt: true, compensatory: true, flags: [] };
    }
    if (worked.has(d.date) && d.status === 'worked') return { ...d, compensated: true };
    return d;
  });
  const known = new Set(days.map((d) => d.date));
  for (const date of [...off].sort()) {
    if (known.has(date) || !offDay(date)) continue;
    out.push({ date, status: 'worked', checkIn: null, checkOut: null, place: null, zohoStatus: null, permissionHours: 0, hoursCounted: hours, source: 'system', flags: [], exempt: true, compensatory: true });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

// ---------- helpers ----------

const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const isDate = (s: unknown): s is string => typeof s === 'string' && DATE.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
/** A date as messages show it: DD/MM/YYYY. */
const shown = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}`;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthName = (ymd: string) => `${MONTHS[Number(ymd.slice(5, 7)) - 1]} ${ymd.slice(0, 4)}`;
