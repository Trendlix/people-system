import {
  cairoDay,
  CHECK_IN_REMINDER_EVERY_MINUTES,
  CHECK_IN_REMINDER_FOR_MINUTES,
  CHECK_IN_REMINDER_MAX,
  nextPunch,
  reminderSwitchedOn,
  shiftWindowOn,
  type NotificationSettings,
  type PunchKind,
  type ReminderKind,
  type ShiftWindowTimes,
} from '@trendlix/shared';
import { addDays, weekday } from '../common/date-only.js';

// The two reminders (owner, 20 October 2026: "Push notifications: yes (decisions, things waiting for someone, a check-in
// reminder)"; apps/mobile/README.md, Phase 4), worked out from a moment and what the database holds, in Cairo time:
// - "You haven't checked in" (owner, 20 October 2026: "a reminder for people that didn't checkin and not on a leave every
//   10 minutes. like a popup"; asked, from the "Shift start", stopping "After 2 hours", "No, always on"): on a working day
//   of the person's shift (not on approved leave, an official holiday, a day off of the shift, or with approved
//   permission covering the shift's start), not checked in: at the start, then every 10 minutes, the last no later than
//   2 hours on (12 at most, and none once the day's hours stop counting). It stops as soon as they check in. Each
//   10-minute step goes once (the reminders_sent row's last_sent_at is before the step's start), whatever the switch says.
// - "Still checked in?": checked in and not out by the time hours stop counting (the shift's "Count hours until" when
//   set, else its end and grace: shiftWindowOn); sent within 4 hours of it, once a day, unless switched off.
// Only for someone with an active user account and a current employment under a shift (not a freelancer: they don't
// check in); never on a day kept from Zoho People's import, nor on a day they are exempt from check-in (owner, 25 October
// 2026: "Optional check-in": no check-in or check-out reminder, on the bell, the phone or WhatsApp). A night shift's day
// is the day it starts, so the day before today is looked at too. Pure, tested with a fake clock.

/** "Still checked in?" isn't sent once this long has passed since hours stopped counting (the API was down meanwhile). */
export const CHECK_OUT_REMINDER_FOR_MS = 4 * 60 * 60_000;

const STEP_MS = CHECK_IN_REMINDER_EVERY_MINUTES * 60_000;
const CHECK_IN_FOR_MS = CHECK_IN_REMINDER_FOR_MINUTES * 60_000;

/** A shift as the reminders read it: its times ("HH:mm") and working days (0 = Sunday … 6 = Saturday). */
export type ReminderShift = ShiftWindowTimes & { workingDays: readonly number[] };

/** An employment as the reminders read it: its days and its shift. */
export interface ReminderEmployment {
  joinDate: string;
  endDate: string | null;
  employmentType: string;
  shift: ReminderShift | null;
}

/** Someone who may be reminded: their account, their profile, their switches and their employments in the days looked at. */
export interface ReminderPerson {
  userId: string;
  employeeId: string;
  settings: NotificationSettings;
  employments: readonly ReminderEmployment[];
}

/** An approved permission's times that day ("HH:mm"; none: not said). */
export interface PermissionSpan {
  fromTime: string | null;
  toTime: string | null;
}

/** A reminder kept as sent: how many went that day, and when the last went. */
export interface SentReminder {
  count: number;
  lastSentAt: Date;
}

/** What the database holds for the days looked at. Keys: an employee's id and a day, `${employeeId}:${day}`. */
export interface ReminderFacts {
  /** The official holidays (YYYY-MM-DD). */
  holidays: ReadonlySet<string>;
  /** The days of approved leave. */
  leave: ReadonlySet<string>;
  /** The approved permission of each day, with its times. */
  permission: ReadonlyMap<string, readonly PermissionSpan[]>;
  /** The days kept from Zoho People's import. */
  zoho: ReadonlySet<string>;
  /** The days they are exempt from check-in (owner, 25 October 2026); missing: none. */
  exempt?: ReadonlySet<string>;
  /** The day's check-ins and check-outs on the system. */
  punches: ReadonlyMap<string, readonly { kind: PunchKind; at: Date }[]>;
  /** The reminders already sent: `${userId}:${day}:${kind}`. */
  sent: ReadonlyMap<string, SentReminder>;
}

/**
 * A reminder to send: to whom, for which working day, what it says, and `stepAt`, the moment its step began: it is sent
 * only when the last one went before that (once a step, whichever process sends it). The check-in reminder's `step`:
 * 0 at the shift's start, then 1, 2 … every 10 minutes.
 */
export type DueReminder =
  | { kind: 'check_in_reminder'; userId: string; employeeId: string; day: string; shiftStart: string; step: number; stepAt: Date }
  | { kind: 'check_out_reminder'; userId: string; employeeId: string; day: string; checkedInAt: Date; stepAt: Date };

export const dayKey = (employeeId: string, day: string) => `${employeeId}:${day}`;
export const sentKey = (userId: string, day: string, kind: ReminderKind) => `${userId}:${day}:${kind}`;

/** The working days looked at, at `now`: the day before today (a night shift's) and today, in Cairo. */
export function reminderDays(now: Date): string[] {
  const today = cairoDay(now);
  return [addDays(today, -1), today];
}

/**
 * The check-in reminder's step at `at` for a shift starting at `start` (ms) whose hours stop counting at `end`: 0 at the
 * start, 1 ten minutes on … 11; null before the start, from 2 hours on, or once hours stop counting.
 */
export function checkInStep(start: number, end: number, at: number): { step: number; stepAt: number } | null {
  if (at < start || at >= start + CHECK_IN_FOR_MS || at >= end) return null;
  const step = Math.floor((at - start) / STEP_MS);
  if (step >= CHECK_IN_REMINDER_MAX) return null;
  return { step, stepAt: start + step * STEP_MS };
}

/** Minutes from midnight of "HH:mm"; null when it isn't one. */
function minutesOf(time: string | null): number | null {
  const m = time ? /^(\d{2}):(\d{2})/.exec(time) : null;
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/**
 * Whether approved permission covers the shift's start (so they come late with leave to): from at or before the start
 * to after it. A permission without times is taken as covering it (when it is taken isn't known), so nobody away with
 * permission is reminded. Permission later in the day (leaving early) doesn't cover it.
 */
export function permissionCoversStart(spans: readonly PermissionSpan[] | undefined, shiftStart: string): boolean {
  const start = minutesOf(shiftStart);
  return (spans ?? []).some((p) => {
    const [from, to] = [minutesOf(p.fromTime), minutesOf(p.toTime)];
    if (from === null && to === null) return true;
    if (start === null) return true;
    return (from ?? 0) <= start && start < (to ?? 24 * 60);
  });
}

/** The employment covering a day, under the labour law's working hours (a freelancer never checks in). */
function employmentOn(employments: readonly ReminderEmployment[], day: string): ReminderEmployment | null {
  return employments.find((e) => e.joinDate <= day && (e.endDate === null || e.endDate >= day) && e.employmentType !== 'freelance') ?? null;
}

/** A working day of the person's shift, as the reminders take it: the shift, its window, the day's key; else null. */
function workingDay(person: ReminderPerson, facts: ReminderFacts, day: string) {
  if (facts.holidays.has(day)) return null;
  const shift = employmentOn(person.employments, day)?.shift;
  if (!shift || !shift.workingDays.includes(weekday(day))) return null;
  const key = dayKey(person.employeeId, day);
  if (facts.leave.has(key) || facts.zoho.has(key) || facts.exempt?.has(key)) return null;
  const window = shiftWindowOn(day, shift);
  return window ? { shift, window, key } : null;
}

/**
 * "You haven't checked in" for a person and a day at `at`, whatever was sent: the step and the shift's start ("HH:mm")
 * on a working day of their shift without permission covering its start, not checked in, within the 2 hours; else null.
 */
function checkInDue(person: ReminderPerson, facts: ReminderFacts, day: string, at: number): { step: number; stepAt: number; shiftStart: string } | null {
  const d = workingDay(person, facts, day);
  if (!d) return null;
  const shiftStart = d.shift.startTime.slice(0, 5);
  if ((facts.punches.get(d.key) ?? []).some((p) => p.kind === 'in')) return null;
  if (permissionCoversStart(facts.permission.get(d.key), shiftStart)) return null;
  const step = checkInStep(d.window.start, d.window.end, at);
  return step && { ...step, shiftStart };
}

/** The reminders due at `now`: the check-in reminder once a 10-minute step, "Still checked in?" once a day. */
export function remindersDue(people: readonly ReminderPerson[], facts: ReminderFacts, now: Date): DueReminder[] {
  const at = now.getTime();
  const due: DueReminder[] = [];
  for (const day of reminderDays(now)) {
    for (const person of people) {
      const sent = (kind: ReminderKind) => facts.sent.get(sentKey(person.userId, day, kind));

      // "You haven't checked in": always on; once a step (the last sent before the step began), 12 at most
      const checkIn = checkInDue(person, facts, day, at);
      const before = sent('check_in_reminder');
      if (checkIn && reminderSwitchedOn(person.settings, 'check_in_reminder') && (!before || (before.count < CHECK_IN_REMINDER_MAX && before.lastSentAt.getTime() < checkIn.stepAt))) {
        const { step, stepAt, shiftStart } = checkIn;
        due.push({ kind: 'check_in_reminder', userId: person.userId, employeeId: person.employeeId, day, shiftStart, step, stepAt: new Date(stepAt) });
      }

      // "Still checked in?": the last press is a check-in once hours stop counting, within the 4 hours after; once a day
      const d = workingDay(person, facts, day);
      const punches = d ? (facts.punches.get(d.key) ?? []) : [];
      if (!d || !punches.length || !reminderSwitchedOn(person.settings, 'check_out_reminder') || sent('check_out_reminder')) continue;
      if (nextPunch(punches.map((p) => ({ kind: p.kind, at: p.at.toISOString() }))) !== 'out') continue;
      if (at >= d.window.end && at < d.window.end + CHECK_OUT_REMINDER_FOR_MS) {
        const firstIn = punches.filter((p) => p.kind === 'in').sort((a, b) => a.at.getTime() - b.at.getTime())[0];
        due.push({ kind: 'check_out_reminder', userId: person.userId, employeeId: person.employeeId, day, checkedInAt: firstIn.at, stepAt: new Date(d.window.end) });
      }
    }
  }
  return due;
}

/**
 * The popup "You haven't checked in yet" for one person at `now` (GET /me/check-in-reminder), by the same rule as the
 * push, whatever was sent: the working day and its shift's start when due (today's first, then a night shift's of the
 * day before); else null.
 */
export function checkInReminderNow(person: ReminderPerson, facts: ReminderFacts, now: Date): { day: string; shiftStart: string } | null {
  for (const day of [...reminderDays(now)].reverse()) {
    const due = checkInDue(person, facts, day, now.getTime());
    if (due) return { day, shiftStart: due.shiftStart };
  }
  return null;
}

/**
 * The shifts a reminder may be due under at `now`, so a round reads only their people: a working day of the shift
 * (today, or the day before for a night shift) within the 2 hours from its start (and before its hours stop counting),
 * or within the 4 hours after they stop. The rest of the rules (leave, holidays, punches) are the people's.
 */
export function liveShiftIds(shifts: readonly (ReminderShift & { id: string })[], now: Date): Set<string> {
  const at = now.getTime();
  const live = new Set<string>();
  for (const day of reminderDays(now)) {
    for (const shift of shifts) {
      if (live.has(shift.id) || !shift.workingDays.includes(weekday(day))) continue;
      const window = shiftWindowOn(day, shift);
      if (!window) continue;
      if (checkInStep(window.start, window.end, at) || (at >= window.end && at < window.end + CHECK_OUT_REMINDER_FOR_MS)) live.add(shift.id);
    }
  }
  return live;
}
