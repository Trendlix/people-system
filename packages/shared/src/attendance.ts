// Attendance's rules: payroll's worked hours are a month's total, typed on the run or filled from Zoho People's
// attendance (attendance-import.ts), whose days the Attendance section shows (attendance-days.ts).
// The most hours counted a day (owner, 16 October 2026: "maximum working hours to be recorded per day is 9 hours between
// checkin and check out"): a day counts the time between check-in and check-out, never more than the shift's hours to
// work a day, however long the person stayed. The hours to work are the shift's (owner, 16 October 2026: "my company
// shift is to maintain 9 hours within the shift window, its like flexible shift"): set on the shift, else its whole
// window (payroll.ts shiftWorkHours); they are also the most counted a day, with no separate setting. Payroll warns when
// a month's worked hours typed are more than the most attendance could count (payroll.ts mostCountedHours). Only the
// time within the shift's window counts (owner, 17 October 2026: "i have a window the employee have to fill 9 hours
// within the window"): hoursCountedForDay with shiftWindowOn. The shift's grace minutes move the window's end (owner, 19
// October 2026: "grace period means that if the employee checked in 10:15 he can check out till 7:15 and the 9 hours are
// counted"): on the MORNING shift (9 hours within 9:00–19:00, 15 minutes' grace) the hours count until 19:15, still at
// most 9; a fixed shift's end moves the same.
// Make-up hours (owner, 20 October 2026, asked "if an employee failed to complete 9 hours in a da, can he work extra
// hours next day ? to raise his average?" and choosing within the same month: "within the same month with no working
// hours to be counted after 8 PM even if the check out was 11 PM / record the checkout time but count till the checkout
// window limit"): a shift may count hours until a time (its "Count hours until", Shift.countUntil: at or after its end,
// the same day; the MORNING shift's 8:00 PM). Then a day counts from the later of the check-in and the window's start
// to the earlier of the check-out and that time (never before the end and the grace), and is not capped at the hours to
// work (mostHoursCountedADay: null), so a long day fills the month's short hours (payroll.ts: the month's worked hours at
// most its expected hours while overtime isn't paid). The check-in and check-out are kept as they were; only the hours
// counted change. A shift without it counts as above.

import { shiftWorkHours, type ShiftTimes } from './payroll.js';

/**
 * The most hours attendance counts a day on a shift: its hours to work a day (owner, 16 October 2026: "maximum working
 * hours to be recorded per day is 9 hours between checkin and check out"). Null when the shift's hours can't be told,
 * and on a shift that counts hours until a time (owner, 20 October 2026: "within the same month with no working hours to
 * be counted after 8 PM"; makesUpHours): its day isn't capped, the time is its limit.
 */
export function mostHoursCountedADay(shift: ShiftTimes & Pick<ShiftWindowTimes, 'countUntil'>): number | null {
  return makesUpHours(shift) ? null : shiftWorkHours(shift);
}

/** A moment as a time in milliseconds; NaN when it isn't one. */
const momentOf = (v: Date | string | number) => (v instanceof Date ? v.getTime() : typeof v === 'number' ? v : Date.parse(v));

/** How far a time zone's clock is ahead of UTC at a moment, in milliseconds (Cairo: +2 hours, +3 in summer time). */
function zoneOffset(moment: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(moment));
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return Date.UTC(part('year'), part('month') - 1, part('day'), part('hour'), part('minute'), part('second')) - moment;
}

/**
 * The moment a day's local time is in a time zone, Cairo by default (its summer time included): "2026-10-18", "09:00" →
 * 2026-10-18T06:00:00Z. NaN when the day or the time isn't one.
 */
export function zonedMoment(day: string, time: string, timeZone = 'Africa/Cairo'): number {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  const t = /^(\d{2}):(\d{2})/.exec(time);
  if (!d || !t) return Number.NaN;
  const asUtc = Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3]), Number(t[1]), Number(t[2]));
  // twice, so a day the clocks change on lands on the right side of the change
  const first = asUtc - zoneOffset(asUtc, timeZone);
  return asUtc - zoneOffset(first, timeZone);
}

/** A shift's window on a day, as moments: its start that day and its end, the next day when it ends past midnight. */
export interface ShiftWindow {
  start: number;
  end: number;
}

/**
 * A shift's times and its grace minutes (none: no grace), as its window on a day is worked out from them, and the time
 * it counts hours until ("HH:mm"; owner, 20 October 2026: "no working hours to be counted after 8 PM even if the check
 * out was 11 PM"; none: its end and grace, as before).
 */
export type ShiftWindowTimes = Pick<ShiftTimes, 'startTime' | 'endTime'> & { graceMinutes?: number | null; countUntil?: string | null };

/** The grace minutes a window's end moves by: the shift's, whole minutes from 0 (none, or anything else: 0). */
export const graceOf = (shift: { graceMinutes?: number | null }): number =>
  typeof shift.graceMinutes === 'number' && Number.isFinite(shift.graceMinutes) && shift.graceMinutes > 0 ? Math.round(shift.graceMinutes) : 0;

const TIME_OF_DAY = /^([01]\d|2[0-3]):[0-5]\d$/;

/** A time of day as the messages say it, on the 12-hour clock: "20:00" → "8:00 PM"; as it is when it isn't one. */
export function timeOfDayText(hhmm: string): string {
  const t = hhmm.slice(0, 5);
  if (!TIME_OF_DAY.test(t)) return hhmm;
  const h = Number(t.slice(0, 2));
  return `${h % 12 === 0 ? 12 : h % 12}:${t.slice(3)} ${h < 12 ? 'AM' : 'PM'}`;
}

/**
 * Why a shift's "Count hours until" can't be saved (none: it can, or it isn't set; owner, 20 October 2026: "no working
 * hours to be counted after 8 PM even if the check out was 11 PM / record the checkout time but count till the checkout
 * window limit"): a time of day ("HH:mm") at or after the shift's end and on the same day, so before midnight (a shift
 * that runs past midnight: before it starts again). The API refuses what this refuses, and the shift form says it.
 */
export function countUntilProblems(shift: { startTime: string; endTime: string; countUntil?: string | null }): string[] {
  const until = shift.countUntil;
  if (until === null || until === undefined || until === '') return [];
  const [start, end, limit] = [shift.startTime.slice(0, 5), shift.endTime.slice(0, 5), until.slice(0, 5)];
  if (!TIME_OF_DAY.test(limit)) return ['Choose the time hours count until as a time of day, e.g. 8:00 PM.'];
  if (!TIME_OF_DAY.test(start) || !TIME_OF_DAY.test(end) || start === end) return [];
  const overnight = end < start;
  if (limit < end || (overnight && limit >= start)) {
    return [
      overnight
        ? `Choose a "Count hours until" time at or after the shift ends, ${timeOfDayText(end)}, and before it starts again, ${timeOfDayText(start)}.`
        : `Choose a "Count hours until" time at or after the shift ends, ${timeOfDayText(end)}, and before midnight.`,
    ];
  }
  return [];
}

/** The time a shift counts hours until ("HH:mm"): its "Count hours until" when set and allowed (countUntilProblems), else null. */
export function countUntilOf(shift: ShiftWindowTimes): string | null {
  const until = shift.countUntil;
  if (typeof until !== 'string' || until === '') return null;
  return countUntilProblems({ startTime: shift.startTime, endTime: shift.endTime, countUntil: until }).length ? null : until.slice(0, 5);
}

/**
 * Whether a shift's long days make up its short ones within the month (owner, 20 October 2026: "within the same month"):
 * it counts hours until a time (countUntilOf), so a day isn't capped at the hours to work.
 */
export const makesUpHours = (shift: ShiftWindowTimes): boolean => countUntilOf(shift) !== null;

/**
 * A shift's window on a day (YYYY-MM-DD, in Cairo): 09:00–19:00 on 18 October; 22:00–06:00 runs into the 19th. Its end
 * moves by the shift's grace minutes (owner, 19 October 2026: "if the employee checked in 10:15 he can check out till
 * 7:15 and the 9 hours are counted"): the MORNING shift's, with 15 minutes' grace, 09:00–19:15. A shift that counts
 * hours until a time (owner, 20 October 2026: "no working hours to be counted after 8 PM even if the check out was 11
 * PM"; countUntilOf) ends then instead, on the day its window ends, never before its end and grace: the MORNING shift
 * counting until 20:00, 09:00–20:00.
 */
export function shiftWindowOn(day: string, shift: ShiftWindowTimes, timeZone = 'Africa/Cairo'): ShiftWindow | null {
  // a shift that starts and ends at the same time has no hours to tell, as shiftHours says too
  if (shift.startTime.slice(0, 5) === shift.endTime.slice(0, 5)) return null;
  const start = zonedMoment(day, shift.startTime, timeZone);
  let endDay = day;
  let end = zonedMoment(day, shift.endTime, timeZone);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (end <= start) {
    const next = new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)) + 1));
    endDay = next.toISOString().slice(0, 10);
    end = zonedMoment(endDay, shift.endTime, timeZone);
  }
  if (!(end > start)) return null;
  // the grace after the end, as minutes of the clock: the same moment whatever the summer time
  const graced = end + graceOf(shift) * 60_000;
  // the time hours count until, the day the window ends (20 October 2026)
  const until = countUntilOf(shift);
  const limit = until ? zonedMoment(endDay, until, timeZone) : Number.NaN;
  return { start, end: Number.isFinite(limit) ? Math.max(limit, graced) : graced };
}

/**
 * The hours a day counts from a check-in and a check-out (moments: Dates or ISO strings with their offset, so a
 * check-out past midnight is after the check-in): the time between them within the shift's window that day (owner, 17
 * October 2026: "i have a window the employee have to fill 9 hours within the window": coming early or staying late
 * adds nothing; shiftWindowOn; none given: not clipped), in whole minutes, never more than `mostHours` (the shift's:
 * mostHoursCountedADay; null: no shift, or a shift that counts hours until a time, owner, 20 October 2026: not capped,
 * the window's end its limit), never below 0. 0 when either isn't a moment. One pair of hoursCountedForPresses (a day
 * from its first check-in to its last check-out, its breaks counted: owner, 31 October 2026), which every day's hours
 * are counted with.
 */
export function hoursCountedForDay(
  checkIn: Date | string,
  checkOut: Date | string,
  mostHours: number | null,
  window: ShiftWindow | null = null,
): number {
  return hoursCountedForPresses(
    [
      { kind: 'in', at: checkIn },
      { kind: 'out', at: checkOut },
    ],
    mostHours,
    window,
  );
}

// ---------- a day's check-in → check-out pairs (owner, 25 October 2026; its hours, 31 October 2026) ----------
// The owner, 25 October 2026: "on checkin and out several ttimes, the working hours to be calculated between the checkin
// and out only, not the first and last"; asked, "Count the closed pairs, flag the open one": a day is kept as its
// finished check-in → check-out pairs; a last check-in without a check-out pairs with nothing yet and is the day's open
// press, its check-out missing for HR to correct (attendance-days.ts). The day's check-in stays its first check-in
// (lateness by it, as before) and its check-out its last check-out. Its hours since 31 October 2026 (owner, asked about
// a day in at 9:00, out at 13:00, in at 14:00, out at 18:00: "9:00, break included"; "dont calculate breaks, they are
// included in the working hours"): from its first check-in to its last finished check-out (workSpanOf), the breaks
// between the pairs counted as work, within the shift's window (owner: "the shift is flexible, the employee has to achive
// 9 hours in the applicable checkin window"), at most the shift's hours a day. An open last check-in still adds nothing
// past the last finished check-out. The break (breakMinutesOf) is kept to show, no longer taken off.

/** A press as the pairing reads it: a check-in or a check-out, and its moment (a Date, an ISO string, milliseconds). */
export interface PressMoment {
  kind: string;
  at: Date | string | number;
}

/** A finished check-in → check-out pair, as a day keeps it: the moments, ISO. */
export interface PressPair {
  in: string;
  out: string;
}

/** A span of time in milliseconds: a pair, or part of a day of official duty (official-duty.ts). */
export interface TimeSpan {
  from: number;
  to: number;
}

/**
 * A day's presses paired (owner, 25 October 2026), in the order pressed (two at the same moment in the order given):
 * each check-in with the check-out after it. A check-in while already checked in starts nothing new (the earliest is
 * kept); after a check-in, several check-outs in a row end its pair at the last of them; a check-out with no check-in
 * before it pairs with nothing. A last check-in with no check-out after it is the day's open press (`open`, its moment;
 * null: none). Presses that aren't moments, or neither a check-in nor a check-out, are left out.
 */
export function pairPresses(presses: readonly PressMoment[]): { pairs: TimeSpan[]; open: number | null } {
  const sorted = presses
    .map((p, i) => ({ kind: p.kind, at: momentOf(p.at), i }))
    .filter((p) => Number.isFinite(p.at) && (p.kind === 'in' || p.kind === 'out'))
    .sort((a, b) => a.at - b.at || a.i - b.i);
  const pairs: TimeSpan[] = [];
  let start: number | null = null;
  let end: number | null = null;
  for (const p of sorted) {
    if (p.kind === 'in') {
      // already in, no check-out since: the earliest check-in kept
      if (start !== null && end === null) continue;
      if (start !== null && end !== null) pairs.push({ from: start, to: end });
      start = p.at;
      end = null;
    } else if (start !== null) {
      // the last check-out after a check-in ends its pair
      end = p.at;
    }
  }
  if (start !== null && end !== null) pairs.push({ from: start, to: end });
  return { pairs, open: start !== null && end === null ? start : null };
}

/**
 * The hours of time spans together within a window (none: not clipped), overlaps counted once (their union: a pair and
 * part of a day of official duty that cover the same time count it once), in whole minutes (a part minute of the total
 * isn't counted, as a day always was), never more than `mostHours` (null: not capped), never below 0.
 */
export function spanHours(spans: readonly TimeSpan[], window: ShiftWindow | null, mostHours: number | null): number {
  const clipped = spans
    .map((s) => (window ? { from: Math.max(s.from, window.start), to: Math.min(s.to, window.end) } : { ...s }))
    .filter((s) => Number.isFinite(s.from) && Number.isFinite(s.to) && s.to > s.from)
    .sort((a, b) => a.from - b.from);
  let total = 0;
  let cur: TimeSpan | null = null;
  for (const s of clipped) {
    if (cur && s.from <= cur.to) cur.to = Math.max(cur.to, s.to);
    else {
      if (cur) total += cur.to - cur.from;
      cur = { ...s };
    }
  }
  if (cur) total += cur.to - cur.from;
  // whole minutes: a part minute isn't counted
  const hours = Math.floor(total / 60_000) / 60;
  return typeof mostHours === 'number' && mostHours >= 0 ? Math.min(hours, mostHours) : hours;
}

/**
 * The time a day of pairs counts as worked (owner, 31 October 2026: "9:00, break included"; "dont calculate breaks, they
 * are included in the working hours"): one span from its first check-in to its last finished check-out, the breaks
 * between the pairs inside it; none without a finished pair. What it counts is then clipped to the shift's window and
 * capped (spanHours), as any day's.
 */
export function workSpanOf(pairs: readonly TimeSpan[]): TimeSpan[] {
  const finished = pairs.filter((p) => Number.isFinite(p.from) && Number.isFinite(p.to) && p.to >= p.from);
  if (!finished.length) return [];
  return [{ from: Math.min(...finished.map((p) => p.from)), to: Math.max(...finished.map((p) => p.to)) }];
}

/**
 * The hours a day counts from its presses (owner, 31 October 2026: "9:00, break included"): from the first check-in of
 * its finished check-in → check-out pairs (pairPresses) to the last finished check-out (workSpanOf), the breaks counted,
 * within the shift's window that day (shiftWindowOn; none given: not clipped), in whole minutes, never more than
 * `mostHours` (the shift's: mostHoursCountedADay; null: not capped). An open last check-in adds nothing past the last
 * finished check-out. `alsoSpans`: other time that counts as worked that day (part of a day of official duty,
 * official-duty.ts), its overlap with the day's span once.
 */
export function hoursCountedForPresses(
  presses: readonly PressMoment[],
  mostHours: number | null,
  window: ShiftWindow | null = null,
  alsoSpans: readonly TimeSpan[] = [],
): number {
  return spanHours([...workSpanOf(pairPresses(presses).pairs), ...alsoSpans], window, mostHours);
}

/**
 * The break of a day (owner, 25 October 2026): the time between its pairs (and between its last pair and an open last
 * check-in), within the shift's window (none: not clipped), to the nearest minute; 0 with one pair or none. Shown only:
 * since 31 October 2026 it counts in the day's hours (owner: "they are included in the working hours").
 */
export function breakMinutesOf(pairs: readonly TimeSpan[], open: number | null, window: ShiftWindow | null = null): number {
  const sorted = [...pairs].sort((a, b) => a.from - b.from);
  const gaps: TimeSpan[] = [];
  for (let i = 1; i < sorted.length; i++) gaps.push({ from: sorted[i - 1].to, to: sorted[i].from });
  if (open !== null && sorted.length) gaps.push({ from: sorted[sorted.length - 1].to, to: open });
  let total = 0;
  for (const g of gaps) {
    const from = window ? Math.max(g.from, window.start) : g.from;
    const to = window ? Math.min(g.to, window.end) : g.to;
    if (to > from) total += to - from;
  }
  return Math.round(total / 60_000);
}

/** Pairs as a day keeps them: their moments ISO. */
export const pressPairsOf = (pairs: readonly TimeSpan[]): PressPair[] => pairs.map((p) => ({ in: new Date(p.from).toISOString(), out: new Date(p.to).toISOString() }));

/** A day's kept pairs as spans (an entry that isn't two moments in order is left out). */
export const spansOfPairs = (pairs: readonly PressPair[] | null | undefined): TimeSpan[] =>
  (pairs ?? []).map((p) => ({ from: momentOf(p.in), to: momentOf(p.out) })).filter((s) => Number.isFinite(s.from) && Number.isFinite(s.to) && s.to >= s.from);

/** Whether a value read back from the database (a day's pairs, JSON) is a list of pairs; anything else is none. */
export function readPressPairs(value: unknown): PressPair[] | null {
  if (!Array.isArray(value)) return null;
  const out: PressPair[] = [];
  for (const v of value) {
    if (!v || typeof v !== 'object') return null;
    const { in: from, out: to } = v as Record<string, unknown>;
    if (typeof from !== 'string' || typeof to !== 'string' || !Number.isFinite(Date.parse(from)) || !Number.isFinite(Date.parse(to))) return null;
    out.push({ in: from, out: to });
  }
  return out;
}
