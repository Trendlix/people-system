// Working from home (owner, 21 October 2026: "think about how should we handle the working from home in out erp"; in
// Zoho People it was a leave type). Here it is a working day in another place, not leave: no balance, no pay effect,
// its hours counted as any day's. Asked, the owner chose:
// - approval "Manager, then HR": the approver in charge (the direct manager, else the team lead, else the department's
//   head: department-leads.ts approverInCharge; nobody: straight to HR), then HR; a C-level person's HR stage the CEO's
//   (confidential.ts), as leave and permission are decided (leaves.ts LEAVE_STATUSES, LEAVE_STAGES);
// - the limit "its 2 days per month with a gap of 1 week between each record (Biweekly)": at most 2 days a calendar
//   month, those approved and being decided counted, and any two at least 7 days apart (the difference of their dates
//   7 or more), across months too; one day a request; both set in Leave Setup;
// - the notice "A day before": asked no later than the day before (Cairo), never the same day nor a day gone by. HR
//   records one for someone on any day, past the limits too, with a warning and a reason, approved at once and audited.
// Who asks for it: someone expected at the office that day (check-in.ts expectedPlace): an Office arrangement on any
// working day of their shift, a Hybrid one on its office days only (on its other days it is refused, as they work from
// home already); Work from home, Outdoor and Indoor and outdoor never (the option is hidden). Never on an official
// holiday, a rest day of their shift or a day of their leave. An approved day is expected anywhere: no "Outside the
// office" flag, and the office network's lock waived for them that day (apps/api/src/attendance/check-in.service.ts).
// Pure: the API enforces these and the web shows the same checks live. Dates are YYYY-MM-DD.

import { expectedPlace } from './check-in.js';
import { LEAVE_STEP_KIND_LABELS, LEAVE_STEP_KINDS } from './leaves.js';

/** What the screens call the request, and the day once approved. */
export const WFH_LABEL = 'Work from home';
export const WFH_DAY_LABEL = 'Working from home';
export const WFH_LABEL_AR = 'العمل من المنزل';

/** The Leave Setup's limits (owner, 21 October 2026: "its 2 days per month with a gap of 1 week between each record"). */
export interface WfhRules {
  /** The days a calendar month someone may work from home; 0 turns asking for it off. */
  daysPerMonth: number;
  /** The fewest days between any two of a person's days: their dates differ by this many or more (7: a week). */
  minGapDays: number;
}

export const WFH_RULE_DEFAULTS: WfhRules = { daysPerMonth: 2, minGapDays: 7 };

/** The most the Leave Setup may give: 20 days a month (about a month's working days), and a gap of 1 to 31 days. */
export const WFH_DAYS_PER_MONTH_MAX = 20;
export const WFH_GAP_DAYS_MAX = 31;

/** Why the Leave Setup's work from home limits can't be saved (none: they can): whole numbers within their ranges. */
export function wfhRulesProblems(rules: WfhRules): string[] {
  const problems: string[] = [];
  if (!Number.isInteger(rules.daysPerMonth) || rules.daysPerMonth < 0 || rules.daysPerMonth > WFH_DAYS_PER_MONTH_MAX) {
    problems.push(`Enter the work from home days a month as a whole number from 0 to ${WFH_DAYS_PER_MONTH_MAX}, e.g. 2 (0: no working from home).`);
  }
  if (!Number.isInteger(rules.minGapDays) || rules.minGapDays < 1 || rules.minGapDays > WFH_GAP_DAYS_MAX) {
    problems.push(`Enter the days between two work from home days as a whole number from 1 to ${WFH_GAP_DAYS_MAX}, e.g. 7 (1: any two days).`);
  }
  return problems;
}

/** Where a request is from: asked or recorded on the system, or brought over from Zoho People's history. */
export const WFH_SOURCES = ['system', 'zoho'] as const;
export type WfhSource = (typeof WFH_SOURCES)[number];

/** The steps logged on a request: leave's (sent, straight to HR, recorded by HR, each stage, cancelled), and imported. */
export const WFH_STEP_KINDS = [...LEAVE_STEP_KINDS, 'imported'] as const;
export type WfhStepKind = (typeof WFH_STEP_KINDS)[number];

export const WFH_STEP_KIND_LABELS: Record<WfhStepKind, string> = { ...LEAVE_STEP_KIND_LABELS, imported: 'Imported from Zoho People' };

/** The month (YYYY-MM) a day is counted in. */
export const wfhMonth = (date: string): string => date.slice(0, 7);

/** How many days apart two dates are, whichever comes first: 01/11 and 08/11 are 7 apart. */
export const daysApart = (a: string, b: string): number => Math.round(Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);

/** The weekday of a date, 0 = Sunday … 6 = Saturday. */
const weekdayOf = (date: string): number => new Date(`${date}T00:00:00Z`).getUTCDay();

/**
 * Whether someone's work arrangement ever needs a work from home day (owner, 21 October 2026): only when some day of the
 * week expects them at the office (check-in.ts expectedPlace): Office, and Hybrid with office days. Work from home,
 * Outdoor and Indoor and outdoor never: the option is hidden for them.
 */
export function wfhOffered(arrangement: string, officeDays: readonly number[]): boolean {
  return [0, 1, 2, 3, 4, 5, 6].some((d) => expectedPlace(arrangement, officeDays, d) === 'office');
}

/** Why someone whose arrangement never needs it can't ask for a work from home day. `name`: theirs when HR records it. */
export function wfhNotNeededMessage(arrangement: string, name: string | null = null): string {
  const who = name ? `${name} works` : 'You work';
  if (arrangement === 'wfh') return `${who} from home already: no work from home day is needed.`;
  if (arrangement === 'hybrid') return `${name ? `${name}'s` : 'Your'} hybrid arrangement has no office days: no work from home day is needed.`;
  return `${who} wherever the work is (outdoor, or indoor and outdoor), never held to the office: no work from home day is needed.`;
}

/** The day asked for, as the API finds it for the person. */
export interface WfhDay {
  /** Their work arrangement and, for Hybrid, its office days (0 = Sunday). */
  arrangement: string;
  officeDays: readonly number[];
  /** A working day of their shift (Sunday to Thursday without one). */
  workingDay: boolean;
  /** The official holiday on it, by its English name; null for none. */
  holiday: string | null;
  /** Their leave that day, approved or being decided: its type's name and its status's words ("approved", "with HR"). */
  leave: { type: string; status: string } | null;
  /** Their other work from home days, approved or being decided (not this one), of any month: their dates. */
  taken: readonly string[];
}

/**
 * Why a day can't be a work from home day for anyone, HR recording it too (none: it can): the date; an arrangement that
 * never needs it; an official holiday, a rest day of their shift, or (Hybrid) a day that isn't one of their office days;
 * a day of leave; a work from home day already on it. `name`: the employee's when HR records it, null for "you".
 */
export function wfhDayProblems(date: string, day: WfhDay, name: string | null = null): string[] {
  if (!isDate(date)) return ['Enter the day, e.g. 2026-11-01.'];
  if (!wfhOffered(day.arrangement, day.officeDays)) return [wfhNotNeededMessage(day.arrangement, name)];
  const when = shown(date);
  const your = name ? `${name}'s` : 'your';
  const problems: string[] = [];
  if (day.holiday) problems.push(`${when} is an official holiday (${day.holiday}): there is no work that day.`);
  else if (!day.workingDay) problems.push(`${when} is a rest day of ${your} shift: there is no work that day.`);
  else if (expectedPlace(day.arrangement, day.officeDays, weekdayOf(date)) !== 'office') {
    problems.push(`${when} isn't one of ${your} office days: ${name ? `${name} works` : 'you work'} from home that day already.`);
  }
  if (day.leave) problems.push(`${name ? `${name} has` : 'You have'} ${day.leave.type} on ${when} (${day.leave.status}): no work from home day is needed on a day of leave.`);
  if (day.taken.includes(date)) problems.push(`${name ? `${name} has` : 'You have'} a work from home day on ${when} already.`);
  return problems;
}

/**
 * The notice (owner, 21 October 2026: "A day before"): asked no later than the day before, in Cairo (`today`); null when
 * it is. Never the same day, nor a day gone by.
 */
export function wfhNoticeProblem(date: string, today: string): string | null {
  if (!isDate(date)) return null;
  if (date < today) return `${shown(date)} has gone by: ask for a work from home day a day before it at the latest.`;
  if (date === today) return `${shown(date)} is today: ask for a work from home day a day before it at the latest.`;
  return null;
}

/**
 * Why a day is over the limits (none: within them): turned off (0 a month); the month's days already taken (approved
 * and being decided, `taken`, this day left out); a day of theirs fewer than the gap's days away, in any month (the
 * nearest one named). `name`: the employee's when HR records it.
 */
export function wfhLimitProblems(date: string, rules: WfhRules, taken: readonly string[], name: string | null = null): string[] {
  if (!isDate(date)) return [];
  if (!(rules.daysPerMonth > 0)) return ['Working from home is turned off in Leave Setup: there are no work from home days a month to ask for.'];
  const others = taken.filter((d) => d !== date && isDate(d));
  const problems: string[] = [];
  const inMonth = others.filter((d) => wfhMonth(d) === wfhMonth(date)).length;
  if (inMonth >= rules.daysPerMonth) {
    problems.push(`${monthName(date)}'s ${daysText(rules.daysPerMonth)} of working from home are already asked for${name ? ` for ${name}` : ''}: ${inMonth} of ${rules.daysPerMonth}.`);
  }
  const near = others.filter((d) => daysApart(d, date) < rules.minGapDays).sort((a, b) => daysApart(a, date) - daysApart(b, date) || a.localeCompare(b))[0];
  if (near) {
    problems.push(
      `Two work from home days must be at least ${daysText(rules.minGapDays)} apart: ${shown(date)} is ${daysText(daysApart(near, date))} from ${name ? `${name}'s` : 'your'} day on ${shown(near)}.`,
    );
  }
  return problems;
}

/**
 * Why an employee can't send a request for a day (none: they can), in the order to fix them: the day itself
 * (wfhDayProblems), the notice (wfhNoticeProblem), then the limits (wfhLimitProblems).
 */
export function wfhRequestProblems(date: string, rules: WfhRules, day: WfhDay, today: string): string[] {
  const problems = wfhDayProblems(date, day);
  if (!isDate(date) || !wfhOffered(day.arrangement, day.officeDays)) return problems;
  const notice = wfhNoticeProblem(date, today);
  return [...problems, ...(notice ? [notice] : []), ...wfhLimitProblems(date, rules, day.taken)];
}

/**
 * HR recording a day for someone (owner, 21 October 2026: past, the same day or over the limit, "with a warning and a
 * reason"): what refuses it (`problems`: the day itself, wfhDayProblems) and what it is recorded past (`warnings`: no
 * day's notice, the limits), kept with it and in the audit log.
 */
export function wfhRecordCheck(date: string, rules: WfhRules, day: WfhDay, today: string, name: string): { problems: string[]; warnings: string[] } {
  const problems = wfhDayProblems(date, day, name);
  if (!isDate(date) || !wfhOffered(day.arrangement, day.officeDays)) return { problems, warnings: [] };
  const warnings: string[] = [];
  if (date < today) warnings.push(`${shown(date)} has gone by: it is recorded after the day.`);
  else if (date === today) warnings.push(`${shown(date)} is today: it is recorded without a day's notice.`);
  warnings.push(...wfhLimitProblems(date, rules, day.taken, name));
  return { problems, warnings };
}

/** A person's days of a month: how many are taken (approved and being decided) of the month's. */
export function wfhMonthUsed(month: string, taken: readonly string[]): number {
  return taken.filter((d) => wfhMonth(d) === month).length;
}

/**
 * The first day from `from` on (tomorrow, for an employee) within the limits with `taken`, that `workday` allows (their
 * shift's working days, their office days, not a holiday nor leave: the API's); null when none is within `withinDays`.
 */
export function nextWfhDay(from: string, rules: WfhRules, taken: readonly string[], workday: (date: string) => boolean = () => true, withinDays = 400): string | null {
  if (!isDate(from) || !(rules.daysPerMonth > 0)) return null;
  for (let i = 0, d = from; i < withinDays; i++, d = plusDays(d, 1)) {
    if (taken.includes(d) || !workday(d)) continue;
    if (!wfhLimitProblems(d, rules, taken).length) return d;
  }
  return null;
}

/**
 * The line the request form shows (owner's brief, 21 October 2026): "1 of 2 this month · next possible from
 * 05/11/2026"; turned off, so; no day possible in the time looked at, said so.
 */
export function wfhAllowanceText(used: number, rules: WfhRules, nextPossible: string | null): string {
  if (!(rules.daysPerMonth > 0)) return 'Working from home is turned off in Leave Setup.';
  const next = nextPossible ? `next possible from ${shown(nextPossible)}` : 'no day possible in the coming months';
  return `${used} of ${rules.daysPerMonth} this month · ${next}`;
}

/** The flags a check-in has only on a day expected at the office (check-in.ts checkInFlags): none on a work from home day. */
export const OFFICE_DAY_FLAGS: readonly string[] = ['outside_office', 'location_unknown'];

/**
 * A day's flags on a work from home day approved for them (expected anywhere): without the office day's, as for a day
 * recorded by HR or approved after the check-in was flagged; fake GPS, away from home and a sub-location not theirs stay.
 */
export const flagsOnWfhDay = <F extends string>(flags: readonly F[]): F[] => flags.filter((f) => !OFFICE_DAY_FLAGS.includes(f));

// ---------- helpers ----------

const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const isDate = (s: unknown): s is string => typeof s === 'string' && DATE.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
const plusDays = (ymd: string, n: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
/** A date as messages show it: DD/MM/YYYY. */
const shown = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}`;
const daysText = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** "November 2026", the month a day is in. */
const monthName = (ymd: string) => `${MONTHS[Number(ymd.slice(5, 7)) - 1]} ${ymd.slice(0, 4)}`;
