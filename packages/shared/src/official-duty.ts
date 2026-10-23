// Official duty, OD (owner, 23 October 2026: "lets work on these", on "Official duty (OD) requests. The plan has OD as a
// third attendance mode beside Office and WFH, needing an approved request"; the spec's §5: "mode (Office/WFH/OD)", "OD
// requires an approved OD request"). Work done for the company away from the office (a client's site, a shoot, a
// government office), a working day, not leave. Asked, the owner chose:
// - approval "Manager, then HR": the approver in charge (the direct manager, else the team lead, else the department's
//   head: department-leads.ts), then HR; nobody in charge, straight to HR; a C-level person's HR stage the CEO's
//   (confidential.ts), as leave and working from home are decided (leaves.ts LEAVE_STATUSES, LEAVE_STAGES);
// - timing "Ahead or up to 3 days after": for a day to come, today, or a day up to 3 days gone by (Cairo), the latter
//   marked "requested after"; its reason is required as every official duty's is;
// - check-in "Check in from anywhere": on an approved day, or within a part day's hours, the office's location rule and
//   the office network's lock don't apply and the spot is kept (apps/api/src/attendance/check-in.service.ts); a day
//   with no press counts as attended for the approved hours ("If they forget, the approved hours still count").
// Claude's defaults where the owner was silent, which the owner can change:
// - one day, or several days in a row (at most 31); part of a day (from–to times) for one day only, inside their shift;
// - a single day on an official holiday or a rest day of their shift is refused, HR included (no "HR adds it"): there is
//   no work to be away for, and the attendance doesn't expect hours then; several days skip their holidays and rest days,
//   which aren't duty days, and are refused when none is a working day;
// - no overlap with leave, a work from home day or another official duty, approved or being decided (as working from
//   home blocks its days); a half-day leave doesn't block part of a day;
// - a press counts as within a part day's hours from 30 minutes before it starts to 30 minutes after it ends (travel).
// Pure: the API enforces these and the web shows the same checks live. Dates are YYYY-MM-DD, times HH:MM (Cairo).

import { hoursCountedForDay, mostHoursCountedADay, shiftWindowOn, timeOfDayText, zonedMoment, type ShiftWindowTimes } from './attendance.js';
import type { KeptDay, SourcedDay } from './attendance-days.js';
import type { CountingShift } from './check-in.js';
import { LEAVE_STEP_KIND_LABELS } from './leaves.js';
import { shiftWorkHours } from './payroll.js';

/** What the screens call it, its short badge, and a day of it. */
export const OD_LABEL = 'Official duty';
export const OD_LABEL_AR = 'مأمورية';
export const OD_SHORT_LABEL = 'OD';
export const OD_DAY_LABEL = 'On official duty';

/** The days after a day it may still be asked for (owner, 23 October 2026: "Ahead or up to 3 days after"). */
export const OD_AFTER_DAYS = 3;

/** The most days one request covers, in a row. */
export const OD_MAX_DAYS = 31;

/** The longest place and reason the API takes. */
export const OD_PLACE_MAX = 200;
export const OD_REASON_MAX = 1000;

/** How long before a part day starts and after it ends a press still counts within its hours (travel). */
export const OD_PRESS_MARGIN_MINUTES = 30;

/** What the check-in panel says on an approved day (owner's brief, 23 October 2026). */
export const OD_CHECK_IN_TEXT = 'Official duty today: check in from where you are.';

/** The steps logged on a request: sent, sent straight to HR, each stage's decision, cancelled. */
export const OD_STEP_KINDS = ['submitted', 'no_manager', 'manager_decision', 'hr_decision', 'cancelled'] as const;
export type OdStepKind = (typeof OD_STEP_KINDS)[number];

export const OD_STEP_KIND_LABELS: Record<OdStepKind, string> = {
  submitted: LEAVE_STEP_KIND_LABELS.submitted,
  no_manager: LEAVE_STEP_KIND_LABELS.no_manager,
  manager_decision: LEAVE_STEP_KIND_LABELS.manager_decision,
  hr_decision: LEAVE_STEP_KIND_LABELS.hr_decision,
  cancelled: LEAVE_STEP_KIND_LABELS.cancelled,
};

// ---------- the request ----------

/** A request as asked: its first and last day (the same for one day), a full day or from–to times, where, and why. */
export interface OdInput {
  startDate: string;
  endDate: string;
  fullDay: boolean;
  /** HH:MM, part of a day only; null for a full day. */
  fromTime: string | null;
  toTime: string | null;
  place: string;
  reason: string;
}

/** The days a request covers, from its first to its last. */
export function odDates(startDate: string, endDate: string): string[] {
  if (!isDate(startDate) || !isDate(endDate) || endDate < startDate) return [];
  const out: string[] = [];
  for (let d = startDate; d <= endDate && out.length <= OD_MAX_DAYS + 1; d = plusDays(d, 1)) out.push(d);
  return out;
}

/**
 * Why a request can't be read (none: it can): its days (a first and a last, in order, at most 31), part of a day's times
 * (for one day, the end after the start), the place and the reason (both required, each within its length).
 */
export function odInputProblems(input: OdInput): string[] {
  const problems: string[] = [];
  const first = isDate(input.startDate);
  const last = isDate(input.endDate);
  if (!first) problems.push('Enter the day of the official duty, e.g. 2026-11-01.');
  if (!last) problems.push('Enter the last day of the official duty, e.g. 2026-11-03 (the same day for one day).');
  if (first && last) {
    if (input.endDate < input.startDate) problems.push("The last day can't be before the first.");
    else {
      const days = daysBetween(input.startDate, input.endDate) + 1;
      if (days > OD_MAX_DAYS) problems.push(`Ask for at most ${OD_MAX_DAYS} days at once: this is ${days} days.`);
    }
  }
  if (!input.fullDay) {
    const from = isTime(input.fromTime);
    const to = isTime(input.toTime);
    if (!from) problems.push('Enter the time it starts, e.g. 10:00.');
    if (!to) problems.push('Enter the time it ends, e.g. 14:00.');
    if (from && to && input.toTime! <= input.fromTime!) problems.push('The time it ends must be after the time it starts.');
    if (first && last && input.endDate > input.startDate) problems.push('Part of a day is for one day: ask for full days, or a request for each day.');
  }
  const place = (input.place ?? '').trim();
  if (!place) problems.push('Write where the official duty is, e.g. the client’s office in New Cairo.');
  else if (place.length > OD_PLACE_MAX) problems.push(`Keep the place to ${OD_PLACE_MAX} characters or fewer.`);
  const reason = (input.reason ?? '').trim();
  if (!reason) problems.push('Write what the official duty is for, e.g. a site visit for the client’s launch.');
  else if (reason.length > OD_REASON_MAX) problems.push(`Keep the reason to ${OD_REASON_MAX} characters or fewer.`);
  return problems;
}

/**
 * The timing (owner, 23 October 2026: "Ahead or up to 3 days after"): its first day today or later, or up to 3 days gone
 * by (Cairo, `today`); null when it is. A day 4 days ago or more is refused.
 */
export function odTimingProblem(startDate: string, today: string): string | null {
  if (!isDate(startDate) || !isDate(today)) return null;
  const earliest = plusDays(today, -OD_AFTER_DAYS);
  if (startDate >= earliest) return null;
  return `${shown(startDate)} is more than ${OD_AFTER_DAYS} days ago: ask for an official duty ahead, or within ${OD_AFTER_DAYS} days after the day (from ${shown(earliest)}).`;
}

/** Whether a request is asked after its first day: "requested after" (owner, 23 October 2026), its reason required. */
export const odRequestedAfter = (startDate: string, today: string): boolean => isDate(startDate) && isDate(today) && startDate < today;

/** A day of a request as the API finds it for the person. */
export interface OdDayFacts {
  date: string;
  /** A working day of their shift (Sunday to Thursday without one). */
  workingDay: boolean;
  /** The official holiday on it, by its English name; null for none. */
  holiday: string | null;
  /** Their leave that day, approved or being decided: its type's name, its status's words, and whether a half day. */
  leave: { type: string; status: string; halfDay: boolean } | null;
  /** Their work from home day on it, approved or being decided: its status's words. */
  wfh: { status: string } | null;
  /** Their other official duties that day, approved or being decided (not this one). */
  od: readonly { status: string; fullDay: boolean; fromTime: string | null; toTime: string | null }[];
}

/** The duty days of a request: its days that are working days of their shift and not an official holiday. */
export const odDutyDays = (days: readonly OdDayFacts[]): string[] => days.filter((d) => d.workingDay && !d.holiday).map((d) => d.date);

/** Whether two parts of a day meet: either a full day, or their times overlap. */
function timesMeet(a: { fullDay: boolean; fromTime: string | null; toTime: string | null }, b: { fullDay: boolean; fromTime: string | null; toTime: string | null }): boolean {
  if (a.fullDay || b.fullDay || !a.fromTime || !a.toTime || !b.fromTime || !b.toTime) return true;
  return a.fromTime < b.toTime && b.fromTime < a.toTime;
}

/**
 * Why a request's days can't be official duty (none: they can): one day on an official holiday or a rest day of their
 * shift; several with none a working day; any duty day with leave (a full day's, or any on a full day of duty), a work
 * from home day, or another official duty on the same hours, approved or being decided. `name`: the employee's when
 * someone else is told, null for "you".
 */
export function odDaysProblems(input: Pick<OdInput, 'startDate' | 'endDate' | 'fullDay' | 'fromTime' | 'toTime'>, days: readonly OdDayFacts[], name: string | null = null): string[] {
  if (!days.length) return [];
  const your = name ? `${name}'s` : 'your';
  const has = name ? `${name} has` : 'You have';
  const problems: string[] = [];
  if (input.startDate === input.endDate) {
    const d = days[0];
    if (d.holiday) return [`${shown(d.date)} is an official holiday (${d.holiday}): there is no work that day, so no official duty.`];
    if (!d.workingDay) return [`${shown(d.date)} is a rest day of ${your} shift: there is no work that day, so no official duty.`];
  } else if (!odDutyDays(days).length) {
    return [`None of the days from ${shown(input.startDate)} to ${shown(input.endDate)} is a working day of ${your} shift: there is no work to be away for.`];
  }
  const part = { fullDay: input.fullDay, fromTime: input.fullDay ? null : input.fromTime, toTime: input.fullDay ? null : input.toTime };
  for (const d of days) {
    if (!d.workingDay || d.holiday) continue;
    const when = shown(d.date);
    if (d.leave && (input.fullDay || !d.leave.halfDay)) problems.push(`${has} ${d.leave.type} on ${when} (${d.leave.status}): an official duty can't be on a day of leave.`);
    if (d.wfh) problems.push(`${has} a work from home day on ${when} (${d.wfh.status}): ask for one or the other.`);
    const other = d.od.find((o) => timesMeet(part, o));
    if (other) {
      const hours = !other.fullDay && other.fromTime && other.toTime ? `, ${timeOfDayText(other.fromTime)}–${timeOfDayText(other.toTime)}` : '';
      problems.push(`${has} an official duty on ${when} already (${other.status}${hours}).`);
    }
  }
  return problems;
}

/** The minutes from a shift's start to a time of day, on the shift's own day (past midnight on a night shift). */
const minutesIntoShift = (time: string, start: string) => {
  const m = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  return (m(time) - m(start) + 1440) % 1440;
};

/**
 * Part of a day's times inside their shift (owner's brief, 23 October 2026: "part-day times are inside the person's
 * shift (or say so)"): from its start to its end and grace; without a shift a part day can't be checked, so a full day
 * is asked for. None for a full day.
 */
export function odHoursProblems(input: Pick<OdInput, 'fullDay' | 'fromTime' | 'toTime'>, shift: ShiftWindowTimes | null, name: string | null = null): string[] {
  if (input.fullDay || !isTime(input.fromTime) || !isTime(input.toTime)) return [];
  const your = name ? `${name}'s` : 'your';
  if (!shift) return [`${name ? `${name} has` : 'You have'} no shift, so part of a day can't be checked against it: ask for the full day.`];
  const start = shift.startTime.slice(0, 5);
  const end = shift.endTime.slice(0, 5);
  const length = minutesIntoShift(end, start) + Math.max(0, Math.round(shift.graceMinutes ?? 0));
  const from = minutesIntoShift(input.fromTime!, start);
  const to = minutesIntoShift(input.toTime!, start);
  if (length > 0 && from < length && to <= length && to > from) return [];
  return [`Choose times within ${your} shift, ${timeOfDayText(start)} to ${timeOfDayText(end)}.`];
}

/**
 * Why an employee can't send a request (none: they can), in the order to fix them: what can't be read
 * (odInputProblems), the timing (odTimingProblem), the hours against the shift (odHoursProblems), then the days
 * (odDaysProblems).
 */
export function odRequestProblems(input: OdInput, days: readonly OdDayFacts[], shift: ShiftWindowTimes | null, today: string): string[] {
  const read = odInputProblems(input);
  if (read.length) return read;
  const timing = odTimingProblem(input.startDate, today);
  return [...(timing ? [timing] : []), ...odHoursProblems(input, shift), ...odDaysProblems(input, days)];
}

/** A request's days and hours in words: "01/11/2026, 10:00 AM–2:00 PM", "01/11/2026 (full day)", "01/11/2026–03/11/2026". */
export function odWhenText(r: { startDate: string; endDate: string; fullDay: boolean; fromTime?: string | null; toTime?: string | null }): string {
  if (r.startDate !== r.endDate) return `${shown(r.startDate)}–${shown(r.endDate)}`;
  if (!r.fullDay && r.fromTime && r.toTime) return `${shown(r.startDate)}, ${timeOfDayText(r.fromTime)}–${timeOfDayText(r.toTime)}`;
  return `${shown(r.startDate)} (full day)`;
}

// ---------- attendance ----------

/** An approved official duty on a day, as the attendance reads it (AttendanceDayView.od). */
export interface DayOfficialDuty {
  requestId: string;
  fullDay: boolean;
  fromTime: string | null;
  toTime: string | null;
  /** The hours it counts on the day by itself (odHoursOn). */
  hours: number;
}

/** A part day's times on a day as moments, on the shift's own day (a time before a night shift's start is the next day). */
function partMoments(date: string, od: { fromTime: string | null; toTime: string | null }, shift: ShiftWindowTimes | null): { from: number; to: number } | null {
  if (!od.fromTime || !od.toTime) return null;
  const at = (time: string) => {
    const nextDay = shift && shift.endTime.slice(0, 5) <= shift.startTime.slice(0, 5) && time.slice(0, 5) < shift.startTime.slice(0, 5);
    return zonedMoment(nextDay ? plusDays(date, 1) : date, time);
  };
  const from = at(od.fromTime);
  const to = at(od.toTime);
  return Number.isFinite(from) && Number.isFinite(to) && to > from ? { from, to } : null;
}

/**
 * The hours an official duty counts on a day by itself (owner, 23 October 2026: "If they forget, the approved hours still
 * count as attended"): a full day, the shift's hours to work a day (none without a shift: 0); part of a day, its time
 * within the shift's window, at most the shift's hours a day (no shift: from its start to its end).
 */
export function odHoursOn(date: string, od: { fullDay: boolean; fromTime: string | null; toTime: string | null }, shift: CountingShift | null): number {
  if (od.fullDay) return shift ? (shiftWorkHours(shift) ?? 0) : 0;
  const part = partMoments(date, od, shift);
  if (!part) return 0;
  return toMinute(hoursCountedForDay(new Date(part.from), new Date(part.to), shift ? mostHoursCountedADay(shift) : null, shift ? shiftWindowOn(date, shift) : null));
}

/**
 * Whether a press at `moment` is within an official duty on its day (owner, 23 October 2026: "Check in from anywhere:
 * on an approved OD day or its hours"): a full day, any time; part of a day, from 30 minutes before it starts to 30
 * minutes after it ends.
 */
export function odCoversMoment(date: string, od: { fullDay: boolean; fromTime: string | null; toTime: string | null }, moment: number, shift: ShiftWindowTimes | null): boolean {
  if (od.fullDay) return true;
  const part = partMoments(date, od, shift);
  if (!part) return false;
  const margin = OD_PRESS_MARGIN_MINUTES * 60_000;
  return moment >= part.from - margin && moment <= part.to + margin;
}

/**
 * Whether an official duty covers a shift's start on a day (part of a day starting by the start and its grace): such a
 * day is never late, whatever time the first press is.
 */
export function odCoversStart(date: string, od: { fullDay: boolean; fromTime: string | null; toTime: string | null }, shift: ShiftWindowTimes | null): boolean {
  if (od.fullDay) return true;
  if (!shift) return false;
  const part = partMoments(date, od, shift);
  const window = shiftWindowOn(date, shift);
  if (!part || !window) return false;
  const grace = Math.max(0, Math.round(shift.graceMinutes ?? 0)) * 60_000;
  return part.from <= window.start + grace && part.to > window.start;
}

/** The hours of time spans together within a window, overlaps counted once, in whole minutes, at most `most`. */
function unionHours(spans: readonly { from: number; to: number }[], window: { start: number; end: number } | null, most: number | null): number {
  const clipped = spans
    .map((s) => (window ? { from: Math.max(s.from, window.start), to: Math.min(s.to, window.end) } : s))
    .filter((s) => s.to > s.from)
    .sort((a, b) => a.from - b.from);
  let total = 0;
  let cur: { from: number; to: number } | null = null;
  for (const s of clipped) {
    if (cur && s.from <= cur.to) cur.to = Math.max(cur.to, s.to);
    else {
      if (cur) total += cur.to - cur.from;
      cur = { ...s };
    }
  }
  if (cur) total += cur.to - cur.from;
  const hours = Math.floor(total / 60_000) / 60;
  return typeof most === 'number' && most >= 0 ? Math.min(hours, most) : hours;
}

/**
 * A kept day with an approved official duty on it (owner, 23 October 2026: "OD counted as attended"; "If they forget, the
 * approved hours still count as attended"): a day without a check-in (absent, Zoho's present without one, Zoho's leave)
 * is worked for the duty's hours; a day worked counts the duty's hours with its own, overlaps once (a full day: at least
 * the shift's hours a day), within the shift's window and its most a day. A day of leave, a holiday and a rest day stay as
 * they are. The duty is kept on the day (`od`) for the pages to show.
 */
export function withOfficialDuty<D extends KeptDay>(day: D, od: DayOfficialDuty, shift: CountingShift | null): D {
  if (day.status === 'leave' || day.status === 'holiday' || day.status === 'rest') return day;
  const kept = { ...day, od };
  if (day.status !== 'worked') return { ...kept, status: 'worked', hoursCounted: od.hours };
  if (od.fullDay) return { ...kept, hoursCounted: toMinute(Math.max(day.hoursCounted, od.hours)) };
  if (!day.checkIn || !day.checkOut) return { ...kept, hoursCounted: toMinute(Math.max(day.hoursCounted, od.hours)) };
  const part = partMoments(day.date, od, shift);
  if (!part) return kept;
  const hours = unionHours([{ from: Date.parse(day.checkIn), to: Date.parse(day.checkOut) }, part], shift ? shiftWindowOn(day.date, shift) : null, shift ? mostHoursCountedADay(shift) : null);
  return { ...kept, hoursCounted: toMinute(Math.max(day.hoursCounted, hours)) };
}

/** What a month's days are read against for its official duties: today, the first check-in on the system, the employment, the shift. */
export interface OfficialDutyContext {
  today: string;
  checkInFrom: string | null;
  employedFrom: string | null;
  employedTo: string | null;
  shift: CountingShift | null;
}

/**
 * A person's days with their approved official duties (`duties`, by date): each day kept or gone by with one on it
 * (withOfficialDuty), and each duty day up to today with no day at all, worked for its hours, from their first check-in
 * on the system on (before it only Zoho's import keeps days: a Zoho day absent there is read as the duty's) and within
 * their employment. In date order.
 */
export function officialDutyDays<D extends SourcedDay>(days: readonly D[], duties: ReadonlyMap<string, DayOfficialDuty>, ctx: OfficialDutyContext): (D | SourcedDay)[] {
  if (!duties.size) return [...days];
  const out: (D | SourcedDay)[] = days.map((d) => {
    const od = duties.get(d.date);
    return od ? withOfficialDuty(d, od, ctx.shift) : d;
  });
  if (ctx.checkInFrom) {
    const known = new Set(days.map((d) => d.date));
    for (const [date, od] of duties) {
      if (known.has(date) || date < ctx.checkInFrom || date > ctx.today) continue;
      if ((ctx.employedFrom && date < ctx.employedFrom) || (ctx.employedTo && date > ctx.employedTo)) continue;
      out.push({ date, status: 'worked', checkIn: null, checkOut: null, place: null, zohoStatus: null, permissionHours: 0, hoursCounted: od.hours, source: 'system', flags: [], od });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

// ---------- helpers ----------

const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const isDate = (s: unknown): s is string => typeof s === 'string' && DATE.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
const isTime = (s: unknown): s is string => typeof s === 'string' && TIME.test(s);
const plusDays = (ymd: string, n: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
/** A date as messages show it: DD/MM/YYYY. */
const shown = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}`;
const toMinute = (hours: number) => Math.round(hours * 60) / 60 + 0;
