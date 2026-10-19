// Attendance corrections (owner, 19 October 2026, pasting the list and writing "Proceed with those": "Attendance
// corrections with approval ("I forgot to check out")"). An employee asks to correct a day from My Attendance → the
// day → Ask for a correction: what was wrong (they forgot to check in, forgot to check out, a time is wrong, they worked
// remotely or at a client), the right times and why (required); only a day gone by or today, never one still to come,
// and only in a month whose payroll isn't approved yet. It is decided as leave is (leaves.ts: LEAVE_STATUSES,
// LEAVE_STAGES, LEAVE_STEP_KINDS): the direct manager, else the team lead, else the department's head
// (department-leads.ts approverInCharge), then HR, a C-level person's HR stage by the CEO (confidential.ts); every step
// logged, cancelled by its employee while it is being decided. Approved, the day is changed: kept as source
// 'correction' over the day it corrects, which stays as it was (shown "corrected from …"), its hours counted again by
// the shift's rule, and the month's draft payroll line refilled. HR may also correct a day directly, with a reason,
// approved at once. Pure: the API enforces these and the web shows the same checks. Dates YYYY-MM-DD, times HH:MM
// (Cairo), moments ISO.

import { hoursCountedForDay, mostHoursCountedADay, shiftWindowOn, zonedMoment, type ShiftWindowTimes } from './attendance.js';
import type { AttendanceDayStatus } from './attendance-import.js';
import { cairoClock, isCheckInFlag, type AttendanceSource, type CheckInFlag, type CountingShift, type DayPlace } from './check-in.js';

/** What was wrong with the day. */
export const CORRECTION_KINDS = ['forgot_check_in', 'forgot_check_out', 'wrong_time', 'worked_remotely'] as const;
export type CorrectionKind = (typeof CORRECTION_KINDS)[number];

export const isCorrectionKind = (v: unknown): v is CorrectionKind => (CORRECTION_KINDS as readonly unknown[]).includes(v);

/** As the employee chooses it (owner's brief, 19 October 2026: "I forgot to check out"). */
export const CORRECTION_KIND_LABELS: Record<CorrectionKind, string> = {
  forgot_check_in: 'I forgot to check in',
  forgot_check_out: 'I forgot to check out',
  wrong_time: 'A time is wrong',
  worked_remotely: 'I worked remotely or at a client',
};

/** As the lists, HR and the manager say it. */
export const CORRECTION_KIND_NAMES: Record<CorrectionKind, string> = {
  forgot_check_in: 'Forgot to check in',
  forgot_check_out: 'Forgot to check out',
  wrong_time: 'Wrong time',
  worked_remotely: 'Worked remotely or at a client',
};

/** What the screens call a correction. */
export const CORRECTION_LABEL = 'Attendance correction';

export const CORRECTION_REASON_MAX = 500;

/** A day as it is shown when a correction is asked for or applied over (none: no day on record). */
export interface CorrectableDay {
  status: AttendanceDayStatus;
  checkIn: string | null;
  checkOut: string | null;
  place: DayPlace | null;
  source: AttendanceSource;
  flags?: readonly string[];
  zohoStatus?: string | null;
  permissionHours?: number;
  hoursCounted?: number;
}

/** A correction as typed: the day, what was wrong, the right times (HH:MM, Cairo; none: as on record) and why. */
export interface CorrectionInput {
  date: string;
  kind: string;
  checkIn?: string | null;
  checkOut?: string | null;
  reason?: string | null;
}

/** What a correction is checked against, besides what was typed. */
export interface CorrectionContext {
  /** Today in Cairo. */
  today: string;
  /** The status of the day's month's payroll run; none: no run yet. */
  runStatus: string | null;
  /** The day as shown now (a correction already approved counted); null: no day on record. */
  day: CorrectableDay | null;
  /** Their shift, for a check-out after midnight; null: none. */
  shift: ShiftWindowTimes | null;
  /** Whether a correction of the day is being decided already. */
  open: boolean;
  /** The employee's name when HR corrects the day directly; null for the employee's own ("you"). */
  name?: string | null;
}

const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const blank = (s: string | null | undefined) => (typeof s === 'string' && s.trim() !== '' ? s.trim() : null);
const shown = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}`;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthName = (ymd: string) => `${MONTHS[Number(ymd.slice(5, 7)) - 1]} ${ymd.slice(0, 4)}`;
const nextDate = (ymd: string) => new Date(Date.parse(`${ymd}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
const crossesMidnight = (shift: ShiftWindowTimes | null) => !!shift && shift.endTime.slice(0, 5) <= shift.startTime.slice(0, 5);

/**
 * The right times as moments (ISO): on the day in Cairo; a check-out earlier than the check-in (given or on record) is
 * the next morning's only on a shift that runs past midnight. A time not given is null (as on record).
 */
export function correctionMoments(
  date: string,
  input: Pick<CorrectionInput, 'checkIn' | 'checkOut'>,
  day: Pick<CorrectableDay, 'checkIn'> | null,
  shift: ShiftWindowTimes | null,
): { checkIn: string | null; checkOut: string | null } {
  const inTime = blank(input.checkIn);
  const outTime = blank(input.checkOut);
  const at = (d: string, t: string) => {
    const m = zonedMoment(d, t);
    return Number.isFinite(m) ? new Date(m).toISOString() : null;
  };
  const checkIn = inTime && TIME.test(inTime) ? at(date, inTime) : null;
  let checkOut = outTime && TIME.test(outTime) ? at(date, outTime) : null;
  const start = checkIn ?? day?.checkIn ?? null;
  if (checkOut && start && Date.parse(checkOut) <= Date.parse(start) && crossesMidnight(shift)) checkOut = at(nextDate(date), outTime!);
  return { checkIn, checkOut };
}

/**
 * Why a correction can't be sent (none: it can), in the order to fix them: the day (gone by or today), what was wrong,
 * why (required, at most 500 characters), the times (HH:MM); a month whose payroll is approved; a correction of the day
 * already being decided; a day of leave; then what each kind needs: forgot to check in, the time they came in (and no
 * check-in on record); forgot to check out, the time they left (and no check-out on record); a time wrong, a time other
 * than the one on record; worked remotely or at a client, a check-in (typed or on record); and the time they left after
 * the time they came in.
 */
export function correctionProblems(input: CorrectionInput, ctx: CorrectionContext): string[] {
  const you = ctx.name ? `${ctx.name} has` : 'You have';
  if (!DATE.test(input.date)) return ['Enter the day to correct, e.g. 2026-10-12.'];
  const when = shown(input.date);
  if (input.date > ctx.today) return [`${when} is still to come: only a day gone by, or today, can be corrected.`];
  const problems: string[] = [];
  if (!(CORRECTION_KINDS as readonly string[]).includes(input.kind)) problems.push(`Choose what was wrong: ${Object.values(CORRECTION_KIND_LABELS).join(', ').toLowerCase()}.`);
  const reason = blank(input.reason);
  if (!reason) problems.push('Write why the day needs correcting, e.g. I left for a client meeting and forgot to check out.');
  else if (reason.length > CORRECTION_REASON_MAX) problems.push(`Keep the reason to ${CORRECTION_REASON_MAX} characters; it has ${reason.length}.`);
  const inTime = blank(input.checkIn);
  const outTime = blank(input.checkOut);
  if (inTime && !TIME.test(inTime)) problems.push('Enter the time of the check-in as HH:MM, e.g. 09:05.');
  if (outTime && !TIME.test(outTime)) problems.push('Enter the time of the check-out as HH:MM, e.g. 18:30.');
  if (ctx.runStatus === 'approved' || ctx.runStatus === 'paid') {
    problems.push(`The ${monthName(input.date)} payroll is ${ctx.runStatus === 'paid' ? 'paid' : 'approved'}, so its days can't be corrected any more.`);
  }
  if (ctx.open) problems.push(ctx.name ? `${ctx.name} asked to correct ${when} already: decide that request first.` : `You asked to correct ${when} already: wait for it to be decided, or cancel it.`);
  const day = ctx.day;
  if (day?.status === 'leave') problems.push(`${you} approved leave on ${when}: there is no attendance to correct on a day of leave.`);
  if (problems.length || !isCorrectionKind(input.kind)) return problems;

  const kind = input.kind;
  const recorded = (iso: string | null) => (iso ? cairoClock(iso) : null);
  if (kind === 'forgot_check_in') {
    if (!inTime) problems.push(`Enter the time ${ctx.name ? 'they' : 'you'} came in.`);
    else if (day?.checkIn) problems.push(`${ctx.name ? `${ctx.name} checked` : 'You checked'} in at ${recorded(day.checkIn)} on ${when} already: choose “${CORRECTION_KIND_LABELS.wrong_time}” to change it.`);
  } else if (kind === 'forgot_check_out') {
    if (!outTime) problems.push(`Enter the time ${ctx.name ? 'they' : 'you'} left.`);
    else if (day?.checkOut) problems.push(`${ctx.name ? `${ctx.name} checked` : 'You checked'} out at ${recorded(day.checkOut)} on ${when} already: choose “${CORRECTION_KIND_LABELS.wrong_time}” to change it.`);
  } else if (kind === 'wrong_time') {
    if (!inTime && !outTime) problems.push('Enter the right time of the check-in, of the check-out, or both.');
    else if (!day?.checkIn && !day?.checkOut) problems.push(`There is no check-in or check-out on ${when} to correct: choose “${CORRECTION_KIND_LABELS.forgot_check_in}”.`);
  } else if (!inTime && !day?.checkIn) problems.push(`Enter the time ${ctx.name ? 'they' : 'you'} started work on ${when}.`);
  if (problems.length) return problems;

  const moments = correctionMoments(input.date, input, day, ctx.shift);
  if (kind === 'wrong_time' && sameMoment(moments.checkIn, day?.checkIn ?? null, !!inTime) && sameMoment(moments.checkOut, day?.checkOut ?? null, !!outTime)) {
    problems.push(`Those are the times on record for ${when} already.`);
  }
  const checkIn = moments.checkIn ?? day?.checkIn ?? null;
  const checkOut = moments.checkOut ?? day?.checkOut ?? null;
  if (checkIn && checkOut && Date.parse(checkOut) <= Date.parse(checkIn)) {
    problems.push(`The check-out (${cairoClock(checkOut)}) must be after the check-in (${cairoClock(checkIn)}) on the same day.`);
  }
  return problems;
}

/** A moment given that is the one on record (or not given at all). */
const sameMoment = (given: string | null, recorded: string | null, typed: boolean) => !typed || (given !== null && recorded !== null && Date.parse(given) === Date.parse(recorded));

/** A correction as it is applied: what was wrong and the right moments (null: as on record). */
export interface AppliedCorrection {
  kind: CorrectionKind;
  checkIn: string | null;
  checkOut: string | null;
}

/** A day once corrected: worked, its times, where, its flags and the hours it counts. */
export interface CorrectedDay {
  status: 'worked';
  checkIn: string | null;
  checkOut: string | null;
  place: DayPlace | null;
  flags: CheckInFlag[];
  hoursCounted: number;
}

/**
 * The day a correction makes of the one on record (owner's brief, 19 October 2026: "Approved → the day is changed
 * (source 'correction', the original times kept …), hours recounted"): the right times over those on record, worked;
 * worked remotely or at a client, remote and no longer flagged (the manager and HR approved it); its hours counted by
 * the shift's rule within its window moved by the grace (attendance.ts).
 */
export function correctedDay(base: CorrectableDay | CorrectedDay | null, c: AppliedCorrection, date: string, shift: CountingShift | null): CorrectedDay {
  const checkIn = c.checkIn ?? base?.checkIn ?? null;
  const checkOut = c.checkOut ?? base?.checkOut ?? null;
  const remote = c.kind === 'worked_remotely';
  const hours = checkIn && checkOut ? hoursCountedForDay(checkIn, checkOut, shift ? mostHoursCountedADay(shift) : null, shift ? shiftWindowOn(date, shift) : null) : 0;
  return {
    status: 'worked',
    checkIn,
    checkOut,
    place: remote ? 'remote' : (base?.place ?? null),
    flags: remote ? [] : (base?.flags ?? []).filter(isCheckInFlag),
    hoursCounted: Math.round(hours * 60) / 60,
  };
}

/** The day a correction was applied over, as kept with it (AttendanceDay.correctedFrom); null: no day on record. */
export interface CorrectedFrom {
  source: AttendanceSource;
  status: AttendanceDayStatus;
  checkIn: string | null;
  checkOut: string | null;
  place: DayPlace | null;
}

/** "Corrected from 9:30 AM – no check-out", "Corrected from absent", "Corrected from no day on record". */
export function correctedFromText(from: CorrectedFrom | null | undefined): string {
  if (!from) return 'Corrected from no day on record';
  if (!from.checkIn && !from.checkOut) return from.status === 'worked' ? 'Corrected from no check-in or check-out' : `Corrected from ${from.status === 'absent' ? 'absent' : 'a day not worked'}`;
  return `Corrected from ${from.checkIn ? cairoClock(from.checkIn) : 'no check-in'} – ${from.checkOut ? cairoClock(from.checkOut) : 'no check-out'}`;
}

/** The right times of a correction as its row says them: "9:05 AM – 6:30 PM", "in at 9:05 AM", "out at 6:30 PM"; null without times. */
export function correctionTimesText(c: { checkIn: string | null; checkOut: string | null }): string | null {
  if (c.checkIn && c.checkOut) return `${cairoClock(c.checkIn)} – ${cairoClock(c.checkOut)}`;
  if (c.checkIn) return `in at ${cairoClock(c.checkIn)}`;
  if (c.checkOut) return `out at ${cairoClock(c.checkOut)}`;
  return null;
}

/**
 * Why the day's correction can't be applied now, once its last stage approves it (owner's brief, 19 October 2026: "only
 * for days in months whose payroll run isn't approved yet"): the month's payroll approved or paid, or with the CEO (a run
 * with the CEO never changes, so it would miss the correction: returned to HR first). Null: it can.
 */
export function correctionApplyRefusal(date: string, runStatus: string | null): string | null {
  if (runStatus === 'approved' || runStatus === 'paid') return `The ${monthName(date)} payroll is ${runStatus === 'paid' ? 'paid' : 'approved'}, so its days can't be corrected any more.`;
  if (runStatus === 'pending_ceo') return `The ${monthName(date)} payroll is with the CEO, so the correction would miss it: ask the CEO to return it to HR, then approve the correction.`;
  return null;
}
