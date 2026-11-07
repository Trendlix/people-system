import { addDays, addMonths, weekday } from '../common/date-only.js';

// A sample account's history (owner, 7 November 2026: "the test account shows nothing after the login, allow apple
// testers to see some dummy data"): what the reviewers' test profile has done, as of today. The last two months and this
// one so far: a check-in and a check-out on every working day (a few minutes either side of the shift, one day late),
// two days of annual leave and a casual day taken, two hours' permission one morning, and two days of annual leave asked
// for next month, still with HR. Pure: sample-account.service.ts writes it. Today itself is left for the reviewer to
// check in.

/** The shift the history is worked on: its times (HH:MM, Cairo) and working days (0 = Sunday … 6 = Saturday). */
export interface SampleShift {
  startTime: string;
  endTime: string;
  workingDays: readonly number[];
}

/** A day worked: the check-in and check-out (HH:MM, Cairo; the check-out the next day when it is earlier). */
export interface SampleDay {
  date: string;
  in: string;
  out: string;
}

export interface SampleLeave {
  key: 'annual' | 'casual';
  startDate: string;
  endDate: string;
  days: number;
  status: 'approved' | 'with_hr';
  reason: string;
  /** The day it was asked for; an approved one was approved the day after. */
  askedOn: string;
}

export interface SamplePermission {
  date: string;
  fromTime: string;
  toTime: string;
  hours: number;
  status: 'approved';
  reason: string;
  askedOn: string;
}

export interface SamplePlan {
  /** The first day of the history. */
  from: string;
  days: SampleDay[];
  leave: SampleLeave[];
  permissions: SamplePermission[];
}

/** HH:MM moved by `minutes`, round the clock. */
export function clockPlus(hhmm: string, minutes: number): string {
  const [h, m] = hhmm.split(':').map(Number);
  const total = (((h * 60 + m + minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/** A number from 0 to `spread` − 1 that a date always gives, so the same day is worked the same way on every refresh. */
function wobble(date: string, salt: number, spread: number): number {
  let h = salt;
  for (const c of date) h = (h * 31 + c.charCodeAt(0)) % 1_000_003;
  return h % spread;
}

/** The two working days in a row (calendar neighbours) nearest the middle of `days`; null when there are none. */
function middlePair(days: readonly string[]): [string, string] | null {
  const pairs = days.slice(0, -1).flatMap((d, i) => (addDays(d, 1) === days[i + 1] ? [i] : []));
  if (!pairs.length) return null;
  const mid = (days.length - 1) / 2;
  const i = pairs.reduce((best, p) => (Math.abs(p - mid) < Math.abs(best - mid) ? p : best));
  return [days[i], days[i + 1]];
}

/** The working days from `from` to `to` (both included): the shift's days, the official holidays left out. */
function workingDaysIn(from: string, to: string, shift: SampleShift, holidays: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) if (shift.workingDays.includes(weekday(d)) && !holidays.has(d)) out.push(d);
  return out;
}

/** The sample history as of `today` (YYYY-MM-DD, Cairo) on `shift`, the official holidays left out. */
export function samplePlan(today: string, shift: SampleShift, holidays: ReadonlySet<string>): SamplePlan {
  const thisMonth = `${today.slice(0, 7)}-01`;
  const lastMonth = addMonths(thisMonth, -1);
  const from = addMonths(thisMonth, -2);
  const worked = workingDaysIn(from, addDays(today, -1), shift, holidays);
  const inMonth = (month: string) => worked.filter((d) => d.startsWith(month.slice(0, 7)));

  const leave: SampleLeave[] = [];
  const off = new Set<string>();
  // two days of annual leave in the middle of last month
  const annual = middlePair(inMonth(lastMonth));
  if (annual) {
    leave.push({ key: 'annual', startDate: annual[0], endDate: annual[1], days: 2, status: 'approved', reason: 'Family trip', askedOn: addDays(annual[0], -10) });
    off.add(annual[0]).add(annual[1]);
  }
  // a casual day the month before
  const earlier = inMonth(from);
  const casual = earlier[Math.floor(earlier.length / 3)];
  if (casual) {
    leave.push({ key: 'casual', startDate: casual, endDate: casual, days: 1, status: 'approved', reason: 'Personal errand', askedOn: addDays(casual, -1) });
    off.add(casual);
  }
  // two days of annual leave asked for, about three weeks ahead, waiting for HR
  const ahead = workingDaysIn(addDays(today, 18), addDays(today, 45), shift, holidays);
  const asked = middlePair(ahead.slice(0, 10));
  if (asked) leave.push({ key: 'annual', startDate: asked[0], endDate: asked[1], days: 2, status: 'with_hr', reason: 'A long weekend', askedOn: addDays(today, -1) });

  // two hours' permission one morning late last month: the check-in two hours after the shift's start
  const mornings = inMonth(lastMonth).filter((d) => !off.has(d));
  const permissionDay = mornings[mornings.length - 3] ?? null;
  const permissions: SamplePermission[] = permissionDay
    ? [{ date: permissionDay, fromTime: shift.startTime, toTime: clockPlus(shift.startTime, 120), hours: 2, status: 'approved', reason: 'Doctor’s appointment', askedOn: addDays(permissionDay, -2) }]
    : [];
  // one day late, with no permission: 35 minutes after the shift's start
  const lateDay = earlier.filter((d) => !off.has(d)).at(-2) ?? null;

  const days = worked
    .filter((d) => !off.has(d))
    .map((date): SampleDay => {
      const inAt =
        date === permissionDay
          ? clockPlus(shift.startTime, 120 + wobble(date, 1, 6))
          : date === lateDay
            ? clockPlus(shift.startTime, 35)
            : clockPlus(shift.startTime, wobble(date, 1, 22) - 12);
      return { date, in: inAt, out: clockPlus(shift.endTime, wobble(date, 2, 46)) };
    });
  return { from, days, leave, permissions };
}
