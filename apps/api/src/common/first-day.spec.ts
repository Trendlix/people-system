import {
  correctedDay,
  countedFromShiftStart,
  dayFromPunches,
  firstDayMessage,
  firstDayNoteText,
  firstWorkingDayFrom,
  fromShiftStart,
  historyDay,
  isFirstWorkingDay,
  shiftWindowOn,
  zonedMoment,
  type HistoryDayInput,
  type PunchLike,
} from '@trendlix/shared';

// A new employee's first day (owner, 27 October 2026: "a new employee when checked in in his first day move the checkin
// to 9am automatically to prevent delay in instructions"; asked, "Counted from the shift start"): which day is the first
// working day of an employment (packages/shared check-in.ts firstWorkingDayFrom), a first day from its punches counted
// from the shift's start whatever time they pressed (dayFromPunches with `firstDay`), the kept day telling it from its
// own data (countedFromShiftStart, the pages' note), the history never calling it late (attendance-history.ts), and a
// correction over a first day keeping the rule (attendance-corrections.ts correctedDay with `firstDay`).

// the MORNING shift since 26 October 2026: 9 hours within 8:00 AM–8:00 PM, no grace; the same counting until 8:00 PM
const MORNING = { startTime: '08:00', endTime: '20:00', hoursPerDay: 9, graceMinutes: 0 };
const UNTIL = { ...MORNING, countUntil: '20:00' };
// a fixed shift, 9:00–18:00 with 15 minutes' grace: late past 9:15
const FIXED = { startTime: '09:00', endTime: '18:00', hoursPerDay: 9, graceMinutes: 15 };
const SUN_TO_THU = [0, 1, 2, 3, 4];
const DAY = '2026-10-27'; // a Tuesday
const at = (time: string, day = DAY) => new Date(zonedMoment(day, time)).toISOString();
const punch = (kind: 'in' | 'out', time: string, day = DAY): PunchLike => ({ kind, at: at(time, day), place: 'office' });

describe('which day is the first day', () => {
  it('is the join date when it is a working day of the shift, else the first working day after it', () => {
    // 25 October 2026 is a Sunday; 30 October a Friday, whose first working day is Sunday 1 November
    expect(firstWorkingDayFrom('2026-10-25', SUN_TO_THU)).toBe('2026-10-25');
    expect(firstWorkingDayFrom('2026-10-30', SUN_TO_THU)).toBe('2026-11-01');
    expect(firstWorkingDayFrom('2026-10-31', SUN_TO_THU)).toBe('2026-11-01');
    // a shift working every day: the join date itself; no working days known: Sunday to Thursday
    expect(firstWorkingDayFrom('2026-10-30', [0, 1, 2, 3, 4, 5, 6])).toBe('2026-10-30');
    expect(firstWorkingDayFrom('2026-10-30', null)).toBe('2026-11-01');
    expect(firstWorkingDayFrom('2026-10-30', [])).toBe('2026-11-01');
  });

  it('skips an official holiday, and gives up after two weeks of none', () => {
    expect(firstWorkingDayFrom('2026-10-25', SUN_TO_THU, ['2026-10-25'])).toBe('2026-10-26');
    expect(firstWorkingDayFrom('2026-10-30', SUN_TO_THU, new Set(['2026-11-01', '2026-11-02']))).toBe('2026-11-03');
    const fortnight = Array.from({ length: 15 }, (_, i) => new Date(Date.UTC(2026, 9, 25 + i)).toISOString().slice(0, 10));
    expect(firstWorkingDayFrom('2026-10-25', SUN_TO_THU, fortnight)).toBeNull();
    expect(firstWorkingDayFrom('not a date', SUN_TO_THU)).toBeNull();
  });

  it('tells whether a date is the first working day', () => {
    expect(isFirstWorkingDay('2026-11-01', '2026-10-30', SUN_TO_THU)).toBe(true);
    expect(isFirstWorkingDay('2026-10-30', '2026-10-30', SUN_TO_THU)).toBe(false);
    expect(isFirstWorkingDay('2026-11-02', '2026-10-30', SUN_TO_THU)).toBe(false);
  });
});

describe('a first day from its punches', () => {
  it('in at 10:40 and out at 18:00 on a 9-hour 8:00–20:00 shift counts 9 hours, not 7:20; the press kept, the pair from the start', () => {
    const presses = [punch('in', '10:40'), punch('out', '18:00')];
    const first = dayFromPunches(DAY, presses, MORNING, { firstDay: true });
    expect(first).toMatchObject({ checkIn: at('10:40'), checkOut: at('18:00'), hoursCounted: 9, openAt: null, breakMinutes: 0, place: 'office' });
    expect(first.pairs).toEqual([{ in: at('08:00'), out: at('18:00') }]);
    // any other day: 7:20, its pair from the press
    const other = dayFromPunches(DAY, presses, MORNING);
    expect(other.hoursCounted).toBeCloseTo(7 + 20 / 60, 5);
    expect(other.pairs).toEqual([{ in: at('10:40'), out: at('18:00') }]);
    expect(dayFromPunches(DAY, presses, MORNING, { firstDay: false })).toEqual(other);
    // counting until 8:00 PM (not capped): 8:00 to 18:00, 10 hours
    expect(dayFromPunches(DAY, presses, UNTIL, { firstDay: true }).hoursCounted).toBe(10);
  });

  it('leaves a press before the start as it is: the window clips it, as any day', () => {
    const d = dayFromPunches(DAY, [punch('in', '07:50'), punch('out', '18:00')], MORNING, { firstDay: true });
    expect(d).toMatchObject({ checkIn: at('07:50'), hoursCounted: 9 });
    expect(d.pairs).toEqual([{ in: at('07:50'), out: at('18:00') }]);
    expect(countedFromShiftStart(d)).toBe(false);
  });

  it('moves only the first pair; later pairs and the break are as they were', () => {
    const d = dayFromPunches(DAY, [punch('in', '10:40'), punch('out', '13:00'), punch('in', '14:00'), punch('out', '19:00')], MORNING, { firstDay: true });
    expect(d.pairs).toEqual([
      { in: at('08:00'), out: at('13:00') },
      { in: at('14:00'), out: at('19:00') },
    ]);
    // 5 + 5 hours, at most the shift's 9; the hour's break not counted
    expect(d).toMatchObject({ hoursCounted: 9, breakMinutes: 60, checkIn: at('10:40'), checkOut: at('19:00') });
  });

  it('an open check-in has no pair to move yet; a check-in after the window’s end, or without a shift, is left as it is', () => {
    const open = dayFromPunches(DAY, [punch('in', '10:40')], MORNING, { firstDay: true });
    expect(open).toMatchObject({ checkIn: at('10:40'), checkOut: null, hoursCounted: 0, openAt: at('10:40'), pairs: [] });
    expect(countedFromShiftStart(open)).toBe(false);
    // the day was over: nothing counts, as any day's
    const late = dayFromPunches(DAY, [punch('in', '21:00'), punch('out', '22:00')], MORNING, { firstDay: true });
    expect(late.pairs).toEqual([{ in: at('21:00'), out: at('22:00') }]);
    expect(late.hoursCounted).toBe(0);
    const none = dayFromPunches(DAY, [punch('in', '10:40'), punch('out', '18:00')], null, { firstDay: true });
    expect(none.pairs).toEqual([{ in: at('10:40'), out: at('18:00') }]);
    expect(fromShiftStart([{ from: 1, to: 2 }], null)).toEqual([{ from: 1, to: 2 }]);
  });

  it('a second day is unchanged: the rule is the first working day’s only', () => {
    const next = '2026-10-28';
    const d = dayFromPunches(next, [punch('in', '10:40', next), punch('out', '18:00', next)], MORNING, { firstDay: false });
    expect(d.hoursCounted).toBeCloseTo(7 + 20 / 60, 5);
    expect(d.pairs).toEqual([{ in: at('10:40', next), out: at('18:00', next) }]);
    expect(fromShiftStart([], shiftWindowOn(DAY, MORNING))).toEqual([]);
  });
});

describe('told from the kept day', () => {
  const first = { checkIn: at('10:40'), pairs: [{ in: at('08:00'), out: at('18:00') }] };

  it('is a day whose first pair starts before its first check-in, and no other', () => {
    expect(countedFromShiftStart(first)).toBe(true);
    expect(countedFromShiftStart({ checkIn: at('10:40'), pairs: [{ in: at('10:40'), out: at('18:00') }] })).toBe(false);
    expect(countedFromShiftStart({ checkIn: at('10:40'), pairs: [] })).toBe(false);
    expect(countedFromShiftStart({ checkIn: at('10:40'), pairs: null })).toBe(false);
    expect(countedFromShiftStart({ checkIn: null, pairs: first.pairs })).toBe(false);
  });

  it('says so on the pages, and to the employee on checking in', () => {
    expect(firstDayNoteText(first)).toBe('First day: counted from the shift start (checked in 10:40 AM)');
    expect(firstDayNoteText({ checkIn: at('10:40'), pairs: [{ in: at('10:40'), out: at('18:00') }] })).toBeNull();
    expect(firstDayMessage(MORNING)).toBe('Your first day is counted from the shift’s start, 8:00 AM, whatever time you checked in.');
    expect(firstDayMessage(FIXED)).toBe('Your first day is counted from the shift’s start, 9:00 AM, whatever time you checked in.');
  });
});

describe('never late on the first day (the history)', () => {
  const base: HistoryDayInput = {
    date: DAY,
    status: 'worked',
    checkIn: at('10:40'),
    checkOut: at('18:00'),
    place: 'office',
    hoursCounted: 9,
    extraHours: 0,
    od: null,
    correctionId: null,
    pairs: [{ in: at('09:00'), out: at('18:00') }],
    openAt: null,
    breakMinutes: 0,
    source: 'system',
    wfh: false,
    shift: FIXED,
    scheduled: true,
  };

  it('is on time with no late minutes, its check-in left out of the check-in times; the same day otherwise is late', () => {
    const first = historyDay(base);
    expect(first).toMatchObject({ onTime: true, lateMinutes: 0, firstDay: true, checkInMinutes: null, hours: 9, counted: true, attended: true, mode: 'office' });
    // the next day, in at 10:40 for real: 85 minutes late past 9:15's grace, counted from 9:00
    const next = historyDay({ ...base, date: '2026-10-28', checkIn: at('10:40', '2026-10-28'), checkOut: at('18:00', '2026-10-28'), pairs: [{ in: at('10:40', '2026-10-28'), out: at('18:00', '2026-10-28') }], hoursCounted: 7 + 20 / 60 });
    expect(next).toMatchObject({ onTime: false, lateMinutes: 100, firstDay: false });
    expect(next.checkInMinutes).toBe(10 * 60 + 40);
  });

  it('is not measured on a day not expected, and a first day kept before the pairs isn’t one', () => {
    expect(historyDay({ ...base, scheduled: false })).toMatchObject({ onTime: null, firstDay: true, offDay: true });
    expect(historyDay({ ...base, pairs: null })).toMatchObject({ onTime: false, firstDay: false });
  });
});

describe('a correction over a first day', () => {
  // the first day's open check-in at 10:40, the check-out forgotten
  const open = { status: 'worked' as const, checkIn: at('10:40'), checkOut: null, place: 'office' as const, source: 'system' as const, pairs: [], openAt: at('10:40') };

  it('the check-out forgotten closes the check-in: the pair from the shift’s start, the check-in still the press', () => {
    const made = correctedDay(open, { kind: 'forgot_check_out', checkIn: null, checkOut: at('18:00') }, DAY, MORNING, { firstDay: true });
    expect(made).toMatchObject({ checkIn: at('10:40'), checkOut: at('18:00'), hoursCounted: 9, openAt: null, breakMinutes: 0 });
    expect(made.pairs).toEqual([{ in: at('08:00'), out: at('18:00') }]);
    expect(countedFromShiftStart(made)).toBe(true);
    // any other day: from the press, 7:20, as before
    const other = correctedDay(open, { kind: 'forgot_check_out', checkIn: null, checkOut: at('18:00') }, DAY, MORNING);
    expect(other.pairs).toEqual([{ in: at('10:40'), out: at('18:00') }]);
    expect(other.hoursCounted).toBeCloseTo(7 + 20 / 60, 5);
  });

  it('keeps the press as the check-in of a first day kept by its pairs, whose first pair is from the start already', () => {
    const kept = { ...open, checkOut: at('13:00'), pairs: [{ in: at('08:00'), out: at('13:00') }], openAt: at('14:00') };
    const made = correctedDay(kept, { kind: 'forgot_check_out', checkIn: null, checkOut: at('19:00') }, DAY, MORNING, { firstDay: true });
    expect(made).toMatchObject({ checkIn: at('10:40'), checkOut: at('19:00'), hoursCounted: 9, breakMinutes: 60 });
    expect(made.pairs).toEqual([
      { in: at('08:00'), out: at('13:00') },
      { in: at('14:00'), out: at('19:00') },
    ]);
    // the check-in typed as on record changes nothing of it
    expect(correctedDay(kept, { kind: 'forgot_check_out', checkIn: at('08:00'), checkOut: at('19:00') }, DAY, MORNING, { firstDay: true })).toMatchObject({ checkIn: at('10:40'), hoursCounted: 9 });
  });

  it('both times given: that pair from the shift’s start on a first day, the check-in the time given; a check-in before the start as it is', () => {
    const made = correctedDay(open, { kind: 'wrong_time', checkIn: at('11:00'), checkOut: at('18:00') }, DAY, MORNING, { firstDay: true });
    expect(made).toMatchObject({ checkIn: at('11:00'), checkOut: at('18:00'), hoursCounted: 9 });
    expect(made.pairs).toEqual([{ in: at('08:00'), out: at('18:00') }]);
    expect(correctedDay(open, { kind: 'wrong_time', checkIn: at('11:00'), checkOut: at('18:00') }, DAY, MORNING).hoursCounted).toBe(7);
    const early = correctedDay(open, { kind: 'wrong_time', checkIn: at('07:30'), checkOut: at('18:00') }, DAY, MORNING, { firstDay: true });
    expect(early.pairs).toEqual([{ in: at('07:30'), out: at('18:00') }]);
    expect(early.hoursCounted).toBe(9);
    // a day with no record at all, corrected with both times (forgot both): the same rule
    expect(correctedDay(null, { kind: 'forgot_check_in', checkIn: at('12:00'), checkOut: at('18:00') }, DAY, MORNING, { firstDay: true })).toMatchObject({ checkIn: at('12:00'), hoursCounted: 9 });
  });
});
