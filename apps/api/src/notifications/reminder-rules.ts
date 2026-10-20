import {
  cairoDay,
  CHECK_IN_REMINDER_AFTER_MINUTES,
  graceOf,
  nextPunch,
  REMINDER_SETTING,
  shiftWindowOn,
  type NotificationSettings,
  type PunchKind,
  type ReminderKind,
  type ShiftWindowTimes,
} from '@trendlix/shared';
import { addDays, weekday } from '../common/date-only.js';

// The two reminders (owner, 20 October 2026: "Push notifications: yes (decisions, things waiting for someone, a check-in
// reminder)"; apps/mobile/README.md, Phase 4), worked out from a moment and what the database holds, in Cairo time:
// - "You haven't checked in": on a working day of the person's shift (not on approved leave, an official holiday, a day
//   off of the shift, or a day with approved permission, which may take its start), with no check-in by the shift's
//   start, its grace and 30 minutes; sent until the day's hours stop counting.
// - "Still checked in?": checked in and not out by the time hours stop counting (the shift's "Count hours until" when
//   set, else its end and grace: shiftWindowOn); sent within 4 hours of it.
// Only for someone with an active user account, a current employment under a shift (not a freelancer: they don't check
// in), the reminder switched on; never on a day kept from Zoho People's import; once a person, day and kind. A night
// shift's day is the day it starts, so the day before today is looked at too. Pure, tested with a fake clock.

/** "Still checked in?" isn't sent once this long has passed since hours stopped counting (the API was down meanwhile). */
export const CHECK_OUT_REMINDER_FOR_MS = 4 * 60 * 60_000;

/** An employment as the reminders read it: its days and its shift (times "HH:mm"; working days 0 = Sunday … 6 = Saturday). */
export interface ReminderEmployment {
  joinDate: string;
  endDate: string | null;
  employmentType: string;
  shift: (ShiftWindowTimes & { workingDays: readonly number[] }) | null;
}

/** Someone who may be reminded: their account, their profile, their switches and their employments in the days looked at. */
export interface ReminderPerson {
  userId: string;
  employeeId: string;
  settings: NotificationSettings;
  employments: readonly ReminderEmployment[];
}

/** What the database holds for the days looked at. Keys: an employee's id and a day, `${employeeId}:${day}`. */
export interface ReminderFacts {
  /** The official holidays (YYYY-MM-DD). */
  holidays: ReadonlySet<string>;
  /** The days of approved leave. */
  leave: ReadonlySet<string>;
  /** The days with approved permission. */
  permission: ReadonlySet<string>;
  /** The days kept from Zoho People's import. */
  zoho: ReadonlySet<string>;
  /** The day's check-ins and check-outs on the system. */
  punches: ReadonlyMap<string, readonly { kind: PunchKind; at: Date }[]>;
  /** The reminders already sent: `${userId}:${day}:${kind}`. */
  sent: ReadonlySet<string>;
}

/** A reminder to send: to whom, for which working day, and what it says it with. */
export type DueReminder =
  | { kind: 'check_in_reminder'; userId: string; employeeId: string; day: string; shiftStart: string }
  | { kind: 'check_out_reminder'; userId: string; employeeId: string; day: string; checkedInAt: Date };

export const dayKey = (employeeId: string, day: string) => `${employeeId}:${day}`;
export const sentKey = (userId: string, day: string, kind: ReminderKind) => `${userId}:${day}:${kind}`;

/** The working days looked at, at `now`: the day before today (a night shift's) and today, in Cairo. */
export function reminderDays(now: Date): string[] {
  const today = cairoDay(now);
  return [addDays(today, -1), today];
}

/** The employment covering a day, under the labour law's working hours (a freelancer never checks in). */
function employmentOn(employments: readonly ReminderEmployment[], day: string): ReminderEmployment | null {
  return employments.find((e) => e.joinDate <= day && (e.endDate === null || e.endDate >= day) && e.employmentType !== 'freelance') ?? null;
}

/** The reminders due at `now`, each once a person, day and kind. */
export function remindersDue(people: readonly ReminderPerson[], facts: ReminderFacts, now: Date): DueReminder[] {
  const at = now.getTime();
  const due: DueReminder[] = [];
  for (const day of reminderDays(now)) {
    if (facts.holidays.has(day)) continue;
    for (const person of people) {
      const employment = employmentOn(person.employments, day);
      const shift = employment?.shift;
      if (!shift || !shift.workingDays.includes(weekday(day))) continue;
      const key = dayKey(person.employeeId, day);
      if (facts.leave.has(key) || facts.zoho.has(key)) continue;
      const window = shiftWindowOn(day, shift);
      if (!window) continue;
      const punches = facts.punches.get(key) ?? [];
      const wants = (kind: ReminderKind) => person.settings[REMINDER_SETTING[kind]] && !facts.sent.has(sentKey(person.userId, day, kind));

      // "You haven't checked in": no check-in by the start, the grace and 30 minutes, while the day's hours still count
      const checkInDue = window.start + (graceOf(shift) + CHECK_IN_REMINDER_AFTER_MINUTES) * 60_000;
      const checkedIn = punches.some((p) => p.kind === 'in');
      if (wants('check_in_reminder') && !checkedIn && !facts.permission.has(key) && at >= checkInDue && at < window.end) {
        due.push({ kind: 'check_in_reminder', userId: person.userId, employeeId: person.employeeId, day, shiftStart: shift.startTime.slice(0, 5) });
      }

      // "Still checked in?": the last press is a check-in once hours stop counting, within the 4 hours after
      if (wants('check_out_reminder') && punches.length && nextPunch(punches.map((p) => ({ kind: p.kind, at: p.at.toISOString() }))) === 'out') {
        if (at >= window.end && at < window.end + CHECK_OUT_REMINDER_FOR_MS) {
          const firstIn = punches.filter((p) => p.kind === 'in').sort((a, b) => a.at.getTime() - b.at.getTime())[0];
          due.push({ kind: 'check_out_reminder', userId: person.userId, employeeId: person.employeeId, day, checkedInAt: firstIn.at });
        }
      }
    }
  }
  return due;
}
