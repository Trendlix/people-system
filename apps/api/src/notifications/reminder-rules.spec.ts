import { zonedMoment, type NotificationSettings, type PunchKind } from '@trendlix/shared';
import { CHECK_OUT_REMINDER_FOR_MS, dayKey, reminderDays, remindersDue, sentKey, type ReminderEmployment, type ReminderFacts, type ReminderPerson } from './reminder-rules.js';

// The check-in reminders (owner, 20 October 2026: "Push notifications: yes (decisions, things waiting for someone, a
// check-in reminder)"; apps/mobile/README.md, Phase 4) with a fake clock, in Cairo time: "You haven't checked in" at the
// shift's start, grace and 30 minutes on a working day; "Still checked in?" when hours stop counting; once a person,
// day and kind; never on leave, a holiday, a day off, a Zoho day, or with the switch off. 20 October 2026 is a Tuesday.

const DAY = '2026-10-20';
const at = (day: string, time: string) => new Date(zonedMoment(day, time));
const ON: NotificationSettings = { checkInReminder: true, checkOutReminder: true };

/** The MORNING shift: 9:00–17:00, 15 minutes' grace, Sunday to Thursday. */
const MORNING: ReminderEmployment = {
  joinDate: '2026-01-01',
  endDate: null,
  employmentType: 'full_time',
  shift: { startTime: '09:00', endTime: '17:00', graceMinutes: 15, countUntil: null, workingDays: [0, 1, 2, 3, 4] },
};

const person = (key: string, employment: Partial<ReminderEmployment> = {}, settings: Partial<NotificationSettings> = {}): ReminderPerson => ({
  userId: `u-${key}`,
  employeeId: `e-${key}`,
  settings: { ...ON, ...settings },
  employments: [{ ...MORNING, ...employment }],
});

function facts(more: Partial<Omit<ReminderFacts, 'punches'>> & { punches?: Record<string, { kind: PunchKind; at: Date }[]> } = {}): ReminderFacts {
  return {
    holidays: more.holidays ?? new Set(),
    leave: more.leave ?? new Set(),
    permission: more.permission ?? new Set(),
    zoho: more.zoho ?? new Set(),
    punches: new Map(Object.entries(more.punches ?? {})),
    sent: more.sent ?? new Set(),
  };
}

const due = (people: ReminderPerson[], f: ReminderFacts, now: Date) => remindersDue(people, f, now).map((r) => `${r.kind}:${r.userId}:${r.day}`);

describe('reminder rules', () => {
  it('looks at today and the day before, in Cairo', () => {
    expect(reminderDays(at(DAY, '00:30'))).toEqual(['2026-10-19', '2026-10-20']);
    // 23:30 in Cairo on the 20th is still the 20th, though it is 20:30 UTC
    expect(reminderDays(at(DAY, '23:30'))).toEqual(['2026-10-19', '2026-10-20']);
  });

  it('"You haven’t checked in": from the start, the grace and 30 minutes, until hours stop counting', () => {
    const rami = person('rami');
    expect(due([rami], facts(), at(DAY, '09:44'))).toEqual([]);
    expect(remindersDue([rami], facts(), at(DAY, '09:45'))).toEqual([{ kind: 'check_in_reminder', userId: 'u-rami', employeeId: 'e-rami', day: DAY, shiftStart: '09:00' }]);
    expect(due([rami], facts(), at(DAY, '17:14'))).toEqual([`check_in_reminder:u-rami:${DAY}`]);
    // 17:15: the window (with its grace) is over, the day gone
    expect(due([rami], facts(), at(DAY, '17:15'))).toEqual([]);
    // no grace: 30 minutes after the start
    expect(due([person('nogr', { shift: { ...MORNING.shift!, graceMinutes: 0 } })], facts(), at(DAY, '09:30'))).toEqual([`check_in_reminder:u-nogr:${DAY}`]);
  });

  it('not once checked in, nor sent already, nor with the switch off', () => {
    const rami = person('rami');
    const now = at(DAY, '10:00');
    expect(due([rami], facts({ punches: { [dayKey('e-rami', DAY)]: [{ kind: 'in', at: at(DAY, '09:50') }] } }), now)).toEqual([]);
    expect(due([rami], facts({ sent: new Set([sentKey('u-rami', DAY, 'check_in_reminder')]) }), now)).toEqual([]);
    expect(due([person('off', {}, { checkInReminder: false })], facts(), now)).toEqual([]);
    // a check-out without a check-in is no check-in
    expect(due([rami], facts({ punches: { [dayKey('e-rami', DAY)]: [{ kind: 'out', at: at(DAY, '09:55') }] } }), now)).toEqual([`check_in_reminder:u-rami:${DAY}`]);
  });

  it('not on leave, an official holiday, a day off, a Zoho day, a day with permission, nor outside the employment', () => {
    const now = at(DAY, '10:00');
    const key = dayKey('e-rami', DAY);
    const rami = person('rami');
    expect(due([rami], facts({ leave: new Set([key]) }), now)).toEqual([]);
    expect(due([rami], facts({ holidays: new Set([DAY]) }), now)).toEqual([]);
    expect(due([rami], facts({ zoho: new Set([key]) }), now)).toEqual([]);
    expect(due([rami], facts({ permission: new Set([key]) }), now)).toEqual([]);
    // Friday 23 October is a day off of the shift
    expect(due([rami], facts(), at('2026-10-23', '10:00'))).toEqual([]);
    expect(due([person('new', { joinDate: '2026-10-21' })], facts(), now)).toEqual([]);
    expect(due([person('gone', { endDate: '2026-10-19' })], facts(), now)).toEqual([]);
    expect(due([person('free', { employmentType: 'freelance' })], facts(), now)).toEqual([]);
    expect(due([person('noshift', { shift: null })], facts(), now)).toEqual([]);
  });

  it('"Still checked in?": checked in and not out by the end and grace, within 4 hours', () => {
    const key = dayKey('e-rami', DAY);
    const checkedIn = facts({ punches: { [key]: [{ kind: 'in', at: at(DAY, '09:05') }] } });
    const rami = person('rami');
    expect(due([rami], checkedIn, at(DAY, '17:14'))).toEqual([]);
    expect(remindersDue([rami], checkedIn, at(DAY, '17:15'))).toEqual([{ kind: 'check_out_reminder', userId: 'u-rami', employeeId: 'e-rami', day: DAY, checkedInAt: at(DAY, '09:05') }]);
    expect(due([rami], checkedIn, new Date(at(DAY, '17:15').getTime() + CHECK_OUT_REMINDER_FOR_MS - 60_000))).toEqual([`check_out_reminder:u-rami:${DAY}`]);
    expect(due([rami], checkedIn, new Date(at(DAY, '17:15').getTime() + CHECK_OUT_REMINDER_FOR_MS))).toEqual([]);
    // checked out, or in again after: as the last press says
    expect(due([rami], facts({ punches: { [key]: [{ kind: 'in', at: at(DAY, '09:05') }, { kind: 'out', at: at(DAY, '17:00') }] } }), at(DAY, '17:30'))).toEqual([]);
    expect(
      due([rami], facts({ punches: { [key]: [{ kind: 'in', at: at(DAY, '09:05') }, { kind: 'out', at: at(DAY, '13:00') }, { kind: 'in', at: at(DAY, '14:00') }] } }), at(DAY, '17:30')),
    ).toEqual([`check_out_reminder:u-rami:${DAY}`]);
    expect(due([person('off', {}, { checkOutReminder: false })], facts({ punches: { [dayKey('e-off', DAY)]: [{ kind: 'in', at: at(DAY, '09:05') }] } }), at(DAY, '17:30'))).toEqual([]);
    expect(due([rami], facts({ punches: { [key]: [{ kind: 'in', at: at(DAY, '09:05') }] }, sent: new Set([sentKey('u-rami', DAY, 'check_out_reminder')]) }), at(DAY, '17:30'))).toEqual([]);
  });

  it('a shift counting hours until 8 PM: "Still checked in?" at 8 PM', () => {
    const late = person('late', { shift: { ...MORNING.shift!, countUntil: '20:00' } });
    const checkedIn = facts({ punches: { [dayKey('e-late', DAY)]: [{ kind: 'in', at: at(DAY, '10:00') }] } });
    expect(due([late], checkedIn, at(DAY, '19:59'))).toEqual([]);
    expect(due([late], checkedIn, at(DAY, '20:00'))).toEqual([`check_out_reminder:u-late:${DAY}`]);
  });

  it('a night shift: its day is the day it starts, the check-out reminder the next morning', () => {
    const night = person('night', { shift: { startTime: '22:00', endTime: '06:00', graceMinutes: 15, countUntil: null, workingDays: [0, 1, 2, 3, 4] } });
    // Tuesday 22:45: not checked in
    expect(due([night], facts(), at(DAY, '22:45'))).toEqual([`check_in_reminder:u-night:${DAY}`]);
    // Wednesday 00:30 (the night still Tuesday's): still not checked in, still Tuesday's reminder
    expect(due([night], facts(), at('2026-10-21', '00:30'))).toEqual([`check_in_reminder:u-night:${DAY}`]);
    // checked in Tuesday 22:00, not out by Wednesday 06:15
    const checkedIn = facts({ punches: { [dayKey('e-night', DAY)]: [{ kind: 'in', at: at(DAY, '22:00') }] } });
    expect(due([night], checkedIn, at('2026-10-21', '06:15'))).toEqual([`check_out_reminder:u-night:${DAY}`]);
  });
});
