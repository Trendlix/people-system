// Attendance corrections (owner, 19 October 2026, pasting the list and writing "Proceed with those": "Attendance
// corrections with approval ("I forgot to check out")"). An employee asks to correct a day from My Attendance → the
// day → Ask for a correction: what was wrong (they forgot to check in, forgot to check out, a time is wrong, they worked
// remotely or at a client), the right times and why (required); only a day gone by or today, never one still to come,
// asked by the end of the 2nd working day after it (owner, 31 October 2026: "asking for correction is to be locked after
// 2 working days": correctionAskFrom; HR still corrects any day directly), and only in a month whose payroll isn't
// approved yet. It is decided as leave is (leaves.ts: LEAVE_STATUSES,
// LEAVE_STAGES, LEAVE_STEP_KINDS): the direct manager, else the team lead, else the department's head
// (department-leads.ts approverInCharge), then HR, a C-level person's HR stage by the CEO (confidential.ts); every step
// logged, cancelled by its employee while it is being decided. Approved, the day is changed: kept as source
// 'correction' over the day it corrects, which stays as it was (shown "corrected from …"), its hours counted again by
// the shift's rule, and the month's draft payroll line refilled. HR may also correct a day directly, with a reason,
// approved at once. Pure: the API enforces these and the web shows the same checks. Dates YYYY-MM-DD, times HH:MM
// (Cairo), moments ISO. A day kept as its pairs (owner, 25 October 2026: "Count the closed pairs, flag the open one"): a
// correction giving both times replaces the day's presses with that one pair, as before; one giving the check-out alone
// closes the day's open last check-in (its missing check-out, "flag the open one" for HR to correct), else moves its
// last check-out; one giving the check-in alone moves its first check-in; the day's other pairs stay. Its hours from its
// first check-in to its last finished check-out, breaks counted (owner, 31 October 2026: "9:00, break included";
// correctedDay). A time not yet come is
// refused (reported 25 October 2026: a correction asked at 00:30 set that day's check-in to 08:55; owner, 26 October
// 2026: "yes", refuse it): a check-in or check-out after now in Cairo, when asked, when HR corrects directly, and again at
// each approval, so one asked for earlier still isn't approved before its time (notYetComeProblems). A new employee's
// first day (owner, 27 October 2026: "a new employee when checked in in his first day move the checkin to 9am
// automatically to prevent delay in instructions"; "Counted from the shift start"): a correction over it keeps the rule
// (correctedDay with `firstDay`, as check-in.ts dayFromPunches): its first pair runs from the shift's start, the day's
// check-in stays the press (or the time HR gave), so the new employee who forgot to check out isn't short once corrected.

import { breakMinutesOf, mostHoursCountedADay, shiftWindowOn, spanHours, spansOfPairs, workSpanOf, zonedMoment, type PressPair, type ShiftWindowTimes, type TimeSpan } from './attendance.js';
import type { AttendanceDayStatus } from './attendance-import.js';
import { cairoClock, cairoDay, fromShiftStart, isCheckInFlag, type AttendanceSource, type CheckInFlag, type CountingShift, type DayCountOptions, type DayPlace } from './check-in.js';
import { DEFAULT_WORKING_DAYS } from './leaves.js';

/** What was wrong with the day. */
export const CORRECTION_KINDS = ['forgot_check_in', 'forgot_check_out', 'wrong_time', 'worked_remotely'] as const;
export type CorrectionKind = (typeof CORRECTION_KINDS)[number];

export const isCorrectionKind = (v: unknown): v is CorrectionKind => (CORRECTION_KINDS as readonly unknown[]).includes(v);

/**
 * The kinds a new correction can be (owner, 31 October 2026, asked whether "I worked remotely or at a client" isn't the
 * same as official duty: "Remove it, point to OD"): work away from the office is asked for as official duty (or work from
 * home), so a new correction is a check-in or check-out forgotten or a time wrong. The corrections of that kind made
 * before stay as they were, and still apply as they did.
 */
export const CORRECTION_KINDS_ASKED = ['forgot_check_in', 'forgot_check_out', 'wrong_time'] as const satisfies readonly CorrectionKind[];

/** What someone choosing to correct a day of work away from the office is told instead. */
export const CORRECTION_AWAY_TEXT = 'Working away from the office (at a client, a shoot, an errand) is official duty: ask for official duty instead, or work from home for a day at home.';

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
  /** Its check-in → check-out pairs and open last check-in (owner, 25 October 2026); none: not kept by pairs. */
  pairs?: readonly PressPair[] | null;
  openAt?: string | null;
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
  /**
   * The moment now (ms), for a time not yet come (26 October 2026): a check-in or check-out after it is refused. None:
   * not checked (the web form before it knows the time; the API always gives it).
   */
  now?: number | null;
  /**
   * The earliest day the employee can still ask to correct (correctionAskFrom; owner, 31 October 2026: "locked after 2
   * working days"): a day before it is refused. None: not checked (HR correcting a day directly).
   */
  askFrom?: string | null;
}

/**
 * How long a day can be asked to be corrected (owner, 31 October 2026: "asking for correction is to be locked after 2
 * working days, i cant ask for correction after a week for example"): on the day itself and until the end of the 2nd
 * working day after it. HR still corrects any day directly (while its month's payroll allows it).
 */
export const CORRECTION_ASK_WORKING_DAYS = 2;

/** How far back correctionAskFrom looks: a day longer ago is never open (a long leave in between included). */
export const CORRECTION_ASK_LOOK_BACK = 60;

/** "2026-10-31" → "2026-10-30". */
const dayBefore = (ymd: string, n = 1) => new Date(Date.parse(`${ymd}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);

/**
 * The earliest day (YYYY-MM-DD) someone can still ask to correct on `today` (owner, 31 October 2026: "locked after 2
 * working days"): a day is open while fewer than CORRECTION_ASK_WORKING_DAYS of their working days have gone by after it,
 * counting the days strictly between it and today. A working day is one of their shift's weekdays (`workingDays`, 0 =
 * Sunday; none known: Sunday to Thursday) that is neither an official holiday nor a day of their approved leave
 * (`offDays`, YYYY-MM-DD), so a day off doesn't eat into the time to ask. On a Sunday-to-Thursday shift: Tuesday's day is
 * open until Thursday, Thursday's until the Monday after. Never further back than CORRECTION_ASK_LOOK_BACK days.
 */
export function correctionAskFrom(today: string, workingDays: readonly number[] | null | undefined, offDays: Iterable<string> = []): string {
  const working = new Set(workingDays?.length ? workingDays : DEFAULT_WORKING_DAYS);
  const off = new Set(offDays);
  let passed = 0;
  let earliest = today;
  for (let i = 1; i <= CORRECTION_ASK_LOOK_BACK; i++) {
    // the day `i` days back has the days after it up to yesterday between it and today: one more than the day before had
    if (i >= 2) {
      const between = dayBefore(today, i - 1);
      if (working.has(new Date(`${between}T00:00:00Z`).getUTCDay()) && !off.has(between)) passed++;
    }
    if (passed >= CORRECTION_ASK_WORKING_DAYS) break;
    earliest = dayBefore(today, i);
  }
  return earliest;
}

/** Why a day before `askFrom` can't be asked about any more, in words. */
export const correctionTooLateText = (date: string) =>
  `It’s too late to ask to correct ${shown(date)}: ask within ${CORRECTION_ASK_WORKING_DAYS} working days of the day. HR can still correct it for you.`;

const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const blank = (s: string | null | undefined) => (typeof s === 'string' && s.trim() !== '' ? s.trim() : null);
const shown = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}`;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthName = (ymd: string) => `${MONTHS[Number(ymd.slice(5, 7)) - 1]} ${ymd.slice(0, 4)}`;
const nextDate = (ymd: string) => new Date(Date.parse(`${ymd}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
const crossesMidnight = (shift: ShiftWindowTimes | null) => !!shift && shift.endTime.slice(0, 5) <= shift.startTime.slice(0, 5);

/** What the one asking (or HR correcting directly) is told to do about a time not yet come. */
export const NOT_YET_COME_LEAD = 'Choose a time that has passed';
/** What the manager or HR approving is told (an approval checks it again). */
export const NOT_YET_COME_APPROVAL_LEAD = 'Approve it once the time has passed';

/**
 * The times not yet come, in words (reported 25 October 2026: asked at 00:30 to set that day's check-in to 08:55; owner,
 * 26 October 2026: "yes", refuse it): each moment after `now` (ms), "Choose a time that has passed: 8:55 AM today hasn't
 * come yet." ("tomorrow" for a night shift's check-out on the next morning). A moment at `now` or before is fine, so a
 * day gone by is unaffected, as is a night shift's check-out on the next day once it has passed. The moments are a
 * correction's check-in and check-out (and any pair's), ISO; none given are skipped. `lead`: what to do about it.
 */
export function notYetComeProblems(moments: readonly (string | Date | null | undefined)[], now: number, lead: string = NOT_YET_COME_LEAD): string[] {
  const today = cairoDay(now);
  const problems: string[] = [];
  for (const moment of moments) {
    const ms = moment ? new Date(moment).getTime() : Number.NaN;
    if (!Number.isFinite(ms) || ms <= now) continue;
    const day = cairoDay(ms);
    const when = day === today ? 'today' : day === nextDate(today) ? 'tomorrow' : `on ${shown(day)}`;
    const text = `${lead}: ${cairoClock(ms)} ${when} hasn't come yet.`;
    if (!problems.includes(text)) problems.push(text);
  }
  return problems;
}

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
 * Why a correction can't be sent (none: it can), in the order to fix them: the day (gone by or today, and an employee's
 * own within CORRECTION_ASK_WORKING_DAYS working days of it, with `ctx.askFrom`; 31 October 2026), what was wrong,
 * why (required, at most 500 characters), the times (HH:MM); a month whose payroll is approved; a correction of the day
 * already being decided; a day of leave; then what each kind needs: forgot to check in, the time they came in (and no
 * check-in on record); forgot to check out, the time they left (and no check-out on record); a time wrong, a time other
 * than the one on record; worked remotely or at a client, a check-in (typed or on record); a time typed that hasn't come
 * yet (with `ctx.now`; 26 October 2026); and the time they left after the time they came in.
 */
export function correctionProblems(input: CorrectionInput, ctx: CorrectionContext): string[] {
  const you = ctx.name ? `${ctx.name} has` : 'You have';
  if (!DATE.test(input.date)) return ['Enter the day to correct, e.g. 2026-10-12.'];
  const when = shown(input.date);
  if (input.date > ctx.today) return [`${when} is still to come: only a day gone by, or today, can be corrected.`];
  // asked too long after the day (owner, 31 October 2026: "locked after 2 working days")
  if (ctx.askFrom && input.date < ctx.askFrom) return [correctionTooLateText(input.date)];
  const problems: string[] = [];
  if (input.kind === 'worked_remotely') problems.push(CORRECTION_AWAY_TEXT);
  else if (!(CORRECTION_KINDS_ASKED as readonly string[]).includes(input.kind)) problems.push(`Choose what was wrong: ${CORRECTION_KINDS_ASKED.map((k) => CORRECTION_KIND_LABELS[k]).join(', ').toLowerCase()}.`);
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
    // a last check-in without a check-out after the day's pairs is the check-out forgotten (25 October 2026)
    if (!outTime) problems.push(`Enter the time ${ctx.name ? 'they' : 'you'} left.`);
    else if (day?.checkOut && !day.openAt) problems.push(`${ctx.name ? `${ctx.name} checked` : 'You checked'} out at ${recorded(day.checkOut)} on ${when} already: choose “${CORRECTION_KIND_LABELS.wrong_time}” to change it.`);
  } else if (kind === 'wrong_time') {
    if (!inTime && !outTime) problems.push('Enter the right time of the check-in, of the check-out, or both.');
    else if (!day?.checkIn && !day?.checkOut) problems.push(`There is no check-in or check-out on ${when} to correct: choose “${CORRECTION_KIND_LABELS.forgot_check_in}”.`);
  } else if (!inTime && !day?.checkIn) problems.push(`Enter the time ${ctx.name ? 'they' : 'you'} started work on ${when}.`);
  if (problems.length) return problems;

  const moments = correctionMoments(input.date, input, day, ctx.shift);
  // a time not yet come (owner, 26 October 2026: "yes"), as the moment it is (a night shift's check-out the next morning)
  if (typeof ctx.now === 'number' && Number.isFinite(ctx.now)) {
    problems.push(...notYetComeProblems([moments.checkIn, moments.checkOut], ctx.now));
    if (problems.length) return problems;
  }
  if (kind === 'wrong_time' && sameMoment(moments.checkIn, day?.checkIn ?? null, !!inTime) && sameMoment(moments.checkOut, day?.checkOut ?? null, !!outTime)) {
    problems.push(`Those are the times on record for ${when} already.`);
  }
  const checkIn = moments.checkIn ?? day?.checkIn ?? null;
  const checkOut = moments.checkOut ?? day?.checkOut ?? null;
  if (checkIn && checkOut && Date.parse(checkOut) <= Date.parse(checkIn)) {
    problems.push(`The check-out (${cairoClock(checkOut)}) must be after the check-in (${cairoClock(checkIn)}) on the same day.`);
  } else if (kind === 'forgot_check_out' && moments.checkOut && day?.openAt && Date.parse(moments.checkOut) <= Date.parse(day.openAt)) {
    // closing the open last check-in (25 October 2026): after it
    problems.push(`The check-out (${cairoClock(moments.checkOut)}) must be after the last check-in (${cairoClock(day.openAt)}), the one without a check-out.`);
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
  /** Its pairs, its open last check-in (null: none) and the break between them (owner, 25 October 2026). */
  pairs: PressPair[];
  openAt: string | null;
  breakMinutes: number;
}

/**
 * The day a correction makes of the one on record (owner's brief, 19 October 2026: "Approved → the day is changed
 * (source 'correction', the original times kept …), hours recounted"): the right times over those on record, worked;
 * worked remotely or at a client, remote and no longer flagged (the manager and HR approved it); its hours counted by
 * the shift's rule within its window moved by the grace (attendance.ts). By its pairs (owner, 25 October 2026: "the
 * working hours to be calculated between the checkin and out only, not the first and last"; "Not short until
 * corrected"): both times given, the day is that one pair (its presses replaced, as before); the check-out alone closes
 * the open last check-in when after it, else ends the last pair there (a pair starting after it dropped); the check-in
 * alone starts the first pair there (a pair ending before it dropped), the only check-in of a day without pairs, or
 * pairs with a check-out that had none. A day not kept by pairs (Zoho's, one gone by) is its check-in to its check-out.
 * Its hours (owner, 31 October 2026: "9:00, break included") from the first check-in of its pairs to the last finished
 * check-out, breaks counted (attendance.ts workSpanOf), within the window, at most the shift's hours a day.
 * On the first working day of the person's employment (`firstDay`; owner, 27 October 2026: "Counted from the shift
 * start") the first pair runs from the shift's start when its check-in is after it (check-in.ts fromShiftStart), as a
 * press keeps the day; the day's check-in stays as recorded (the press, or the time given).
 */
export function correctedDay(base: CorrectableDay | CorrectedDay | null, c: AppliedCorrection, date: string, shift: CountingShift | null, options: DayCountOptions = {}): CorrectedDay {
  const remote = c.kind === 'worked_remotely';
  // each moment as it was given (an ISO string kept as it is)
  const given = new Map<number, string>();
  const ms = (iso: string | null | undefined): number | null => {
    if (!iso) return null;
    const m = Date.parse(iso);
    if (!Number.isFinite(m)) return null;
    if (!given.has(m)) given.set(m, iso);
    return m;
  };
  const iso = (m: number) => given.get(m) ?? new Date(m).toISOString();
  const [baseIn, baseOut] = [ms(base?.checkIn), ms(base?.checkOut)];
  for (const p of base?.pairs ?? []) {
    ms(p.in);
    ms(p.out);
  }
  let pairs: TimeSpan[] = base?.pairs ? spansOfPairs(base.pairs) : baseIn !== null && baseOut !== null && baseOut > baseIn ? [{ from: baseIn, to: baseOut }] : [];
  let open: number | null = base?.pairs ? ms(base.openAt) : baseIn !== null && baseOut === null ? baseIn : null;
  // a time typed as it is on record (to the minute) changes nothing: the other one alone is corrected
  const minute = (m: number | null) => (m === null ? null : Math.floor(m / 60_000));
  const firstOnRecord = minute(Math.min(pairs[0]?.from ?? Number.POSITIVE_INFINITY, open ?? Number.POSITIVE_INFINITY));
  const lastOnRecord = open === null && pairs.length ? minute(pairs[pairs.length - 1].to) : null;
  let [cin, cout] = [ms(c.checkIn), ms(c.checkOut)];
  if (cin !== null && cout !== null) {
    if (minute(cin) === firstOnRecord) cin = null;
    else if (minute(cout) === lastOnRecord) cout = null;
  }
  if (cin !== null && cout !== null) {
    // both times: the day is that one pair, its presses replaced
    pairs = cout > cin ? [{ from: cin, to: cout }] : [];
    open = cout > cin ? null : cin;
  } else if (cout !== null) {
    if (open !== null && cout > open) {
      // the check-out forgotten: closes the open last check-in
      pairs = [...pairs, { from: open, to: cout }];
      open = null;
    } else if (pairs.length) {
      // the last check-out at another time: the pairs before it, the last ending then
      const kept = pairs.filter((p) => p.from < cout).map((p) => ({ ...p }));
      if (kept.length) kept[kept.length - 1].to = cout;
      pairs = kept;
    }
  } else if (cin !== null) {
    if (pairs.length) {
      // the first check-in at another time: the pairs after it, the first starting then
      const kept = pairs.filter((p) => p.to > cin).map((p) => ({ ...p }));
      if (kept.length) kept[0].from = cin;
      else if (open === null) open = cin;
      pairs = kept;
    } else if (open !== null) open = cin;
    else if (baseOut !== null && baseOut > cin) pairs = [{ from: cin, to: baseOut }];
    else open = cin;
  }
  const window = shift ? shiftWindowOn(date, shift) : null;
  // a new employee's first day (27 October 2026): the first pair from the shift's start, as a press keeps the day
  const counted = options.firstDay ? fromShiftStart(pairs, window) : pairs;
  // from the first check-in to the last finished check-out, breaks included (owner, 31 October 2026: "9:00, break included")
  const hours = spanHours(workSpanOf(counted), window, shift ? mostHoursCountedADay(shift) : null);
  const firstIn = Math.min(pairs[0]?.from ?? Number.POSITIVE_INFINITY, open ?? Number.POSITIVE_INFINITY);
  // the day's check-in: the one given; else the day's as recorded when it lies in its first pair (a first day's press
  // after the shift's start the pair was moved to, 27 October 2026); else the first pair's start or the open check-in
  const recorded = cin === null && baseIn !== null && pairs.length > 0 && baseIn >= pairs[0].from && baseIn <= pairs[0].to ? baseIn : null;
  const checkIn = cin !== null ? iso(cin) : recorded !== null ? iso(recorded) : Number.isFinite(firstIn) ? iso(firstIn) : null;
  // a check-out with no check-in at all (forgot to check in, not yet corrected): as given, or as on record
  const checkOut = counted.length ? iso(counted[counted.length - 1].to) : checkIn ? null : (c.checkOut ?? base?.checkOut ?? null);
  return {
    status: 'worked',
    checkIn,
    checkOut,
    place: remote ? 'remote' : (base?.place ?? null),
    flags: remote ? [] : (base?.flags ?? []).filter(isCheckInFlag),
    hoursCounted: Math.round(hours * 60) / 60,
    pairs: counted.map((p) => ({ in: iso(p.from), out: iso(p.to) })),
    openAt: open === null ? null : iso(open),
    breakMinutes: breakMinutesOf(counted, open, window),
  };
}

/** The day a correction was applied over, as kept with it (AttendanceDay.correctedFrom); null: no day on record. */
export interface CorrectedFrom {
  source: AttendanceSource;
  status: AttendanceDayStatus;
  checkIn: string | null;
  checkOut: string | null;
  place: DayPlace | null;
  /** Its pairs and open last check-in, when it was kept by them (owner, 25 October 2026); missing on one from before. */
  pairs?: PressPair[] | null;
  openAt?: string | null;
}

/** "Corrected from 9:30 AM – no check-out", "Corrected from absent", "Corrected from no day on record". */
export function correctedFromText(from: CorrectedFrom | null | undefined): string {
  if (!from) return 'Corrected from no day on record';
  // a day of several pairs, or with an open last check-in (25 October 2026): each, "9:02 AM – 1:10 PM · 2:00 PM – no check-out"
  if ((from.pairs && from.pairs.length > 1) || (from.openAt && from.pairs?.length)) {
    const parts = [...from.pairs.map((p) => `${cairoClock(p.in)} – ${cairoClock(p.out)}`), ...(from.openAt ? [`${cairoClock(from.openAt)} – no check-out`] : [])];
    return `Corrected from ${parts.join(' · ')}`;
  }
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
