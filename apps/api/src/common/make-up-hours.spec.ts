import {
  attendanceDayView,
  attendanceFigures,
  attendanceLineInputs,
  attendanceMonth,
  correctedDay,
  countUntilOf,
  countUntilProblems,
  dayFromPunches,
  EMPTY_PAYROLL_INPUTS,
  hoursCountedForDay,
  makesUpHours,
  mostHoursCountedADay,
  PAYROLL_RULE_DEFAULTS,
  payrollLine,
  shiftWindowOn,
  type KeptDay,
  type PayrollInputs,
  type PayrollTerms,
  type ShiftWindowTimes,
} from '@trendlix/shared';

// Make-up hours (owner, 20 October 2026, asked "if an employee failed to complete 9 hours in a da, can he work extra
// hours next day ? to raise his average?" and choosing within the same month: "within the same month with no working
// hours to be counted after 8 PM even if the check out was 11 PM / record the checkout time but count till the checkout
// window limit"): a shift's "Count hours until" (packages/shared attendance.ts), the days' extra time against their
// short hours (attendance-days.ts), and the month on payroll (payroll.ts). Every figure here is invented.

/** The MORNING shift: 9 hours within 9:00 AM to 7:00 PM, 15 minutes' grace; and the same counting until 8:00 PM. */
const MORNING = { startTime: '09:00', endTime: '19:00', hoursPerDay: 9, graceMinutes: 15 };
const UNTIL_8PM = { ...MORNING, countUntil: '20:00' };

/** A time on a day in Cairo (summer time until 29 October 2026). */
const at = (time: string, day = '2026-10-18') => `${day}T${time}:00+03:00`;
const iso = (time: string, day = '2026-10-18') => new Date(at(time, day)).toISOString();

/** The hours a day counts from a check-in and a check-out, by the shift's rule. */
const counted = (shift: ShiftWindowTimes & { hoursPerDay?: number | null }, checkIn: string, checkOut: string, day = '2026-10-18') =>
  hoursCountedForDay(at(checkIn, day), at(checkOut, day), mostHoursCountedADay(shift), shiftWindowOn(day, shift));

describe('make-up hours: a day on a shift that counts hours until a time', () => {
  it('counts until the limit, never after it: checked out at 11 PM, counted until 8 PM', () => {
    // 10:00 AM to 11:00 PM: 10:00 AM to 8:00 PM counts, 10 hours, past the 9 to work
    expect(counted(UNTIL_8PM, '10:00', '23:00')).toBe(10);
    // the same day without the limit: 9, today's rule
    expect(counted(MORNING, '10:00', '23:00')).toBe(9);
  });

  it('counts from the later of the check-in and the window’s start, to the earlier of the check-out and the limit', () => {
    // 7:00 AM to 9:30 PM: 9:00 AM to 8:00 PM, 11 hours
    expect(counted(UNTIL_8PM, '07:00', '21:30')).toBe(11);
    // 9:30 AM to 7:45 PM: 10:15
    expect(counted(UNTIL_8PM, '09:30', '19:45')).toBe(10.25);
    // a short day stays short: 11:00 AM to 6:00 PM, 7
    expect(counted(UNTIL_8PM, '11:00', '18:00')).toBe(7);
    // in after the limit: nothing
    expect(counted(UNTIL_8PM, '20:30', '23:00')).toBe(0);
  });

  it('isn’t capped at the hours to work: the limit is its cap', () => {
    expect(mostHoursCountedADay(UNTIL_8PM)).toBeNull();
    expect(mostHoursCountedADay(MORNING)).toBe(9);
    expect([makesUpHours(UNTIL_8PM), makesUpHours(MORNING), makesUpHours({ ...MORNING, countUntil: null }), makesUpHours({ ...MORNING, countUntil: '' })]).toEqual([
      true,
      false,
      false,
      false,
    ]);
  });

  it('ends at the limit in Cairo whatever the summer time, never before the end and the grace, a night shift’s the next morning', () => {
    expect(new Date(shiftWindowOn('2026-10-18', UNTIL_8PM)!.end).toISOString()).toBe('2026-10-18T17:00:00.000Z');
    // winter time (from 30 October 2026): 8:00 PM is 18:00 UTC
    expect(new Date(shiftWindowOn('2026-11-15', UNTIL_8PM)!.end).toISOString()).toBe('2026-11-15T18:00:00.000Z');
    // a limit at the end itself keeps the grace: 7:15 PM
    expect(new Date(shiftWindowOn('2026-10-18', { ...MORNING, countUntil: '19:00' })!.end).toISOString()).toBe('2026-10-18T16:15:00.000Z');
    const night = shiftWindowOn('2026-10-18', { startTime: '22:00', endTime: '06:00', countUntil: '08:00' })!;
    expect([new Date(night.start).toISOString(), new Date(night.end).toISOString()]).toEqual(['2026-10-18T19:00:00.000Z', '2026-10-19T05:00:00.000Z']);
  });

  it('keeps the real check-in and check-out: only the hours counted change (check-ins, corrections, Zoho’s days)', () => {
    const punches = [
      { kind: 'in' as const, at: iso('09:05'), place: 'office' as const },
      { kind: 'out' as const, at: iso('23:00'), place: 'office' as const },
    ];
    expect(dayFromPunches('2026-10-18', punches, UNTIL_8PM)).toMatchObject({ checkIn: iso('09:05'), checkOut: iso('23:00'), hoursCounted: 10 + 55 / 60 });
    expect(dayFromPunches('2026-10-18', punches, MORNING)).toMatchObject({ checkIn: iso('09:05'), checkOut: iso('23:00'), hoursCounted: 9 });
    const forgot = { kind: 'forgot_check_out' as const, checkIn: iso('09:00'), checkOut: iso('22:00') };
    expect(correctedDay(null, forgot, '2026-10-18', UNTIL_8PM)).toMatchObject({ checkIn: iso('09:00'), checkOut: iso('22:00'), hoursCounted: 11 });
    expect(correctedDay(null, forgot, '2026-10-18', MORNING).hoursCounted).toBe(9);

    // Zoho People's daily entries: the same rule
    const zoho = (shift: typeof MORNING & { countUntil?: string | null }) =>
      attendanceMonth({
        month: '2026-10',
        days: [
          { date: '2026-10-18', checkIn: at('10:00'), checkOut: at('23:00'), place: 'office', zohoStatus: null, permissionHours: 0 },
          { date: '2026-10-19', checkIn: at('11:00', '2026-10-19'), checkOut: at('18:00', '2026-10-19'), place: 'office', zohoStatus: null, permissionHours: 0 },
        ],
        shift: { ...shift, workingDays: [0, 1, 2, 3, 4] },
        holidays: [],
        leaveDays: [],
        employedFrom: '2026-10-18',
        employedTo: '2026-10-19',
        systemPermissionHours: 0,
        permissionHoursPerMonth: 4,
      });
    expect(zoho(UNTIL_8PM)).toMatchObject({ hoursCounted: 17, days: [{ checkOut: at('23:00'), hoursCounted: 10 }, { hoursCounted: 7 }] });
    expect(zoho(MORNING)).toMatchObject({ hoursCounted: 16, days: [{ hoursCounted: 9 }, { hoursCounted: 7 }] });
  });
});

describe('make-up hours: without "Count hours until", today’s rule as it was', () => {
  it('ends at the window’s end and grace, at most the hours to work', () => {
    expect(new Date(shiftWindowOn('2026-10-18', MORNING)!.end).toISOString()).toBe('2026-10-18T16:15:00.000Z');
    expect(counted(MORNING, '10:15', '23:00')).toBe(9);
    expect(counted(MORNING, '10:30', '19:30')).toBe(8.75);
    expect(counted({ ...MORNING, countUntil: null }, '07:00', '21:30')).toBe(9);
  });

  it('takes a limit that isn’t allowed (before the end) as none', () => {
    expect([countUntilOf(MORNING), countUntilOf({ ...MORNING, countUntil: '18:00' }), countUntilOf(UNTIL_8PM)]).toEqual([null, null, '20:00']);
    expect(counted({ ...MORNING, countUntil: '18:00' }, '10:00', '23:00')).toBe(9);
  });
});

describe('make-up hours: "Count hours until" is at or after the end, the same day', () => {
  it('takes the end or later, before midnight; none is nothing to check', () => {
    for (const countUntil of ['19:00', '20:00', '23:59', null, undefined, '']) expect(countUntilProblems({ ...MORNING, countUntil })).toEqual([]);
    expect(countUntilProblems({ ...MORNING, countUntil: '18:59' })).toEqual(['Choose a "Count hours until" time at or after the shift ends, 7:00 PM, and before midnight.']);
    expect(countUntilProblems({ ...MORNING, countUntil: '8 PM' })).toEqual(['Choose the time hours count until as a time of day, e.g. 8:00 PM.']);
  });

  it('on a shift past midnight, the next morning before it starts again', () => {
    const night = { startTime: '22:00', endTime: '06:00' };
    expect(countUntilProblems({ ...night, countUntil: '08:00' })).toEqual([]);
    const refused = ['Choose a "Count hours until" time at or after the shift ends, 6:00 AM, and before it starts again, 10:00 PM.'];
    expect(countUntilProblems({ ...night, countUntil: '22:00' })).toEqual(refused);
    expect(countUntilProblems({ ...night, countUntil: '05:00' })).toEqual(refused);
  });
});

describe('make-up hours: a month’s days', () => {
  const worked = (date: string, hours: number, more: Partial<KeptDay> = {}): KeptDay => ({
    date,
    status: 'worked',
    checkIn: `${date}T07:00:00.000Z`,
    checkOut: `${date}T17:00:00.000Z`,
    place: 'office',
    zohoStatus: null,
    permissionHours: 0,
    hoursCounted: hours,
    ...more,
  });
  const views = (days: KeptDay[]) => days.map((d) => attendanceDayView(d, 9));

  it('says a long day’s extra time and a short day’s short hours, and fills the short hours with the extra, at most them', () => {
    const days = views([worked('2026-10-04', 7), worked('2026-10-05', 10.5), worked('2026-10-06', 9)]);
    expect(days.map((d) => [d.shortHours, d.extraHours])).toEqual([
      [2, 0],
      [0, 1.5],
      [0, 0],
    ]);
    expect(attendanceFigures(days)).toMatchObject({ daysCounted: 3, hoursCounted: 26.5, shortHours: 2, extraHours: 1.5, shortHoursFilled: 1.5 });
    // more extra than short: only the short hours are filled
    expect(attendanceFigures(views([worked('2026-10-04', 7), worked('2026-10-05', 11), worked('2026-10-06', 10)]))).toMatchObject({ shortHours: 2, extraHours: 3, shortHoursFilled: 2 });
  });

  it('fills only the same calendar month: October’s extra never fills November’s short hours', () => {
    expect(attendanceFigures(views([worked('2026-10-29', 11), worked('2026-11-01', 7)]))).toMatchObject({ shortHours: 2, extraHours: 2, shortHoursFilled: 0 });
  });

  it('never fills a no-show or a leave day: they have no short hours', () => {
    const none = { checkIn: null, checkOut: null, place: null };
    const days = views([worked('2026-10-04', 11), worked('2026-10-05', 0, { status: 'absent', ...none }), worked('2026-10-06', 0, { status: 'leave', ...none })]);
    expect(attendanceFigures(days)).toMatchObject({ absentDays: 1, leaveDays: 1, shortHours: 0, extraHours: 2, shortHoursFilled: 0 });
  });

  it('gives the payroll line the month’s hours counted, the long days’ in full', () => {
    const days = [worked('2026-10-04', 7), worked('2026-10-05', 11), worked('2026-10-06', 0, { status: 'absent', checkIn: null, checkOut: null })];
    expect(attendanceLineInputs(days, { systemPermissionHours: 0, permissionHoursPerMonth: 4, hourly: false })).toEqual({ workedHours: 18, noShowDays: 1, permissionHours: null });
  });
});

describe('make-up hours: the month on payroll', () => {
  /** A whole month on the MORNING shift: gross 12,000 (fixed 9,600), 22 working days of 9 hours, 198 expected. */
  const onShift: PayrollTerms = {
    year: 2026,
    payBasis: 'monthly',
    gross: 12_000,
    basicPercent: 80,
    hourlyRate: null,
    allowances: [],
    paidDays: 30,
    statutory: true,
    insured: true,
    insuredWage: 12_000,
    hoursPerDay: 9,
    expectedHours: 198,
    expectedDays: { workingDays: 22, holidays: 0 },
  };
  const makeUp: PayrollTerms = { ...onShift, makeUpHours: true };
  const inputs = (given: Partial<PayrollInputs>): PayrollInputs => ({ ...EMPTY_PAYROLL_INPUTS, ...given });

  it('fills a short day with a long one: 11 days of 7 hours and 11 of 11 hours are full attendance', () => {
    const [short, long] = [counted(UNTIL_8PM, '11:00', '18:00'), counted(UNTIL_8PM, '09:00', '21:00')];
    expect([short, long]).toEqual([7, 11]);
    expect(payrollLine(makeUp, inputs({ workedHours: 11 * short + 11 * long }))).toMatchObject({ expectedHours: 198, attendanceRatio: 1, attendanceScore: 1, attendanceCut: 0, earned: 12_000 });
    // without the limit the long days count 9: 176 of 198, below the 90% grace, and the fixed part is cut
    const without = payrollLine(onShift, inputs({ workedHours: 11 * short + 11 * counted(MORNING, '09:00', '21:00') }));
    expect(without.attendanceRatio).toBeCloseTo(176 / 198, 10);
    expect(without.attendanceCut).toBeGreaterThan(0);
  });

  it('counts at most the expected hours while overtime isn’t paid: making up is never overtime', () => {
    const line = payrollLine(makeUp, inputs({ workedHours: 230 }));
    expect(line).toMatchObject({ expectedHours: 198, attendanceRatio: 1, hoursOverExpected: 32, overtime: 0, earned: 12_000 });
    // a day counts past its 9 hours here: no warning that attendance counts at most 9 a day
    expect(line.warnings).toEqual([]);
    // with the permission hours counted as worked, the same
    expect(payrollLine({ ...makeUp, permissionHours: 4 }, inputs({ workedHours: 196 }))).toMatchObject({ permissionHours: 4, attendanceRatio: 1, hoursOverExpected: 2 });
  });

  it('counts the hours uncapped once overtime is paid, overtime worked out on them as before', () => {
    const rules = { ...PAYROLL_RULE_DEFAULTS, payOvertime: true };
    const line = payrollLine(makeUp, inputs({ workedHours: 230 }), rules);
    expect(line.attendanceRatio).toBeCloseTo(230 / 198, 10);
    expect(line.hoursOverExpected).toBeUndefined();
    expect(line.overtime).toBeGreaterThan(0);
    expect(line.overtime).toBe(payrollLine(onShift, inputs({ workedHours: 230 }), rules).overtime);
  });

  it('never makes up a no-show or a leave day: their hours are out of the expected hours, the no-show cut as it was', () => {
    // 20 days worked of 9:54, 198 hours: enough for the two days, had they counted
    const line = payrollLine(makeUp, inputs({ workedHours: 198, noShowDays: 1, leaveDays: 1 }));
    expect(line).toMatchObject({ absentHours: 9, leaveHours: 9, expectedHours: 180, attendanceRatio: 1, hoursOverExpected: 18, noShowCut: 800 });
    expect(line.noShowCut).toBe(payrollLine(onShift, inputs({ workedHours: 180, noShowDays: 1, leaveDays: 1 })).noShowCut);
  });

  it('is as it was without "Count hours until", and on lines made before it', () => {
    const line = payrollLine(onShift, inputs({ workedHours: 210 }));
    expect(line.attendanceRatio).toBeCloseTo(210 / 198, 10);
    expect(line.hoursOverExpected).toBeUndefined();
    expect(line.warnings).toEqual(["Worked hours are more than 9:00 a day on the shift's working days (198:00 this month): attendance will count at most 9:00 a day"]);
    expect(payrollLine({ ...onShift, makeUpHours: false }, inputs({ workedHours: 210 }))).toEqual(line);
  });
});
