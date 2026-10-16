import { EMPTY_PAYROLL_INPUTS, expectedHoursOf, mostCountedHours, payrollLine, shiftDaysIn, shiftExpectedHours, type PayrollInputs, type PayrollTerms } from '@trendlix/shared';

// The expected hours a run works out from each monthly-paid person's shift (owner's request, 16 October 2026, Payroll
// Setup): the shift's working days within the days employed in the month, less the official holidays on them, × its
// hours a day; what HR types on the run is used instead. packages/shared payroll.ts. Invented figures and holidays.

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

  it('are HR’s when typed, else the shift’s, else none', () => {
    expect(expectedHoursOf({ expectedHours: 189 }, { expectedHours: 200 })).toBe(200);
    expect(expectedHoursOf({ expectedHours: 189 }, { expectedHours: null })).toBe(189);
    // HR typing 0 is a figure too
    expect(expectedHoursOf({ expectedHours: 189 }, { expectedHours: 0 })).toBe(0);
    expect(expectedHoursOf({ expectedHours: null }, { expectedHours: null })).toBeNull();
    // terms worked out before 16 October 2026 have none
    expect(expectedHoursOf({}, { expectedHours: null })).toBeNull();
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

  it('measures attendance on the shift’s hours when HR typed none', () => {
    const line = payrollLine(terms, inputs({ workedHours: 170.1 }));
    expect(line.attendanceRatio).toBe(0.9);
    expect(line.attendanceCut).toBe(0);
    expect(line.warnings).toEqual([]);
    // 150 of 189 hours: the fixed part follows it
    expect(payrollLine(terms, inputs({ workedHours: 151.2 })).attendanceRatio).toBe(0.8);
  });

  it('measures it on the hours HR typed, which are never replaced', () => {
    expect(payrollLine(terms, inputs({ workedHours: 180, expectedHours: 200 })).attendanceRatio).toBe(0.9);
  });

  it('takes the no-show days’ hours out of the shift’s hours, as out of typed ones', () => {
    // 2 days of 9 hours out of 189: 171 hours expected
    const line = payrollLine(terms, inputs({ workedHours: 153.9, noShowDays: 2 }));
    expect(line).toMatchObject({ absentHours: 18, attendanceRatio: 0.9, noShowCut: 1_600 });
  });

  it('doesn’t warn about the shift’s hours without worked hours: attendance just isn’t tracked yet', () => {
    const line = payrollLine(terms, inputs());
    expect(line).toMatchObject({ attendanceRatio: null, attendanceCut: 0, earned: 12_000 });
    expect(line.warnings).toEqual([]);
    // typed expected hours without worked hours still say so
    expect(payrollLine(terms, inputs({ expectedHours: 200 })).warnings).toEqual(["Expected hours are given without the worked hours: attendance isn't counted"]);
  });

  it('is as before for a line worked out without the shift’s hours', () => {
    const { expectedHours: _hours, expectedDays: _days, ...before } = terms;
    expect(payrollLine(before, inputs({ workedHours: 180 })).warnings).toEqual(["Worked hours are given without the expected hours: attendance isn't counted"]);
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

  it('are the working days less the holidays and the no-show days, × the hours a day; none without the shift’s', () => {
    expect(mostCountedHours({ workingDays: 22, holidays: 1 }, 9, null)).toBe(189);
    expect(mostCountedHours({ workingDays: 22, holidays: 1 }, 9, 2)).toBe(171);
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
    // the expected hours HR typed don't change what attendance can count
    expect(payrollLine(terms, inputs({ workedHours: 200, expectedHours: 220 })).warnings).toEqual([WARNING]);
  });

  it('don’t warn without a shift, by the hour, or on a line worked out before then', () => {
    expect(payrollLine({ ...terms, hoursPerDay: null, expectedHours: null, expectedDays: null }, inputs({ workedHours: 400, expectedHours: 189 })).warnings).toEqual([]);
    const hourly = payrollLine({ ...terms, payBasis: 'hourly', hourlyRate: 100, expectedHours: null, expectedDays: null }, inputs({ workedHours: 400 }));
    expect(hourly.warnings).toEqual([]);
    const { expectedHours: _hours, expectedDays: _days, ...before } = terms;
    expect(payrollLine(before, inputs({ workedHours: 400, expectedHours: 189 })).warnings).toEqual([]);
  });
});
