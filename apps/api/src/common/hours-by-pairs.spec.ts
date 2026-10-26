import {
  attendanceDayView,
  attendanceFigures,
  attendanceLineInputs,
  breakMinutesOf,
  breakText,
  correctedDay,
  correctedFromText,
  correctionProblems,
  countsDayHours,
  dayFromPunches,
  hoursCountedForDay,
  hoursCountedForPresses,
  lineDayHours,
  mostHoursCountedADay,
  openCheckInDates,
  openCheckInHours,
  openCheckInsConfirm,
  openCheckInWarning,
  openHalfDayOn,
  openPressText,
  pairPresses,
  pairsText,
  readPressPairs,
  shiftWindowOn,
  withOfficialDuty,
  zonedMoment,
  type KeptDay,
  type PunchLike,
} from '@trendlix/shared';

// A day's hours as the sum of its check-in → check-out pairs (owner, 25 October 2026: "on checkin and out several
// ttimes, the working hours to be calculated between the checkin and out only, not the first and last"; asked, "Count
// the closed pairs, flag the open one"; then, 27 October 2026, "open check ins with half day": "Half the shift (4.5 h)
// until corrected"): packages/shared attendance.ts (pairPresses, hoursCountedForPresses, breakMinutesOf), check-in.ts
// (dayFromPunches), attendance-days.ts (the day's view, the half-day rule), official-duty.ts (part of a day joins the
// pairs), attendance-corrections.ts (a correction over the pairs), attendance-import.ts (the payroll's line: a missing
// check-out half a day until corrected, the days listed for its warning) and payroll.ts (the warning's words).

const DAY = '2026-10-18';
// the MORNING shift: 9 hours within 9:00–19:00, 15 minutes' grace
const MORNING = { startTime: '09:00', endTime: '19:00', hoursPerDay: 9, graceMinutes: 15 };
const at = (time: string, day = DAY) => new Date(zonedMoment(day, time)).toISOString();
const press = (kind: 'in' | 'out', time: string, day = DAY) => ({ kind, at: at(time, day) });
const punch = (kind: 'in' | 'out', time: string, day = DAY): PunchLike => ({ kind, at: at(time, day), place: 'office' });
const window = shiftWindowOn(DAY, MORNING);
const most = mostHoursCountedADay(MORNING);

describe('a day’s presses paired', () => {
  it('a single pair: as the check-in to the check-out', () => {
    expect(hoursCountedForPresses([press('in', '09:00'), press('out', '17:30')], most, window)).toBe(8.5);
    expect(hoursCountedForDay(at('09:00'), at('17:30'), most, window)).toBe(8.5);
  });

  it('several pairs: each counted, the breaks between them not', () => {
    // the owner's example: in 9:00, out 13:00, in 14:00, out 18:00: 8 hours, not 9
    const presses = [press('in', '09:00'), press('out', '13:00'), press('in', '14:00'), press('out', '18:00')];
    expect(hoursCountedForPresses(presses, most, window)).toBe(8);
    expect(pairPresses(presses).pairs).toHaveLength(2);
    expect(breakMinutesOf(pairPresses(presses).pairs, null, window)).toBe(60);
    // in any order given: by time
    expect(hoursCountedForPresses([...presses].reverse(), most, window)).toBe(8);
  });

  it('an open last check-in: not counted, the day’s open press', () => {
    const presses = [press('in', '09:00'), press('out', '13:00'), press('in', '14:00'), press('out', '18:00'), press('in', '18:30')];
    const paired = pairPresses(presses);
    expect(paired.pairs).toHaveLength(2);
    expect(paired.open).toBe(Date.parse(at('18:30')));
    expect(hoursCountedForPresses(presses, most, window)).toBe(8);
    // only a check-in: nothing counted, open
    expect(pairPresses([press('in', '09:05')])).toEqual({ pairs: [], open: Date.parse(at('09:05')) });
  });

  it('double check-ins keep the earliest; double check-outs end at the last; a check-out with no check-in pairs with nothing', () => {
    // in 9:00, in 9:40 (still in), out 13:00: 9:00–13:00
    expect(pairPresses([press('in', '09:00'), press('in', '09:40'), press('out', '13:00')]).pairs).toEqual([{ from: Date.parse(at('09:00')), to: Date.parse(at('13:00')) }]);
    // in 9:00, out 12:00, out 13:00: ends at the last, 9:00–13:00
    expect(hoursCountedForPresses([press('in', '09:00'), press('out', '12:00'), press('out', '13:00')], most, window)).toBe(4);
    // out 8:00 before any check-in, then in 9:00, out 17:00: the first out pairs with nothing
    expect(pairPresses([press('out', '08:00'), press('in', '09:00'), press('out', '17:00')]).pairs).toEqual([{ from: Date.parse(at('09:00')), to: Date.parse(at('17:00')) }]);
    // a check-out only: nothing
    expect(pairPresses([press('out', '18:00')])).toEqual({ pairs: [], open: null });
  });

  it('each pair within the shift’s window: one partly outside it counts its part inside', () => {
    // 7:00–10:00 counts 9:00–10:00; 18:00–21:00 counts 18:00–19:15 (the end with the grace)
    expect(hoursCountedForPresses([press('in', '07:00'), press('out', '10:00'), press('in', '18:00'), press('out', '21:00')], most, window)).toBe(1 + 1.25);
    // a pair wholly outside: nothing
    expect(hoursCountedForPresses([press('in', '19:30'), press('out', '21:00')], most, window)).toBe(0);
    // a break outside the window isn't a break inside it
    expect(breakMinutesOf(pairPresses([press('in', '07:00'), press('out', '08:00'), press('in', '08:30'), press('out', '17:00')]).pairs, null, window)).toBe(0);
  });

  it('the sum at most the shift’s hours a day; not capped on a shift that counts hours until a time', () => {
    const long = [press('in', '09:00'), press('out', '13:00'), press('in', '13:30'), press('out', '19:15')];
    expect(hoursCountedForPresses(long, most, window)).toBe(9);
    const untilEight = { ...MORNING, countUntil: '20:00' };
    expect(hoursCountedForPresses([...long.slice(0, 3), press('out', '20:30')], mostHoursCountedADay(untilEight), shiftWindowOn(DAY, untilEight))).toBe(4 + 6.5);
  });

  it('a check-out past midnight on a night shift counts on the night before', () => {
    const night = { startTime: '22:00', endTime: '06:00', hoursPerDay: 8, graceMinutes: 0 };
    const presses = [press('in', '22:00'), press('out', '01:00', '2026-10-19'), press('in', '01:30', '2026-10-19'), press('out', '06:00', '2026-10-19')];
    expect(hoursCountedForPresses(presses, mostHoursCountedADay(night), shiftWindowOn(DAY, night))).toBe(7.5);
    expect(breakMinutesOf(pairPresses(presses).pairs, null, shiftWindowOn(DAY, night))).toBe(30);
  });

  it('part of a day of official duty joins the pairs, the time they share counted once', () => {
    // pairs 9:00–12:00 and 15:00–18:00, the duty 11:00–16:00: 9:00–18:00 together, 9 hours
    const presses = [press('in', '09:00'), press('out', '12:00'), press('in', '15:00'), press('out', '18:00')];
    const od = { from: Date.parse(at('11:00')), to: Date.parse(at('16:00')) };
    expect(hoursCountedForPresses(presses, most, window, [od])).toBe(9);
    expect(hoursCountedForPresses(presses, most, window)).toBe(6);
  });

  it('counts whole minutes of the total: a part minute isn’t counted', () => {
    // 3:59:30 and 4:00:40 together are 8:00:10: 8 hours
    const presses = [
      { kind: 'in', at: '2026-10-18T09:00:30+03:00' },
      { kind: 'out', at: '2026-10-18T13:00:00+03:00' },
      { kind: 'in', at: '2026-10-18T14:00:00+03:00' },
      { kind: 'out', at: '2026-10-18T18:00:40+03:00' },
    ];
    expect(hoursCountedForPresses(presses, most, window)).toBe(8);
    // 4:59:59 alone: 4:59
    expect(hoursCountedForPresses([{ kind: 'in', at: '2026-10-18T09:00:01+03:00' }, { kind: 'out', at: '2026-10-18T14:00:00+03:00' }], most, window)).toBe(4 + 59 / 60);
  });
});

describe('a day kept from its punches', () => {
  it('keeps its first check-in, its last check-out, its pairs, the break and an open last check-in', () => {
    const d = dayFromPunches(DAY, [punch('in', '09:02'), punch('out', '13:10'), punch('in', '14:00'), punch('out', '18:05'), punch('in', '18:30')], MORNING);
    expect(d).toMatchObject({
      checkIn: at('09:02'),
      checkOut: at('18:05'),
      openAt: at('18:30'),
      pairs: [
        { in: at('09:02'), out: at('13:10') },
        { in: at('14:00'), out: at('18:05') },
      ],
      // 4:08 and 4:05; the break 50 minutes, and 25 more before the open check-in
      hoursCounted: 8 + 13 / 60,
      breakMinutes: 75,
    });
    expect(pairsText(d.pairs)).toBe('9:02 AM–1:10 PM · 2:00 PM–6:05 PM');
    expect(openPressText(d.openAt!)).toBe('Checked in 6:30 PM · not checked out');
    expect([breakText(50), breakText(65), breakText(60), breakText(0), breakText(null)]).toEqual(['Break 50 min', 'Break 1 h 5 min', 'Break 1 h', null, null]);
  });

  it('reads its pairs back from the database only when they are pairs', () => {
    expect(readPressPairs([{ in: at('09:00'), out: at('13:00') }])).toEqual([{ in: at('09:00'), out: at('13:00') }]);
    expect(readPressPairs([])).toEqual([]);
    for (const bad of [null, 'x', [{ in: 'x', out: at('13:00') }], [{ in: at('09:00') }], {}]) expect(readPressPairs(bad)).toBeNull();
  });
});

describe('a day with an open last check-in, as the pages and the payroll take it (27 October 2026: half the shift until corrected)', () => {
  const base: KeptDay = {
    date: DAY,
    status: 'worked',
    checkIn: at('09:00'),
    checkOut: at('13:00'),
    place: 'office',
    zohoStatus: null,
    permissionHours: 0,
    hoursCounted: 4,
    source: 'system',
    flags: [],
    pairs: [{ in: at('09:00'), out: at('13:00') }],
    openAt: at('14:00'),
    breakMinutes: 60,
  };

  it('is a missing check-out counted as half a day until corrected: its pairs’ hours and half the shift, short by the rest, among the days counted', () => {
    const view = attendanceDayView(base, 9);
    // 4 hours of pairs and half the 9-hour shift: 8:30, short by 0:30
    expect(view).toMatchObject({ missingCheckOut: true, openHalfDay: true, missingCheckIn: false, hoursCounted: 8.5, shortHours: 0.5, extraHours: 0, openAt: at('14:00'), breakMinutes: 60 });
    expect(openHalfDayOn(base)).toBe(true);
    expect(countsDayHours(base)).toBe(true);
    const f = attendanceFigures([view]);
    expect(f).toMatchObject({ missingCheckOuts: 1, hoursCounted: 8.5, shortHours: 0.5, daysCounted: 1, daysWorked: 1 });
    // Zoho's missing check-out: as its import counted it, not counted, never short
    const zoho: KeptDay = { ...base, source: 'zoho', checkOut: null, openAt: null, pairs: null, hoursCounted: 0 };
    expect(openHalfDayOn(zoho)).toBe(false);
    expect(countsDayHours(zoho)).toBe(false);
    expect(attendanceDayView(zoho, 9)).toMatchObject({ missingCheckOut: true, openHalfDay: false, hoursCounted: 0, shortHours: 0 });
  });

  it('counts normally once closed: short or extra included', () => {
    const closed = { ...base, checkOut: at('17:00'), openAt: null, pairs: [...base.pairs!, { in: at('14:00'), out: at('17:00') }], hoursCounted: 7 };
    expect(attendanceDayView(closed, 9)).toMatchObject({ missingCheckOut: false, shortHours: 2 });
    expect(countsDayHours(closed)).toBe(true);
  });

  it('a day with only a check-in: a missing check-out counted as half the shift (4:30 of 9), short by the other half', () => {
    const only = { ...base, checkOut: null, pairs: [], openAt: at('09:00'), hoursCounted: 0 };
    expect(attendanceDayView(only, 9)).toMatchObject({ missingCheckOut: true, openHalfDay: true, hoursCounted: 4.5, shortHours: 4.5 });
    // one kept before the pairs (none kept): the same
    expect(attendanceDayView({ ...only, pairs: null, openAt: null }, 9)).toMatchObject({ missingCheckOut: true, openHalfDay: true, hoursCounted: 4.5, shortHours: 4.5 });
    // without the shift's hours: its pairs' hours alone, nothing to be short of
    expect(attendanceDayView(only, null)).toMatchObject({ hoursCounted: 0, shortHours: 0 });
  });

  it('gives the payroll the same hours (owner, 27 October 2026: "Half the shift (4.5 h) until corrected"); paid by the hour only its closed pairs', () => {
    // only an open check-in: 4:30; 3 hours of pairs and one: 7:30; 8 hours and one: 9, the shift's hours a day at most
    expect(openCheckInHours(0, 9)).toBe(4.5);
    expect(openCheckInHours(3, 9)).toBe(7.5);
    expect(openCheckInHours(8, 9)).toBe(9);
    expect(openCheckInHours(3, null)).toBe(3);
    const onlyIn: KeptDay = { ...base, checkOut: null, pairs: [], openAt: at('09:00'), hoursCounted: 0 };
    expect(lineDayHours(onlyIn, 9)).toBe(4.5);
    expect(lineDayHours({ ...base, hoursCounted: 3 }, 9)).toBe(7.5);
    expect(lineDayHours({ ...base, hoursCounted: 8 }, 9)).toBe(9);
    // 4 hours of pairs and the open check-in: 8:30
    expect(lineDayHours(base, 9)).toBe(8.5);
    // without a shift: its hours
    expect(lineDayHours(base, null)).toBe(4);
    // Zoho's missing check-out: as Zoho's import counts it, nothing
    const zoho: KeptDay = { ...base, source: 'zoho', checkOut: null, openAt: null, pairs: null, hoursCounted: 0 };
    expect(lineDayHours(zoho, 9)).toBe(0);
    const closed = { ...base, openAt: null, hoursCounted: 7 };
    const days = [base, closed];
    expect(attendanceLineInputs(days, { systemPermissionHours: 0, permissionHoursPerMonth: 4, hourly: false, hoursADay: 9 }).workedHours).toBe(15.5);
    expect(attendanceLineInputs(days, { systemPermissionHours: 0, permissionHoursPerMonth: 4, hourly: true, hoursADay: 9 })).toEqual({ workedHours: 11 });
    // an API caller from before (no hours a day given): the hours counted
    expect(attendanceLineInputs(days, { systemPermissionHours: 0, permissionHoursPerMonth: 4, hourly: false }).workedHours).toBe(11);
    // the pages agree with the payroll: the month's hours counted are the line's
    expect(attendanceFigures([attendanceDayView(base, 9), attendanceDayView(closed, 9)]).hoursCounted).toBe(15.5);
  });

  it('lists the days so counted for the line’s warning and for Send to the CEO; none by the hour or without the shift’s hours', () => {
    const onlyIn: KeptDay = { ...base, date: '2026-10-19', checkOut: null, pairs: [], openAt: at('09:00', '2026-10-19'), hoursCounted: 0 };
    const closed = { ...base, date: '2026-10-20', openAt: null, hoursCounted: 7 };
    const zoho: KeptDay = { ...base, date: '2026-10-21', source: 'zoho', checkOut: null, openAt: null, pairs: null, hoursCounted: 0 };
    const days = [onlyIn, closed, base, zoho];
    expect(openCheckInDates(days, { hourly: false, hoursADay: 9 })).toEqual(['2026-10-18', '2026-10-19']);
    expect(openCheckInDates(days, { hourly: true, hoursADay: 9 })).toEqual([]);
    expect(openCheckInDates(days, { hourly: false, hoursADay: null })).toEqual([]);
    // a day worked that a compensatory day off compensates adds no hours, so nothing to warn about
    expect(openCheckInDates([{ ...base, compensated: true }], { hourly: false, hoursADay: 9 })).toEqual([]);
    // the warning on the line, and what Send to the CEO asks
    expect(openCheckInWarning(['2026-11-05', '2026-11-12'])).toBe('2 days with no check-out counted as half a day each until corrected: 05/11, 12/11.');
    expect(openCheckInWarning(['2026-11-05'])).toBe('1 day with no check-out counted as half a day until corrected: 05/11.');
    expect(openCheckInWarning([])).toBeNull();
    expect(openCheckInsConfirm(3)).toBe('3 people have days with no check-out, counted as half a day each until corrected. Send anyway?');
    expect(openCheckInsConfirm(1)).toBe('1 person has days with no check-out, counted as half a day each until corrected. Send anyway?');
    expect(openCheckInsConfirm(0)).toBeNull();
  });

  it('with part of a day of official duty, the duty joins the pairs', () => {
    const closed = { ...base, checkOut: at('18:00'), openAt: null, pairs: [{ in: at('09:00'), out: at('12:00') }, { in: at('15:00'), out: at('18:00') }], hoursCounted: 6 };
    const od = { requestId: 'od-1', fullDay: false, fromTime: '11:00', toTime: '16:00', hours: 5 };
    expect(withOfficialDuty(closed, od, MORNING).hoursCounted).toBe(9);
    // a day not kept by pairs (Zoho's): its check-in to its check-out
    expect(withOfficialDuty({ ...closed, pairs: null, source: 'zoho' }, od, MORNING).hoursCounted).toBe(9);
  });
});

describe('a correction over the pairs', () => {
  const day = {
    status: 'worked' as const,
    checkIn: at('09:00'),
    checkOut: at('13:00'),
    place: 'office' as const,
    source: 'system' as const,
    pairs: [{ in: at('09:00'), out: at('13:00') }],
    openAt: at('14:00'),
  };
  const ctx = { today: '2026-10-20', runStatus: null, day, shift: MORNING, open: false };

  it('the check-out forgotten closes the open last check-in, the break not counted', () => {
    expect(correctionProblems({ date: DAY, kind: 'forgot_check_out', checkOut: '18:00', reason: 'Left for a client' }, ctx)).toEqual([]);
    const made = correctedDay(day, { kind: 'forgot_check_out', checkIn: null, checkOut: at('18:00') }, DAY, MORNING);
    expect(made).toMatchObject({ checkIn: at('09:00'), checkOut: at('18:00'), openAt: null, hoursCounted: 8, breakMinutes: 60 });
    expect(made.pairs).toHaveLength(2);
    // before the open check-in: refused, said plainly
    expect(correctionProblems({ date: DAY, kind: 'forgot_check_out', checkOut: '13:30', reason: 'Left' }, ctx)).toEqual([
      'The check-out (1:30 PM) must be after the last check-in (2:00 PM), the one without a check-out.',
    ]);
  });

  it('both times given: that one pair, the presses replaced, as before; one as on record changes only the other', () => {
    expect(correctedDay(day, { kind: 'wrong_time', checkIn: at('08:30'), checkOut: at('17:00') }, DAY, MORNING)).toMatchObject({ pairs: [{ in: at('08:30'), out: at('17:00') }], hoursCounted: 8, openAt: null });
    // the check-in typed as on record: the check-out alone, closing the open check-in
    expect(correctedDay(day, { kind: 'forgot_check_out', checkIn: at('09:00'), checkOut: at('18:00') }, DAY, MORNING)).toMatchObject({ hoursCounted: 8, openAt: null });
  });

  it('the check-in alone moves the first pair’s start; the check-out alone of a closed day its last pair’s end', () => {
    const closed = { ...day, checkOut: at('18:00'), openAt: null, pairs: [{ in: at('09:00'), out: at('13:00') }, { in: at('14:00'), out: at('18:00') }] };
    expect(correctedDay(closed, { kind: 'wrong_time', checkIn: at('10:00'), checkOut: null }, DAY, MORNING)).toMatchObject({ checkIn: at('10:00'), hoursCounted: 7 });
    expect(correctedDay(closed, { kind: 'wrong_time', checkIn: null, checkOut: at('17:00') }, DAY, MORNING)).toMatchObject({ checkOut: at('17:00'), hoursCounted: 7 });
  });

  it('says what it was corrected from, each pair and the open check-in', () => {
    expect(correctedFromText({ source: 'system', status: 'worked', checkIn: day.checkIn, checkOut: day.checkOut, place: 'office', pairs: day.pairs, openAt: day.openAt })).toBe(
      'Corrected from 9:00 AM – 1:00 PM · 2:00 PM – no check-out',
    );
    // one pair, or one kept before the pairs: as before
    expect(correctedFromText({ source: 'system', status: 'worked', checkIn: day.checkIn, checkOut: day.checkOut, place: 'office' })).toBe('Corrected from 9:00 AM – 1:00 PM');
  });
});
