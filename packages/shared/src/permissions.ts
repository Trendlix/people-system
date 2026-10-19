// Permission (owner, 19 October 2026: "this is an option given by us .. 4 hours per month with a maximum 2 hours per
// day"; asked how it is asked for, "In the system, like leave"; asked where its limits are set, "Yes, in Leave Setup"):
// an employee asks to be away for a few hours of a working day (to leave early, come late, step out), from My Requests →
// Permission, or HR records one on their behalf; in half hours, at most the Leave Setup's hours a day (2) and hours a
// month (4); never on a rest day of their shift, an official holiday or a day they have leave. It is decided as leave
// is (leaves.ts: LEAVE_STATUSES, LEAVE_STAGES, LEAVE_STEP_KINDS): the direct manager, else the team lead, else the
// department's head (department-leads.ts approverInCharge), then HR, a C-level person's HR stage by the CEO
// (confidential.ts); every step logged, and cancelled by its employee while it is being decided or before its day. The
// month's approved permission hours, within the allowance, count as worked on the payroll (payroll.ts
// permissionHoursOf): the run line's attendance is the worked hours and the permission hours together, so they are
// never cut as short hours. Not the labour law's (the owner's words: "an option given by us"). Pure: the API enforces
// these, and the web shows the same checks live. Dates are YYYY-MM-DD, times HH:MM (Cairo), hours in half hours.

import { formatHours } from './payroll.js';

/** What the screens call it, in English and in Arabic (إذن, as the owner's company says it). */
export const PERMISSION_LABEL = 'Permission';
export const PERMISSION_LABEL_AR = 'إذن';

/** The Leave Setup's limits (owner, 19 October 2026: "4 hours per month with a maximum 2 hours per day"). */
export interface PermissionRules {
  /** The hours a month someone may be given; 0 turns permission off. */
  hoursPerMonth: number;
  /** The most hours of one day. */
  maxHoursPerDay: number;
}

export const PERMISSION_RULE_DEFAULTS: PermissionRules = { hoursPerMonth: 4, maxHoursPerDay: 2 };

/** Permission is asked for in half hours: 0.5, 1, 1.5, 2 … */
export const PERMISSION_STEP_HOURS = 0.5;

/** The most the Leave Setup may give: 40 hours a month, 8 a day (a working day). */
export const PERMISSION_MONTH_MAX = 40;
export const PERMISSION_DAY_MAX = 8;

/** Hours in half hours: a number of 0 or more whose double is whole. */
export const isHalfHours = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0 && Math.abs(n * 2 - Math.round(n * 2)) < 1e-9;

/**
 * Why the Leave Setup's permission limits can't be saved (none: they can): each in half hours, the month's 0 to 40 (0:
 * none given), the day's 0.5 to 8, and a day's no more than the month's (unless the month's is 0).
 */
export function permissionRulesProblems(rules: PermissionRules): string[] {
  const problems: string[] = [];
  if (!isHalfHours(rules.hoursPerMonth) || rules.hoursPerMonth > PERMISSION_MONTH_MAX) {
    problems.push(`Enter the permission hours a month from 0 to ${PERMISSION_MONTH_MAX}, in half hours, e.g. 4 (0: no permission).`);
  }
  if (!isHalfHours(rules.maxHoursPerDay) || rules.maxHoursPerDay < PERMISSION_STEP_HOURS || rules.maxHoursPerDay > PERMISSION_DAY_MAX) {
    problems.push(`Enter the most permission hours a day from 0.5 to ${PERMISSION_DAY_MAX}, in half hours, e.g. 2.`);
  }
  if (!problems.length && rules.hoursPerMonth > 0 && rules.maxHoursPerDay > rules.hoursPerMonth) {
    problems.push(`The most hours a day (${permissionHoursText(rules.maxHoursPerDay)}) can't be more than the hours a month (${permissionHoursText(rules.hoursPerMonth)}).`);
  }
  return problems;
}

/** The month (YYYY-MM) a permission's day is in: what its hours are counted against. */
export const permissionMonth = (date: string): string => date.slice(0, 7);

/** What is left of a month's permission hours once `used` (approved and being decided) are taken; never below 0. */
export const permissionLeft = (rules: Pick<PermissionRules, 'hoursPerMonth'>, used: number): number => Math.max(0, halfHours(rules.hoursPerMonth - used));

/** What is left of a day's permission hours once `usedThatDay` are taken; never below 0. */
export const permissionLeftThatDay = (rules: Pick<PermissionRules, 'maxHoursPerDay'>, usedThatDay: number): number => Math.max(0, halfHours(rules.maxHoursPerDay - usedThatDay));

/**
 * The times of a permission (owner's example, 19 October 2026: leaving at 5 PM), as given: from and to, or only one of
 * them, the other worked out from the hours (from 17:00 for 2 hours is to 19:00); none, none. Both given, they must span
 * the hours, within the day. `problems`: why they can't be taken.
 */
export function permissionTimes(hours: number, fromTime: string | null | undefined, toTime: string | null | undefined): { fromTime: string | null; toTime: string | null; problems: string[] } {
  const from = blank(fromTime);
  const to = blank(toTime);
  const problems: string[] = [];
  if (from !== null && minutesOf(from) === null) problems.push('Enter the time it starts as HH:MM, e.g. 17:00.');
  if (to !== null && minutesOf(to) === null) problems.push('Enter the time it ends as HH:MM, e.g. 19:00.');
  if (problems.length || (from === null && to === null)) return { fromTime: null, toTime: null, problems };
  if (!(hours > 0)) return { fromTime: from, toTime: to, problems };
  const span = Math.round(hours * 60);
  if (from !== null && to !== null) {
    const [a, b] = [minutesOf(from)!, minutesOf(to)!];
    if (b <= a) return { fromTime: from, toTime: to, problems: ['The time it ends must be after the time it starts, on the same day.'] };
    if (b - a !== span) {
      return { fromTime: from, toTime: to, problems: [`From ${from} to ${to} is ${permissionHoursText((b - a) / 60)}, not ${permissionHoursText(hours)}: change the hours or the times.`] };
    }
    return { fromTime: from, toTime: to, problems };
  }
  if (from !== null) {
    const end = minutesOf(from)! + span;
    if (end >= 24 * 60) return { fromTime: from, toTime: null, problems: [`${permissionHoursText(hours)} from ${from} run to midnight or past it: choose an earlier time.`] };
    return { fromTime: from, toTime: clock(end), problems };
  }
  const start = minutesOf(to!)! - span;
  if (start < 0) return { fromTime: null, toTime: to, problems: [`${permissionHoursText(hours)} up to ${to} start before midnight: choose a later time.`] };
  return { fromTime: clock(start), toTime: to, problems };
}

/** A permission as typed: the day, the hours, the times (optional). */
export interface PermissionRequestInput {
  date: string;
  hours: number;
  fromTime?: string | null;
  toTime?: string | null;
}

/** The day asked for, as the API finds it for the person. */
export interface PermissionDay {
  /** A working day of their shift (Sunday to Thursday without one). */
  workingDay: boolean;
  /** The official holiday on it, by its English name; null for none. */
  holiday: string | null;
  /** Their leave that day, approved or being decided: its type's name, and its status's words ("approved", "with HR"). */
  leave: { type: string; status: string } | null;
  /** The hours of their other permissions that day, approved or being decided (not this one). */
  usedThatDay: number;
  /** The hours of their other permissions in the day's month, approved or being decided (not this one). */
  usedInMonth: number;
}

/**
 * Why a permission can't be sent, in the order to fix them (none: it can): the day; the hours, in half hours, at most
 * the day's limit; the times; permission turned off; a rest day or an official holiday (there is no work to be away
 * from); a day of leave (no permission is needed); what is left of the day's hours and of the month's. `name`: the
 * employee's when HR records it on their behalf, null for the employee's own ("you").
 */
export function permissionRequestProblems(input: PermissionRequestInput, rules: PermissionRules, day: PermissionDay, name: string | null = null): string[] {
  if (!isDate(input.date)) return ['Enter the day of the permission, e.g. 2026-11-01.'];
  const problems: string[] = [];
  const hoursOk = isHalfHours(input.hours) && input.hours > 0;
  if (!hoursOk) problems.push('Enter the hours in half hours, e.g. 1.5 or 2.');
  else if (input.hours > rules.maxHoursPerDay) {
    problems.push(`Permission is at most ${permissionHoursText(rules.maxHoursPerDay)} a day; this is ${permissionHoursText(input.hours)}.`);
  }
  problems.push(...permissionTimes(hoursOk ? input.hours : 0, input.fromTime, input.toTime).problems);
  if (!(rules.hoursPerMonth > 0)) return [...problems, 'Permission is turned off in Leave Setup: there are no permission hours a month to ask for.'];
  const when = shown(input.date);
  const your = name ? `${name}'s` : 'your';
  if (day.holiday) problems.push(`${when} is an official holiday (${day.holiday}): there is no work to ask permission from.`);
  else if (!day.workingDay) problems.push(`${when} is a rest day of ${your} shift: there is no work to ask permission from.`);
  if (day.leave) {
    problems.push(`${name ? `${name} has` : 'You have'} ${day.leave.type} on ${when} (${day.leave.status}): no permission is needed on a day of leave.`);
  }
  if (problems.length || !hoursOk) return problems;
  const dayLeft = permissionLeftThatDay(rules, day.usedThatDay);
  if (input.hours > dayLeft) {
    problems.push(
      dayLeft > 0
        ? `Only ${permissionHoursText(dayLeft)} left of the ${permissionHoursText(rules.maxHoursPerDay)} a day on ${when}: ${permissionHoursText(day.usedThatDay)} already asked for.`
        : `The ${permissionHoursText(rules.maxHoursPerDay)} a day on ${when} are already asked for.`,
    );
  }
  const monthLeft = permissionLeft(rules, day.usedInMonth);
  if (input.hours > monthLeft) {
    problems.push(
      monthLeft > 0
        ? `Only ${permissionHoursText(monthLeft)} left of ${monthName(input.date)}'s ${permissionHoursText(rules.hoursPerMonth)} of permission.`
        : `${monthName(input.date)}'s ${permissionHoursText(rules.hoursPerMonth)} of permission are already asked for.`,
    );
  }
  return problems;
}

/**
 * A month's approved permission hours as the payroll counts them (owner, 19 October 2026: within the allowance, they
 * count as worked): the hours of each approved permission on a day within the parts of the month paid (`parts`; none
 * given: the whole month), at most the month's allowance (`hoursPerMonth`: a limit lowered since, or one HR recorded
 * over, counts no more than it).
 */
export function monthPermissionHours(
  permissions: readonly { date: string; hours: number }[],
  month: string,
  hoursPerMonth: number,
  parts: readonly { from: string; to: string }[] | null = null,
): number {
  const within = (date: string) => permissionMonth(date) === month && (parts === null || parts.some((p) => p.from <= date && date <= p.to));
  const total = permissions.filter((p) => within(p.date)).reduce((sum, p) => sum + (Number.isFinite(p.hours) && p.hours > 0 ? p.hours : 0), 0);
  return Math.min(halfHours(total), Math.max(0, hoursPerMonth));
}

/** Hours in words, as the messages say them: "2 hours", "1 hour", "30 minutes", "1 hour 30 minutes". */
export function permissionHoursText(hours: number): string {
  const minutes = Math.round(Math.max(0, hours) * 60);
  const [h, m] = [Math.floor(minutes / 60), minutes % 60];
  const hText = `${h} ${h === 1 ? 'hour' : 'hours'}`;
  if (m === 0) return hText;
  const mText = `${m} ${m === 1 ? 'minute' : 'minutes'}`;
  return h === 0 ? mText : `${hText} ${mText}`;
}

/** Hours as a line or a cell shows them, to the minute: 4 → "4:00", 1.5 → "1:30" (payroll.ts formatHours). */
export const permissionClock = (hours: number): string => formatHours(hours);

/** A permission's time, as its row says it: "17:00–19:00", "from 17:00", or null without times. */
export function permissionTimeText(p: { fromTime?: string | null; toTime?: string | null }): string | null {
  if (p.fromTime && p.toTime) return `${p.fromTime}–${p.toTime}`;
  if (p.fromTime) return `from ${p.fromTime}`;
  if (p.toTime) return `until ${p.toTime}`;
  return null;
}

// ---------- helpers ----------

const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const isDate = (s: string) => DATE.test(s);
const blank = (s: string | null | undefined) => (typeof s === 'string' && s.trim() !== '' ? s.trim() : null);
/** "HH:MM" as minutes from midnight; null when it isn't a time. */
function minutesOf(t: string): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(t);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}
const clock = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
/** To the half hour, without the noise of the sums. */
const halfHours = (n: number) => Math.round(n * 2) / 2 + 0;
/** A date as messages show it: DD/MM/YYYY. */
const shown = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}`;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** "November 2026", the month a day is in. */
const monthName = (ymd: string) => `${MONTHS[Number(ymd.slice(5, 7)) - 1]} ${ymd.slice(0, 4)}`;
