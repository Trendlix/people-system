import { describe, expect, it } from 'vitest';
import type { CheckInTodayView } from '../../../lib/attendance-types';
import { checkInCount, counterShows, counterWords, countRuleOf, firstDayNote as firstDayToday, PLAIN_COUNT } from '../my-attendance/check-in';
import { FIRST_DAY_BADGE, firstDayNote } from './attendance';

// A new employee's first day (owner, 27 October 2026: "a new employee when checked in in his first day move the checkin to
// 9am automatically to prevent delay in instructions"; asked, "Counted from the shift start"): the pages' note under a
// day counted from the shift's start (attendance.ts firstDayNote), and the check-in panel's words and counter on the
// employee's own first day (my-attendance/check-in.ts firstDayNote, countRuleOf, checkInCount, counterShows).

const DATE = '2026-10-27';
const at = (time: string, day = DATE) => Date.parse(`${day}T${time}+03:00`);
const iso = (time: string) => new Date(at(time)).toISOString();
// the MORNING shift since 26 October 2026: 9 hours within 8:00 AM–8:00 PM, no grace
const MORNING = { startTime: '08:00', endTime: '20:00', hoursPerDay: 9, graceMinutes: 0, countUntil: null };

const TODAY: CheckInTodayView = {
  refusal: null,
  date: DATE,
  now: iso('10:40:00'),
  next: 'out',
  punches: [],
  day: null,
  expected: 'office',
  expectedText: null,
  officeLocationSet: true,
  shift: MORNING,
};

describe('a day counted from the shift start, on the pages', () => {
  it('says so under the check-in, with the press itself; nothing for a day from its own press, or one without pairs', () => {
    expect(firstDayNote({ checkIn: iso('10:40:00'), pairs: [{ in: iso('08:00:00'), out: iso('18:00:00') }] })).toBe('First day: counted from the shift start (checked in 10:40 AM)');
    expect(firstDayNote({ checkIn: iso('10:40:00'), pairs: [{ in: iso('10:40:00'), out: iso('18:00:00') }] })).toBeNull();
    expect(firstDayNote({ checkIn: iso('10:40:00'), pairs: null })).toBeNull();
    expect(firstDayNote({ checkIn: iso('10:40:00') })).toBeNull();
    expect(firstDayNote({ checkIn: null, pairs: [{ in: iso('08:00:00'), out: iso('18:00:00') }] })).toBeNull();
    expect(FIRST_DAY_BADGE).toBe('First day');
  });
});

describe('the employee’s own first day on the panel', () => {
  it('tells them the day counts from the shift’s start, with its time; nothing on any other day or from an API from before it', () => {
    expect(firstDayToday({ firstDay: true, shift: MORNING })).toBe('Your first day: it is counted from your shift’s start, 8:00 AM, whatever time you check in.');
    expect(firstDayToday({ firstDay: true, shift: null })).toBe('Your first day: it is counted from your shift’s start, whatever time you check in.');
    expect(firstDayToday({ firstDay: false, shift: MORNING })).toBeNull();
    expect(firstDayToday({ shift: MORNING })).toBeNull();
  });

  it('counts from the shift’s start though they checked in after it, and says so; a check-in before the start as before', () => {
    const rule = countRuleOf(DATE, MORNING, true);
    expect(rule).toEqual({ windowStart: at('08:00:00'), countUntil: at('20:00:00'), hoursToWork: 9, extraCounts: false, fromStart: true });
    // the rule without the first day has no such field (the counter's tests compare it whole)
    expect(countRuleOf(DATE, MORNING)).not.toHaveProperty('fromStart');
    expect(countRuleOf(DATE, null, true)).toEqual(PLAIN_COUNT);
    // in at 10:40, at 12:40: 4:40 counted, from 8:00
    const c = checkInCount({ ...rule, checkIn: at('10:40:00'), now: at('12:40:00') })!;
    expect(c).toMatchObject({ countedMs: 4 * 3_600_000 + 40 * 60_000, countsFrom: at('08:00:00'), fromWindowStart: true, firstDay: true, phase: 'counting', doneAt: at('17:00:00') });
    expect(counterWords(c)).toEqual({ value: '4:40:00', note: 'Counting from 8:00 AM, when your shift starts (your first day)', status: 'Your 9 hours are done at 5:00 PM' });
    // the same check-in on any other day: from 10:40
    expect(checkInCount({ ...countRuleOf(DATE, MORNING), checkIn: at('10:40:00'), now: at('12:40:00') })).toMatchObject({ countedMs: 2 * 3_600_000, countsFrom: at('10:40:00'), fromWindowStart: false });
    // checked in early on the first day: from the start, as any day
    const early = checkInCount({ ...rule, checkIn: at('07:50:00'), now: at('09:00:00') })!;
    expect(early).toMatchObject({ countsFrom: at('08:00:00'), fromWindowStart: true, countedMs: 3_600_000 });
    expect(early).not.toHaveProperty('firstDay');
    expect(counterWords(early).note).toBe('Counting from 8:00 AM, when your shift starts');
    // checked in after the limit: nothing counts, as any day
    expect(checkInCount({ ...rule, checkIn: at('20:30:00'), now: at('21:00:00') })).toMatchObject({ phase: 'after_limit', countedMs: 0 });
  });

  it('shows the counter from the shift’s start on the first day; a check-in after a pair counts from itself', () => {
    const open: CheckInTodayView = { ...TODAY, firstDay: true, day: { checkIn: iso('10:40:00'), checkOut: null, place: 'office', flags: [], hoursCounted: 0, pairs: [], openAt: iso('10:40:00'), breakMinutes: 0 } };
    expect(counterShows(open, at('12:40:00'))).toEqual({ kind: 'live', value: '4:40:00', note: 'Counting from 8:00 AM, when your shift starts (your first day)', status: 'Your 9 hours are done at 5:00 PM' });
    // an API from before it: from the check-in
    expect(counterShows({ ...open, firstDay: undefined }, at('12:40:00'))).toMatchObject({ kind: 'live', value: '2:00:00', note: null });
    // out for lunch and back: the first pair counted from the start by the server (5 hours), the time since 14:00 from itself
    const again: CheckInTodayView = {
      ...open,
      day: { checkIn: iso('10:40:00'), checkOut: iso('13:00:00'), place: 'office', flags: [], hoursCounted: 5, pairs: [{ in: iso('08:00:00'), out: iso('13:00:00') }], openAt: iso('14:00:00'), breakMinutes: 60 },
    };
    expect(counterShows(again, at('15:00:00'))).toMatchObject({ kind: 'live', value: '6:00:00', note: 'Counting since 2:00 PM, with 5:00 from earlier today; the break isn’t counted' });
  });
});
