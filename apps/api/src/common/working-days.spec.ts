import {
  EMPTY_PAYROLL_INPUTS,
  expectedHoursOf,
  measuredExpectedHours,
  mostCountedHours,
  NO_SHIFT_NO_EXPECTED_HOURS,
  payrollLine,
  shiftDaysIn,
  shiftExpectedHours,
  type PayrollInputs,
  type PayrollResult,
  type PayrollTerms,
} from '@trendlix/shared';

// The expected hours a run works out from each monthly-paid person's shift (owner's request, 16 October 2026, Payroll
// Setup): the shift's working days within the days paid in the month, less the official holidays on them, × its hours
// a day; less the no-show and leave days since 17 October 2026 (owner: "prefill the expected hours, and dont count
// abcent days or leave days, as they already have their own deduction and fields"); never typed since 20 October 2026
// (owner: "expected hours to be locked based on shifts and attendance data"), what HR typed on a run before then used
// as it is on the lines saved with it. packages/shared payroll.ts. Invented figures and holidays.

const SUN_TO_THU = [0, 1, 2, 3, 4];

describe('working days: a shift’s days in a month', () => {
  it('counts the shift’s weekdays in the whole month', () => {
    // September 2026 starts on a Tuesday: 22 Sundays to Thursdays
    expect(shiftDaysIn('2026-09', '2025-01-01', null, SUN_TO_THU, [])).toEqual({ workingDays: 22, holidays: 0 });
    // February 2026: 20; a shift of Saturdays only: 4
    expect(shiftDaysIn('2026-02', '2025-01-01', null, SUN_TO_THU, [])).toEqual({ workingDays: 20, holidays: 0 });
    expect(shiftDaysIn('2026-02', '2025-01-01', null, [6], [])).toEqual({ workingDays: 4, holidays: 0 });
  });

  it('counts the holidays on the working days only: one on a day off takes no hours away', () => {
    // Thursday 3 September is a working day, Saturday 5 September is not; one given twice counts once
    expect(shiftDaysIn('2026-09', '2025-01-01', null, SUN_TO_THU, ['2026-09-03', '2026-09-05', '2026-09-03'])).toEqual({ workingDays: 22, holidays: 1 });
    // holidays of another month don't count
    expect(shiftDaysIn('2026-09', '2025-01-01', null, SUN_TO_THU, ['2026-10-06', '2026-08-31'])).toEqual({ workingDays: 22, holidays: 0 });
  });

  it('counts only the days employed: a joiner from their first day, a leaver to their last', () => {
    // from Saturday the 12th: 14 working days; the 3rd's holiday is before it, the 15th's in it
    expect(shiftDaysIn('2026-09', '2026-09-12', null, SUN_TO_THU, ['2026-09-03', '2026-09-15'])).toEqual({ workingDays: 14, holidays: 1 });
    // to Thursday the 10th: 8 working days
    expect(shiftDaysIn('2026-09', '2025-01-01', '2026-09-10', SUN_TO_THU, ['2026-09-03', '2026-09-15'])).toEqual({ workingDays: 8, holidays: 1 });
    // joined and left in the month: Sunday the 6th to Wednesday the 9th
    expect(shiftDaysIn('2026-09', '2026-09-06', '2026-09-09', SUN_TO_THU, [])).toEqual({ workingDays: 4, holidays: 0 });
    // not employed in the month at all
    expect(shiftDaysIn('2026-09', '2026-10-01', null, SUN_TO_THU, [])).toEqual({ workingDays: 0, holidays: 0 });
    expect(shiftDaysIn('2026-09', '2025-01-01', '2026-08-31', SUN_TO_THU, [])).toEqual({ workingDays: 0, holidays: 0 });
  });

  it('refuses a month or a date not written as one', () => {
    expect(() => shiftDaysIn('2026-9', '2025-01-01', null, SUN_TO_THU, [])).toThrow('shiftDaysIn: "2026-9" is not a month (YYYY-MM)');
    expect(() => shiftDaysIn('2026-09', '1/1/2025', null, SUN_TO_THU, [])).toThrow('shiftDaysIn: "1/1/2025" is not a date (YYYY-MM-DD)');
  });
});

describe('working days: the expected hours', () => {
  it('are the working days less the holidays, × the shift’s hours a day', () => {
    expect(shiftExpectedHours({ workingDays: 22, holidays: 1 }, 9)).toBe(189);
    expect(shiftExpectedHours({ workingDays: 22, holidays: 0 }, 8.5)).toBe(187);
    expect(shiftExpectedHours({ workingDays: 3, holidays: 3 }, 9)).toBe(0);
  });

  it('are the shift’s less the no-show and leave days, else none (17 October 2026); HR’s on a line saved with them before 20 October 2026', () => {
    const shift = { expectedHours: 189, hoursPerDay: 9 };
    const days = (expectedHours: number | null, noShowDays: number | null = null, leaveDays: number | null = null) => ({ expectedHours, noShowDays, leaveDays });
    // never typed since 20 October 2026 (owner: "expected hours to be locked based on shifts and attendance data"); a
    // figure HR typed before then (a run with the CEO, approved or paid) is already without the days off: nothing comes
    // out of it
    expect(expectedHoursOf(shift, days(200, 2, 1))).toBe(200);
    expect(expectedHoursOf(shift, days(null))).toBe(189);
    // 189 − (2 + 1) × 9 = 162; half days too: 189 − 1.5 × 9 = 175.5
    expect(expectedHoursOf(shift, days(null, 2, 1))).toBe(162);
    expect(expectedHoursOf(shift, days(null, 0.5, 1))).toBe(175.5);
    // never below 0
    expect(expectedHoursOf({ expectedHours: 18, hoursPerDay: 9 }, days(null, 3))).toBe(0);
    // HR's 0, typed then, is a figure too
    expect(expectedHoursOf(shift, days(0))).toBe(0);
    expect(expectedHoursOf({ expectedHours: null, hoursPerDay: 9 }, days(null, 2))).toBeNull();
    // terms worked out before 16 October 2026 have none; inputs saved before 17 October 2026 have no leave days
    expect(expectedHoursOf({ hoursPerDay: null }, days(null))).toBeNull();
    expect(expectedHoursOf(shift, { expectedHours: null, noShowDays: 1 } as PayrollInputs)).toBe(180);
  });

  it('are shown as a line was measured on them: its own record since 17 October 2026, else as worked out then', () => {
    const line = (inputs: Partial<PayrollInputs>, result: Partial<PayrollResult>) => ({
      payBasis: 'monthly' as const,
      terms: { expectedHours: 189 },
      inputs: { ...EMPTY_PAYROLL_INPUTS, ...inputs },
      result: result as PayrollResult,
    });
    expect(measuredExpectedHours(line({ expectedHours: 200, noShowDays: 2 }, { expectedHours: 200, absentHours: 0 }))).toBe(200);
    expect(measuredExpectedHours(line({ noShowDays: 2 }, { expectedHours: 171, absentHours: 18 }))).toBe(171);
    // before 17 October 2026: the no-show days' hours came out of a typed figure too
    expect(measuredExpectedHours(line({ expectedHours: 200, noShowDays: 2 }, { absentHours: 18 }))).toBe(182);
    expect(measuredExpectedHours(line({ noShowDays: 2 }, { absentHours: 18 }))).toBe(171);
    // before 16 October 2026: no absent hours either
    expect(measuredExpectedHours({ ...line({ expectedHours: 200 }, {}), terms: {} })).toBe(200);
    expect(measuredExpectedHours({ ...line({}, {}), terms: {} })).toBeNull();
    // by the hour: none
    expect(measuredExpectedHours({ ...line({ expectedHours: 100 }, { expectedHours: null, absentHours: 0 }), payBasis: 'hourly' })).toBeNull();
  });
});

describe('working days: the pay with the shift’s expected hours', () => {
  /** A whole month on a 9-hour shift, 21 working days left after a holiday: 189 hours. */
  const terms: PayrollTerms = {
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
    expectedHours: 189,
    expectedDays: { workingDays: 22, holidays: 1 },
  };
  const inputs = (given: Partial<PayrollInputs> = {}): PayrollInputs => ({ ...EMPTY_PAYROLL_INPUTS, ...given });

  it('measures attendance on the shift’s hours, never typed (owner, 20 October 2026)', () => {
    const line = payrollLine(terms, inputs({ workedHours: 170.1 }));
    expect(line.attendanceRatio).toBe(0.9);
    expect(line.attendanceCut).toBe(0);
    expect(line.warnings).toEqual([]);
    // 150 of 189 hours: the fixed part follows it
    expect(payrollLine(terms, inputs({ workedHours: 151.2 })).attendanceRatio).toBe(0.8);
  });

  it('measures it on the hours HR typed on a line saved with them before 20 October 2026, as it was worked out', () => {
    expect(payrollLine(terms, inputs({ workedHours: 180, expectedHours: 200 })).attendanceRatio).toBe(0.9);
  });

  it('takes the no-show and leave days’ hours out of the shift’s hours, not out of typed ones (17 October 2026)', () => {
    // 2 no-show days of 9 hours out of 189: 171 hours expected
    const line = payrollLine(terms, inputs({ workedHours: 153.9, noShowDays: 2 }));
    expect(line).toMatchObject({ absentHours: 18, expectedHours: 171, attendanceRatio: 0.9, noShowCut: 1_600 });
    // and a day of leave: 162 expected; 145:48 worked is 90%
    expect(payrollLine(terms, inputs({ workedHours: 145.8, noShowDays: 2, leaveDays: 1 }))).toMatchObject({ absentHours: 18, leaveHours: 9, expectedHours: 162, attendanceRatio: 0.9 });
    // HR's 171 typed before 20 October 2026, already without them: 153:54 is 90% of it
    expect(payrollLine(terms, inputs({ workedHours: 153.9, expectedHours: 171, noShowDays: 2 }))).toMatchObject({ absentHours: 0, expectedHours: 171, attendanceRatio: 0.9 });
  });

  it('doesn’t warn about the shift’s hours without worked hours: attendance just isn’t tracked yet', () => {
    const line = payrollLine(terms, inputs());
    expect(line).toMatchObject({ attendanceRatio: null, attendanceCut: 0, earned: 12_000 });
    expect(line.warnings).toEqual([]);
    // expected hours HR typed before 20 October 2026, without worked hours, still say so
    expect(payrollLine(terms, inputs({ expectedHours: 200 })).warnings).toEqual(["Expected hours are given without the worked hours: attendance isn't counted"]);
  });

  it('is as before for a line worked out without the shift’s hours', () => {
    const { expectedHours: _hours, expectedDays: _days, ...before } = terms;
    expect(payrollLine(before, inputs({ workedHours: 180 })).warnings).toEqual(["Worked hours are given without the expected hours: attendance isn't counted"]);
  });

  it('has none without a shift, and says how to get them (owner, 20 October 2026: never typed)', () => {
    const noShift = payrollLine({ ...terms, hoursPerDay: null, expectedHours: null, expectedDays: null }, inputs({ workedHours: 180 }));
    expect(noShift).toMatchObject({ expectedHours: null, attendanceRatio: null, attendanceCut: 0, earned: 12_000 });
    expect(noShift.warnings).toEqual([NO_SHIFT_NO_EXPECTED_HOURS]);
  });
});

describe('working days: at most the shift’s hours to work a day counted (owner, 16 October 2026)', () => {
  // "maximum working hours to be recorded per day is 9 hours between checkin and check out": the flexible MORNING shift
  // (9:00 AM to 7:00 PM, 9 hours to work), 22 working days less a holiday
  const terms: PayrollTerms = {
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
    expectedHours: 189,
    expectedDays: { workingDays: 22, holidays: 1 },
  };
  const inputs = (given: Partial<PayrollInputs> = {}): PayrollInputs => ({ ...EMPTY_PAYROLL_INPUTS, ...given });
  const WARNING = "Worked hours are more than 9:00 a day on the shift's working days (189:00 this month): attendance will count at most 9:00 a day";

  it('are the working days less the holidays and the no-show and leave days, × the hours a day; none without the shift’s', () => {
    expect(mostCountedHours({ workingDays: 22, holidays: 1 }, 9, null)).toBe(189);
    expect(mostCountedHours({ workingDays: 22, holidays: 1 }, 9, 2)).toBe(171);
    // 22 − 1 − 1 − 2 = 18 days of 9 hours
    expect(mostCountedHours({ workingDays: 22, holidays: 1 }, 9, 1, 2)).toBe(162);
    expect(mostCountedHours({ workingDays: 22, holidays: 1 }, 9, 0.5)).toBe(184.5);
    expect(mostCountedHours({ workingDays: 2, holidays: 0 }, 9, 5)).toBe(0);
    expect([mostCountedHours(null, 9, null), mostCountedHours(undefined, 9, null), mostCountedHours({ workingDays: 22, holidays: 0 }, null, null)]).toEqual([null, null, null]);
  });

  it('warn when the worked hours typed are more, without cutting them', () => {
    const line = payrollLine(terms, inputs({ workedHours: 200 }));
    expect(line.warnings).toEqual([WARNING]);
    // the total typed still counts as typed
    expect(line.attendanceRatio).toBe(Math.round((200 / 189) * 1e10) / 1e10);
    // up to the most: no warning
    expect(payrollLine(terms, inputs({ workedHours: 189 })).warnings).toEqual([]);
    // the no-show days' hours aren't countable: 2 days off leave 171 hours
    expect(payrollLine(terms, inputs({ workedHours: 172, noShowDays: 2 })).warnings).toEqual([
      "Worked hours are more than 9:00 a day on the shift's working days (171:00 this month): attendance will count at most 9:00 a day",
    ]);
    // nor the leave days': 1 more leaves 162
    expect(payrollLine(terms, inputs({ workedHours: 163, noShowDays: 2, leaveDays: 1 })).warnings).toEqual([
      "Worked hours are more than 9:00 a day on the shift's working days (162:00 this month): attendance will count at most 9:00 a day",
    ]);
    // nor do expected hours HR typed before 20 October 2026 change what attendance can count
    expect(payrollLine(terms, inputs({ workedHours: 200, expectedHours: 220 })).warnings).toEqual([WARNING]);
  });

  it('don’t warn without a shift, by the hour, or on a line worked out before then', () => {
    // without a shift there is nothing to count at most: only that there are no expected hours (20 October 2026)
    expect(payrollLine({ ...terms, hoursPerDay: null, expectedHours: null, expectedDays: null }, inputs({ workedHours: 400 })).warnings).toEqual([NO_SHIFT_NO_EXPECTED_HOURS]);
    // a line saved with HR's figure before then: none
    expect(payrollLine({ ...terms, hoursPerDay: null, expectedHours: null, expectedDays: null }, inputs({ workedHours: 400, expectedHours: 189 })).warnings).toEqual([]);
    const hourly = payrollLine({ ...terms, payBasis: 'hourly', hourlyRate: 100, expectedHours: null, expectedDays: null }, inputs({ workedHours: 400 }));
    expect(hourly.warnings).toEqual([]);
    const { expectedHours: _hours, expectedDays: _days, ...before } = terms;
    expect(payrollLine(before, inputs({ workedHours: 400, expectedHours: 189 })).warnings).toEqual([]);
  });
});
