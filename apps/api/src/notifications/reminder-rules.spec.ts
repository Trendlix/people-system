import { CHECK_IN_REMINDER_MAX, zonedMoment, type NotificationSettings, type PunchKind } from '@trendlix/shared';
import {
  CHECK_OUT_REMINDER_FOR_MS,
  checkInReminderNow,
  checkInStep,
  dayKey,
  liveShiftIds,
  permissionCoversStart,
  reminderDays,
  remindersDue,
  sentKey,
  type PermissionSpan,
  type ReminderEmployment,
  type ReminderFacts,
  type ReminderPerson,
  type SentReminder,
} from './reminder-rules.js';

// The check-in reminders (owner, 20 October 2026: "Push notifications: yes (decisions, things waiting for someone, a
// check-in reminder)", then "a reminder for people that didn't checkin and not on a leave every 10 minutes. like a
// popup"; asked, from the "Shift start", stopping "After 2 hours", "No, always on"; apps/mobile/README.md, Phase 4) with a
// fake clock, in Cairo time: "You haven't checked in" at the shift's start and every 10 minutes for 2 hours (12 at most),
// once a step, until they check in, whatever their switch; "Still checked in?" when hours stop counting, once a day;
// never on leave, a holiday, a day off, a Zoho day, or with permission covering the start. 20 October 2026 is a Tuesday.

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

type FactsInput = Partial<Omit<ReminderFacts, 'punches' | 'permission' | 'sent'>> & {
  punches?: Record<string, { kind: PunchKind; at: Date }[]>;
  permission?: Record<string, PermissionSpan[]>;
  sent?: Record<string, SentReminder>;
};

function facts(more: FactsInput = {}): ReminderFacts {
  return {
    holidays: more.holidays ?? new Set(),
    leave: more.leave ?? new Set(),
    permission: new Map(Object.entries(more.permission ?? {})),
    zoho: more.zoho ?? new Set(),
    punches: new Map(Object.entries(more.punches ?? {})),
    sent: new Map(Object.entries(more.sent ?? {})),
  };
}

const due = (people: ReminderPerson[], f: ReminderFacts, now: Date) => remindersDue(people, f, now).map((r) => `${r.kind}:${r.userId}:${r.day}`);

/** Plays a morning minute by minute from `from` to `to`, keeping each reminder sent as the API does; answers when each went. */
function play(people: ReminderPerson[], from: string, to: string, more: FactsInput = {}, day = DAY) {
  const sent: Record<string, SentReminder> = { ...more.sent };
  const times: string[] = [];
  for (let t = at(day, from).getTime(); t <= at(day, to).getTime(); t += 60_000) {
    const now = new Date(t);
    for (const r of remindersDue(people, facts({ ...more, sent }), now)) {
      if (r.kind !== 'check_in_reminder') continue;
      const key = sentKey(r.userId, r.day, r.kind);
      sent[key] = { count: (sent[key]?.count ?? 0) + 1, lastSentAt: now };
      times.push(new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', hour: '2-digit', minute: '2-digit' }).format(now));
    }
  }
  return { times, sent };
}

describe('reminder rules', () => {
  it('looks at today and the day before, in Cairo', () => {
    expect(reminderDays(at(DAY, '00:30'))).toEqual(['2026-10-19', '2026-10-20']);
    // 23:30 in Cairo on the 20th is still the 20th, though it is 20:30 UTC
    expect(reminderDays(at(DAY, '23:30'))).toEqual(['2026-10-19', '2026-10-20']);
  });

  it('the steps: at the start, then every 10 minutes, the last no later than 2 hours on', () => {
    const start = at(DAY, '09:00').getTime();
    const end = at(DAY, '17:15').getTime();
    expect(checkInStep(start, end, start - 1)).toBeNull();
    expect(checkInStep(start, end, start)).toEqual({ step: 0, stepAt: start });
    expect(checkInStep(start, end, start + 9 * 60_000 + 59_000)).toEqual({ step: 0, stepAt: start });
    expect(checkInStep(start, end, start + 10 * 60_000)).toEqual({ step: 1, stepAt: start + 10 * 60_000 });
    expect(checkInStep(start, end, start + 119 * 60_000)).toEqual({ step: 11, stepAt: start + 110 * 60_000 });
    expect(checkInStep(start, end, start + 120 * 60_000)).toBeNull();
    // a short shift: none once its hours stop counting
    expect(checkInStep(start, start + 30 * 60_000, start + 30 * 60_000)).toBeNull();
  });

  it('"You haven’t checked in" at the shift’s start (not after the grace), with its step', () => {
    const rami = person('rami');
    expect(due([rami], facts(), at(DAY, '08:59'))).toEqual([]);
    expect(remindersDue([rami], facts(), at(DAY, '09:00'))).toEqual([
      { kind: 'check_in_reminder', userId: 'u-rami', employeeId: 'e-rami', day: DAY, shiftStart: '09:00', step: 0, stepAt: at(DAY, '09:00') },
    ]);
    expect(remindersDue([rami], facts(), at(DAY, '10:55'))).toMatchObject([{ step: 11, stepAt: at(DAY, '10:50') }]);
    // 2 hours on: no more
    expect(due([rami], facts(), at(DAY, '11:00'))).toEqual([]);
    expect(due([rami], facts(), at(DAY, '13:00'))).toEqual([]);
  });

  it('once a 10-minute step, 12 at most, minute by minute', () => {
    const { times, sent } = play([person('rami')], '08:30', '12:00');
    expect(times).toEqual(['09:00', '09:10', '09:20', '09:30', '09:40', '09:50', '10:00', '10:10', '10:20', '10:30', '10:40', '10:50']);
    expect(times).toHaveLength(CHECK_IN_REMINDER_MAX);
    expect(sent[sentKey('u-rami', DAY, 'check_in_reminder')]).toEqual({ count: 12, lastSentAt: at(DAY, '10:50') });
    // a step already sent (by this process or another) isn't sent again; the next step is
    const once = { [sentKey('u-rami', DAY, 'check_in_reminder')]: { count: 3, lastSentAt: at(DAY, '09:20') } };
    expect(due([person('rami')], facts({ sent: once }), at(DAY, '09:29'))).toEqual([]);
    expect(due([person('rami')], facts({ sent: once }), at(DAY, '09:30'))).toEqual([`check_in_reminder:u-rami:${DAY}`]);
    // the API down for a while: the step due now, once, not the ones missed
    expect(play([person('rami')], '09:47', '10:05').times).toEqual(['09:47', '09:50', '10:00']);
  });

  it('stops as soon as they check in', () => {
    const key = dayKey('e-rami', DAY);
    expect(play([person('rami')], '09:00', '11:00', { punches: { [key]: [{ kind: 'in', at: at(DAY, '08:55') }] } }).times).toEqual([]);
    expect(due([person('rami')], facts({ punches: { [key]: [{ kind: 'in', at: at(DAY, '09:24') }] } }), at(DAY, '09:30'))).toEqual([]);
    // a check-out without a check-in is no check-in
    expect(due([person('rami')], facts({ punches: { [key]: [{ kind: 'out', at: at(DAY, '09:05') }] } }), at(DAY, '09:30'))).toEqual([`check_in_reminder:u-rami:${DAY}`]);
  });

  it('ignores the person’s switch: always on', () => {
    expect(due([person('off', {}, { checkInReminder: false })], facts(), at(DAY, '09:00'))).toEqual([`check_in_reminder:u-off:${DAY}`]);
    expect(play([person('off', {}, { checkInReminder: false })], '09:00', '11:00').times).toHaveLength(12);
  });

  it('not on leave, an official holiday, a day off, a Zoho day, nor outside the employment', () => {
    const now = at(DAY, '09:30');
    const key = dayKey('e-rami', DAY);
    const rami = person('rami');
    expect(due([rami], facts({ leave: new Set([key]) }), now)).toEqual([]);
    expect(due([rami], facts({ holidays: new Set([DAY]) }), now)).toEqual([]);
    expect(due([rami], facts({ zoho: new Set([key]) }), now)).toEqual([]);
    // Friday 23 October is a day off of the shift
    expect(due([rami], facts(), at('2026-10-23', '09:30'))).toEqual([]);
    expect(due([person('new', { joinDate: '2026-10-21' })], facts(), now)).toEqual([]);
    expect(due([person('gone', { endDate: '2026-10-19' })], facts(), now)).toEqual([]);
    expect(due([person('free', { employmentType: 'freelance' })], facts(), now)).toEqual([]);
    expect(due([person('noshift', { shift: null })], facts(), now)).toEqual([]);
    // someone else's leave is not Rami's
    expect(due([rami], facts({ leave: new Set([dayKey('e-other', DAY)]) }), now)).toEqual([`check_in_reminder:u-rami:${DAY}`]);
  });

  it('not with approved permission covering the start; permission later in the day doesn’t stop it', () => {
    const now = at(DAY, '09:30');
    const key = dayKey('e-rami', DAY);
    const rami = person('rami');
    expect(due([rami], facts({ permission: { [key]: [{ fromTime: '09:00', toTime: '11:00' }] } }), now)).toEqual([]);
    expect(due([rami], facts({ permission: { [key]: [{ fromTime: '08:30', toTime: '09:30' }] } }), now)).toEqual([]);
    // no times: when it is taken isn't known, so no reminder
    expect(due([rami], facts({ permission: { [key]: [{ fromTime: null, toTime: null }] } }), now)).toEqual([]);
    // leaving early at 3 PM, or coming in before the start: reminded
    expect(due([rami], facts({ permission: { [key]: [{ fromTime: '15:00', toTime: '17:00' }] } }), now)).toEqual([`check_in_reminder:u-rami:${DAY}`]);
    expect(due([rami], facts({ permission: { [key]: [{ fromTime: '07:00', toTime: '09:00' }] } }), now)).toEqual([`check_in_reminder:u-rami:${DAY}`]);
    expect(permissionCoversStart(undefined, '09:00')).toBe(false);
    expect(permissionCoversStart([{ fromTime: '09:00', toTime: null }], '09:00')).toBe(true);
    expect(permissionCoversStart([{ fromTime: null, toTime: '10:00' }], '09:00')).toBe(true);
    expect(permissionCoversStart([{ fromTime: null, toTime: '09:00' }], '09:00')).toBe(false);
  });

  it('the popup’s rule: due within the 2 hours, not checked in, whatever was sent', () => {
    const rami = person('rami');
    const sent = { [sentKey('u-rami', DAY, 'check_in_reminder')]: { count: 12, lastSentAt: at(DAY, '10:50') } };
    expect(checkInReminderNow(rami, facts(), at(DAY, '08:59'))).toBeNull();
    expect(checkInReminderNow(rami, facts({ sent }), at(DAY, '09:00'))).toEqual({ day: DAY, shiftStart: '09:00' });
    expect(checkInReminderNow(rami, facts(), at(DAY, '10:59'))).toEqual({ day: DAY, shiftStart: '09:00' });
    expect(checkInReminderNow(rami, facts(), at(DAY, '11:00'))).toBeNull();
    expect(checkInReminderNow(rami, facts({ punches: { [dayKey('e-rami', DAY)]: [{ kind: 'in', at: at(DAY, '09:05') }] } }), at(DAY, '09:30'))).toBeNull();
    expect(checkInReminderNow(rami, facts({ leave: new Set([dayKey('e-rami', DAY)]) }), at(DAY, '09:30'))).toBeNull();
    expect(checkInReminderNow(person('off', {}, { checkInReminder: false }), facts(), at(DAY, '09:30'))).toEqual({ day: DAY, shiftStart: '09:00' });
  });

  it('a round reads only the shifts within their 2 hours, or the 4 hours after their hours stop counting', () => {
    const shifts = [
      { id: 'morning', ...MORNING.shift! },
      { id: 'late', startTime: '13:00', endTime: '21:00', graceMinutes: 0, countUntil: null, workingDays: [0, 1, 2, 3, 4] },
      { id: 'night', startTime: '22:00', endTime: '06:00', graceMinutes: 15, countUntil: null, workingDays: [0, 1, 2, 3, 4] },
    ];
    // 08:59: only Monday's night shift, ended at 6:15 AM ("Still checked in?" until 10:15 AM)
    expect([...liveShiftIds(shifts, at(DAY, '08:59'))]).toEqual(['night']);
    expect([...liveShiftIds(shifts, at(DAY, '09:00'))].sort()).toEqual(['morning', 'night']);
    expect([...liveShiftIds(shifts, at(DAY, '10:59'))]).toEqual(['morning']);
    expect([...liveShiftIds(shifts, at(DAY, '11:30'))]).toEqual([]);
    expect([...liveShiftIds(shifts, at(DAY, '13:30'))]).toEqual(['late']);
    // 17:15 to 21:15: "Still checked in?" for the morning's
    expect([...liveShiftIds(shifts, at(DAY, '17:15'))]).toEqual(['morning']);
    // Tuesday 23:30: the night shift's 2 hours, and the late shift's 4 hours after 9 PM
    expect([...liveShiftIds(shifts, at(DAY, '23:30'))].sort()).toEqual(['late', 'night']);
    // Wednesday 00:30 (Tuesday's night): its 2 hours are over, the late shift's 4 hours not yet
    expect([...liveShiftIds(shifts, at('2026-10-21', '00:30'))]).toEqual(['late']);
    // Friday 09:30: only Thursday's night shift, ended at 6:15 AM; Saturday: a day off of them all, and Friday too
    expect([...liveShiftIds(shifts, at('2026-10-23', '09:30'))]).toEqual(['night']);
    expect([...liveShiftIds(shifts, at('2026-10-24', '09:30'))]).toEqual([]);
  });

  it('"Still checked in?": checked in and not out by the end and grace, within 4 hours, once, unless switched off', () => {
    const key = dayKey('e-rami', DAY);
    const checkedIn = facts({ punches: { [key]: [{ kind: 'in', at: at(DAY, '09:05') }] } });
    const rami = person('rami');
    expect(due([rami], checkedIn, at(DAY, '17:14'))).toEqual([]);
    expect(remindersDue([rami], checkedIn, at(DAY, '17:15'))).toEqual([
      { kind: 'check_out_reminder', userId: 'u-rami', employeeId: 'e-rami', day: DAY, checkedInAt: at(DAY, '09:05'), stepAt: at(DAY, '17:15') },
    ]);
    expect(due([rami], checkedIn, new Date(at(DAY, '17:15').getTime() + CHECK_OUT_REMINDER_FOR_MS - 60_000))).toEqual([`check_out_reminder:u-rami:${DAY}`]);
    expect(due([rami], checkedIn, new Date(at(DAY, '17:15').getTime() + CHECK_OUT_REMINDER_FOR_MS))).toEqual([]);
    // checked out, or in again after: as the last press says
    expect(due([rami], facts({ punches: { [key]: [{ kind: 'in', at: at(DAY, '09:05') }, { kind: 'out', at: at(DAY, '17:00') }] } }), at(DAY, '17:30'))).toEqual([]);
    expect(
      due([rami], facts({ punches: { [key]: [{ kind: 'in', at: at(DAY, '09:05') }, { kind: 'out', at: at(DAY, '13:00') }, { kind: 'in', at: at(DAY, '14:00') }] } }), at(DAY, '17:30')),
    ).toEqual([`check_out_reminder:u-rami:${DAY}`]);
    // its switch still works
    expect(due([person('off', {}, { checkOutReminder: false })], facts({ punches: { [dayKey('e-off', DAY)]: [{ kind: 'in', at: at(DAY, '09:05') }] } }), at(DAY, '17:30'))).toEqual([]);
    const sent = { [sentKey('u-rami', DAY, 'check_out_reminder')]: { count: 1, lastSentAt: at(DAY, '17:15') } };
    expect(due([rami], facts({ punches: { [key]: [{ kind: 'in', at: at(DAY, '09:05') }] }, sent }), at(DAY, '17:30'))).toEqual([]);
  });

  it('a shift counting hours until 8 PM: "Still checked in?" at 8 PM', () => {
    const late = person('late', { shift: { ...MORNING.shift!, countUntil: '20:00' } });
    const checkedIn = facts({ punches: { [dayKey('e-late', DAY)]: [{ kind: 'in', at: at(DAY, '10:00') }] } });
    expect(due([late], checkedIn, at(DAY, '19:59'))).toEqual([]);
    expect(due([late], checkedIn, at(DAY, '20:00'))).toEqual([`check_out_reminder:u-late:${DAY}`]);
  });

  it('a night shift: its day is the day it starts, the reminders past midnight still that day’s', () => {
    const night = person('night', { shift: { startTime: '22:00', endTime: '06:00', graceMinutes: 15, countUntil: null, workingDays: [0, 1, 2, 3, 4] } });
    // Tuesday 22:00: not checked in
    expect(remindersDue([night], facts(), at(DAY, '22:00'))).toMatchObject([{ kind: 'check_in_reminder', day: DAY, shiftStart: '22:00', step: 0 }]);
    // Tuesday 23:55: the last step, 23:50; Wednesday 00:30 (the night still Tuesday's): its 2 hours are over
    expect(remindersDue([night], facts(), at(DAY, '23:55'))).toMatchObject([{ day: DAY, step: 11, stepAt: at(DAY, '23:50') }]);
    expect(remindersDue([night], facts(), at('2026-10-21', '00:30'))).toEqual([]);
    // Wednesday's own night, at its last step
    expect(remindersDue([night], facts(), at('2026-10-21', '23:50'))).toMatchObject([{ day: '2026-10-21', step: 11 }]);
    // checked in Tuesday 22:00, not out by Wednesday 06:15
    const checkedIn = facts({ punches: { [dayKey('e-night', DAY)]: [{ kind: 'in', at: at(DAY, '22:00') }] } });
    expect(due([night], checkedIn, at('2026-10-21', '06:15'))).toEqual([`check_out_reminder:u-night:${DAY}`]);
  });
});
