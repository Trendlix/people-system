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
// Since 27 October 2026 part of a day counts too, by the Compensatory Setup's hours (CompensatoryRules below).

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

// ---------- the Compensatory Setup (owner, 27 October 2026) ----------
// "i need a setup dashboard for the compensatory leaves", "minimum working hours"; asked which settings, he chose all four:
// the minimum hours to qualify, the hours for a whole day, the cash rate (from Leave Setup) and when the day off is taken.
// Asked what "compensate per hour" does, he chose "Hours off for hours worked": part of a rest day worked earns the same
// hours off on a working day, with no deduction, or cash for those hours at the rate; then "up to 4 hours to be compensated
// by hours - minimum 6 hours can be compensated by a day", and between them "Capped at 4 hours". A whole day is as before.

/** The Compensatory Setup's rules. */
export interface CompensatoryRules {
  /** Cash instead: a whole day's days' pay, and the rate of an hour's pay for hours (1.5). */
  cashRate: number;
  /** Fewer hours worked earn nothing. */
  minHours: number;
  /** Hours off earned are at most these. */
  hoursCap: number;
  /** From these hours worked, a whole day. */
  fullDayHours: number;
  /** When the day off is taken: null, in the same calendar month as the day worked; else within these days after it. */
  offWithinDays: number | null;
}

/** The owner's numbers (27 October 2026); the minimum to qualify Claude's default, as the Setup page showed it. */
export const COMPENSATORY_RULE_DEFAULTS: CompensatoryRules = { cashRate: COMPENSATORY_CASH_RATE_DEFAULT, minHours: 2, hoursCap: 4, fullDayHours: 6, offWithinDays: null };

/** The most days after the day worked the Setup may allow for the day off. */
export const COMPENSATORY_OFF_WITHIN_MAX = 60;

const halfHours = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && Number.isInteger(n * 2) && n >= 0.5 && n <= 24;

/** Why the Setup can't be saved (none: it can). */
export function compensatoryRulesProblems(r: CompensatoryRules): string[] {
  const problems = compensatoryRateProblems(r.cashRate);
  if (!halfHours(r.minHours)) problems.push('Enter the minimum hours to qualify in whole or half hours from 0.5 to 24, e.g. 2.');
  if (!halfHours(r.hoursCap)) problems.push('Enter the most hours off in whole or half hours from 0.5 to 24, e.g. 4.');
  if (!halfHours(r.fullDayHours)) problems.push('Enter the hours for a whole day in whole or half hours from 0.5 to 24, e.g. 6.');
  if (halfHours(r.minHours) && halfHours(r.hoursCap) && r.hoursCap < r.minHours) problems.push('The most hours off can’t be fewer than the minimum hours to qualify.');
  if (halfHours(r.hoursCap) && halfHours(r.fullDayHours) && r.fullDayHours < r.hoursCap) problems.push('The hours for a whole day can’t be fewer than the most hours off.');
  if (r.offWithinDays !== null && !(Number.isInteger(r.offWithinDays) && r.offWithinDays >= 1 && r.offWithinDays <= COMPENSATORY_OFF_WITHIN_MAX)) {
    problems.push(`Enter the days after the day worked as a whole number from 1 to ${COMPENSATORY_OFF_WITHIN_MAX}, or choose the same month.`);
  }
  return problems;
}

/** What working a day off earns: a whole day, hours off (at most the cap), or nothing below the minimum. */
export type CompensationEarned = { kind: 'day' } | { kind: 'hours'; hours: number } | { kind: 'none'; hours: number };

/**
 * What `hoursWorked` on a rest day or an official holiday earns (null: the whole day worked): from the hours for a whole
 * day, a whole day; below the minimum, nothing; between, those hours off, at most the cap (owner: "Capped at 4 hours").
 */
export function compensationEarned(hoursWorked: number | null, rules: Pick<CompensatoryRules, 'minHours' | 'hoursCap' | 'fullDayHours'> = COMPENSATORY_RULE_DEFAULTS): CompensationEarned {
  if (hoursWorked === null || hoursWorked >= rules.fullDayHours) return { kind: 'day' };
  if (hoursWorked < rules.minHours) return { kind: 'none', hours: hoursWorked };
  return { kind: 'hours', hours: Math.min(hoursWorked, rules.hoursCap) };
}

/** Hours in words: "1 hour", "2.5 hours". */
export const hoursText = (n: number): string => `${Math.round(n * 100) / 100} ${n === 1 ? 'hour' : 'hours'}`;

/** What is earned, in words: "a whole day off", "4 hours off", "nothing: fewer than 2 hours worked". */
export function compensationEarnedText(e: CompensationEarned, rules: Pick<CompensatoryRules, 'minHours'> = COMPENSATORY_RULE_DEFAULTS): string {
  if (e.kind === 'day') return 'a whole day off';
  if (e.kind === 'hours') return `${hoursText(e.hours)} off`;
  return `nothing: fewer than ${hoursText(rules.minHours)} worked`;
}

/**
 * Why the hours worked can't be compensated (none: they can; null hours: the whole day): not hours of a day, or below the
 * Setup's minimum. `name`: the employee's when HR records it.
 */
export function hoursWorkedProblems(hoursWorked: number | null, rules: Pick<CompensatoryRules, 'minHours'> = COMPENSATORY_RULE_DEFAULTS, name: string | null = null): string[] {
  if (hoursWorked === null) return [];
  if (!(typeof hoursWorked === 'number' && Number.isFinite(hoursWorked) && hoursWorked > 0 && hoursWorked <= 24)) return ['Enter the hours worked, e.g. 4 or 3.5.'];
  if (hoursWorked < rules.minHours) {
    return [`${name ? `${name} worked` : 'You worked'} ${hoursText(hoursWorked)}: fewer than the ${hoursText(rules.minHours)} that earn a compensation (Compensatory Setup).`];
  }
  return [];
}

/**
 * Cash instead, in days' pay (a payroll Bonus (days), a day of the fixed part): a whole day the rate; hours, the hours ÷
 * the shift's hours a day (8 without a shift) × the rate, to the hundredth.
 */
export function compensatoryCashDays(e: CompensationEarned, rules: Pick<CompensatoryRules, 'cashRate'>, hoursADay: number | null): number {
  if (e.kind === 'none') return 0;
  if (e.kind === 'day') return rules.cashRate;
  const day = typeof hoursADay === 'number' && hoursADay > 0 ? hoursADay : 8;
  return Math.round(((e.hours / day) * rules.cashRate) * 100) / 100;
}

/**
 * When the day off is taken (the Setup): in the same calendar month as the day worked (null: as the owner first said, "in
 * the same month"), or within so many days after it; null when it is.
 */
export function compensatoryWindowProblem(dayWorked: string, dayOff: string, offWithinDays: number | null = null): string | null {
  if (offWithinDays === null) return compensatorySameMonthProblem(dayWorked, dayOff);
  if (!isDate(dayWorked) || !isDate(dayOff)) return null;
  const last = new Date(Date.parse(`${dayWorked}T00:00:00Z`) + offWithinDays * 86_400_000).toISOString().slice(0, 10);
  if (dayOff > dayWorked && dayOff <= last) return null;
  return `The day off must be within ${offWithinDays} ${offWithinDays === 1 ? 'day' : 'days'} after the day worked: from ${shown(new Date(Date.parse(`${dayWorked}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10))} to ${shown(last)}.`;
}

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

/** Everything an employee's request is checked against, in the order to fix them; the window the Setup's (27 October 2026). */
export function compensatoryRequestProblems(
  dayWorked: string,
  dayOff: string,
  worked: CompensatoryWorkedDay,
  off: CompensatoryOffDay,
  today: string,
  rules: Pick<CompensatoryRules, 'offWithinDays'> = COMPENSATORY_RULE_DEFAULTS,
): string[] {
  const same = compensatoryWindowProblem(dayWorked, dayOff, rules.offWithinDays);
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
  rules: Pick<CompensatoryRules, 'offWithinDays'> = COMPENSATORY_RULE_DEFAULTS,
): { problems: string[]; warnings: string[] } {
  const problems = [...compensatoryWorkedProblems(dayWorked, worked, name)];
  const future = compensatoryFutureProblem(dayWorked, today);
  if (future) problems.push(future);
  const warnings: string[] = [];
  if (dayOff !== null && off) {
    problems.push(...compensatoryOffProblems(dayOff, off, name));
    const same = compensatoryWindowProblem(dayWorked, dayOff, rules.offWithinDays);
    if (same) problems.push(same);
    if (isDate(dayOff) && dayOff <= today) warnings.push(`${shown(dayOff)} ${dayOff === today ? 'is today' : 'has gone by'}: it is recorded without a day's notice.`);
  }
  if (isDate(dayWorked) && !worked.checkedIn) warnings.push(NO_CHECK_IN_WARNING(dayWorked));
  return { problems, warnings };
}

/** HR confirms a day worked with no check-in kept on it when deciding. */
export const NO_CHECK_IN_WARNING = (dayWorked: string): string => `No check-in is kept on ${shown(dayWorked)}: HR confirms the day was worked when deciding.`;

// ---------- with an official duty on a rest day or an official holiday ----------

/** How an official duty on a rest day or an official holiday is compensated: a day off (with its date), or cash instead. */
export interface CompensationAsked {
  outcome: CompensatoryOutcome;
  /** YYYY-MM-DD for a day off; null for cash instead. */
  dayOff: string | null;
}

/**
 * The compensation an official duty on a rest day or an official holiday comes with (owner, 27 October 2026, asked why
 * official duty couldn't be recorded on a rest day, "it should count in the compensatories"; he chose "One step": the duty
 * form "asks for the compensation: a day off in the same month, or cash instead"). What refuses it (`problems`): the day
 * worked compensated already; a day off missing, or not a free working day in the same month; an employee's day off not a
 * day ahead. What HR records it past (`warnings`): a day off today or gone by. The day worked's other checks are the
 * official duty's (it is asked ahead too: the duty is planned), and the duty is what shows it was worked, so there is no
 * check-in warning. `off`: the day off as the API finds it (null for cash). `name`: the employee's when HR records it.
 */
export function compensatoryForOdCheck(
  dayWorked: string,
  asked: CompensationAsked,
  worked: Pick<CompensatoryWorkedDay, 'claimed'>,
  off: CompensatoryOffDay | null,
  today: string,
  name: string | null = null,
  rules: Pick<CompensatoryRules, 'offWithinDays'> = COMPENSATORY_RULE_DEFAULTS,
): { problems: string[]; warnings: string[] } {
  const problems: string[] = [];
  const warnings: string[] = [];
  if (worked.claimed) problems.push(`${name ? `${name} has` : 'You have'} asked to compensate ${shown(dayWorked)} already.`);
  if (asked.outcome === 'cash') return { problems, warnings };
  if (!asked.dayOff || !isDate(asked.dayOff)) return { problems: [...problems, 'Enter the day off, e.g. 2026-11-10.'], warnings };
  if (off) problems.push(...compensatoryOffProblems(asked.dayOff, off, name));
  const same = compensatoryWindowProblem(dayWorked, asked.dayOff, rules.offWithinDays);
  if (same) problems.push(same);
  if (name === null) {
    const notice = compensatoryNoticeProblem(asked.dayOff, today);
    if (notice) problems.push(notice);
  } else if (asked.dayOff <= today) {
    warnings.push(`${shown(asked.dayOff)} ${asked.dayOff === today ? 'is today' : 'has gone by'}: it is recorded without a day's notice.`);
  }
  return { problems, warnings };
}

/**
 * What a compensation is, in words: "a day off on 28/10/2026", "4 hours off on 28/10/2026", "cash instead (1.5 days'
 * pay)", "cash instead (4 hours' pay at 1.5×)". `hoursOff`: hours off earned (null: a whole day).
 */
export function compensationText(asked: { outcome: CompensatoryOutcome | null; dayOff: string | null; hoursOff?: number | null }, rate: number): string {
  const hours = asked.hoursOff ?? null;
  if (asked.outcome === 'cash') return hours ? `cash instead (${hoursText(hours)}' pay at ${rate}×)` : `cash instead (${rate} days' pay)`;
  const what = hours ? `${hoursText(hours)} off` : 'a day off';
  return asked.dayOff ? `${what} on ${shown(asked.dayOff)}` : what;
}

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
  /** Hours off approved for part of a day worked (27 October 2026): the day and the hours. Left out: none. */
  hoursOff?: readonly { date: string; hours: number }[];
}

const SUN_TO_THU: readonly number[] = [0, 1, 2, 3, 4];

/**
 * A person's days of a month with their compensatory days (owner, 26 October 2026; "if the day is compensated with a day,
 * we pay nothing"): each day off approved (a working day of their shift, not an official holiday, not a day of approved
 * leave, within their employment, up to today) worked for the shift's hours a day, exempt (never short, missing a press
 * or absent), `compensatory`, without flags; its presses kept for reference; a day off with no day at all is added
 * (source 'system'). A day worked that is compensated (either way) keeps its check-ins but is `compensated`: its hours are
 * left out of the month's worked hours, so it never adds pay or fills short hours. Hours off (27 October 2026) on such a
 * working day are counted as worked on top of its own (`compensatoryHours`), at most the shift's hours a day; a day with no
 * check-in is worked for them alone, so the rest of it is short hours, not a no-show. In date order.
 */
export function compensatoryDays<D extends SourcedDay>(days: readonly D[], ctx: CompensatoryDaysContext): (D | SourcedDay)[] {
  const hoursOff = new Map<string, number>();
  for (const h of ctx.hoursOff ?? []) if (h.hours > 0) hoursOff.set(h.date, (hoursOff.get(h.date) ?? 0) + h.hours);
  if (!ctx.daysOff.length && !ctx.daysWorked.length && !hoursOff.size) return [...days];
  const off = new Set(ctx.daysOff);
  const worked = new Set(ctx.daysWorked);
  const holidays = new Set(ctx.holidays);
  const leave = new Set(ctx.leaveDays);
  const working = new Set(ctx.workingDays ?? SUN_TO_THU);
  const hours = typeof ctx.hoursADay === 'number' && ctx.hoursADay > 0 ? ctx.hoursADay : 0;
  const counts = (date: string) =>
    date.startsWith(ctx.month) &&
    date <= ctx.today &&
    working.has(new Date(`${date}T00:00:00Z`).getUTCDay()) &&
    !holidays.has(date) &&
    !leave.has(date) &&
    (!ctx.employedFrom || date >= ctx.employedFrom) &&
    (!ctx.employedTo || date <= ctx.employedTo);
  const offDay = (date: string) => off.has(date) && counts(date);
  // hours off (27 October 2026): on a working day that isn't a whole day off
  const hoursOn = (date: string) => (!off.has(date) && counts(date) ? (hoursOff.get(date) ?? 0) : 0);
  /** The hours a day counts with hours off added, never more than the shift's hours a day (none without a shift). */
  const withHours = (counted: number, h: number) => Math.round(Math.min(hours > 0 ? hours : counted + h, counted + h) * 60) / 60;
  const out: (D | SourcedDay)[] = days.map((d) => {
    if (offDay(d.date) && !d.exempt && d.status !== 'leave' && d.status !== 'holiday' && d.status !== 'rest') {
      return { ...d, status: 'worked', hoursCounted: hours, exempt: true, compensatory: true, flags: [] };
    }
    const h = hoursOn(d.date);
    if (h > 0 && !d.exempt && d.status !== 'leave' && d.status !== 'holiday' && d.status !== 'rest') {
      // worked for the hours off too; a day with no check-in is worked for them alone (short, not a no-show)
      return d.status === 'worked'
        ? { ...d, hoursCounted: withHours(d.hoursCounted, h), compensatoryHours: h }
        : { ...d, status: 'worked', hoursCounted: withHours(0, h), compensatoryHours: h, flags: [] };
    }
    if (worked.has(d.date) && d.status === 'worked') return { ...d, compensated: true };
    return d;
  });
  const known = new Set(days.map((d) => d.date));
  for (const date of [...off].sort()) {
    if (known.has(date) || !offDay(date)) continue;
    out.push({ date, status: 'worked', checkIn: null, checkOut: null, place: null, zohoStatus: null, permissionHours: 0, hoursCounted: hours, source: 'system', flags: [], exempt: true, compensatory: true });
  }
  for (const date of [...hoursOff.keys()].sort()) {
    const h = hoursOn(date);
    if (known.has(date) || h <= 0) continue;
    out.push({ date, status: 'worked', checkIn: null, checkOut: null, place: null, zohoStatus: null, permissionHours: 0, hoursCounted: withHours(0, h), source: 'system', flags: [], compensatoryHours: h });
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
