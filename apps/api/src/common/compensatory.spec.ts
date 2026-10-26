import {
  attendanceDayView,
  attendanceLineInputs,
  attendanceFigures,
  COMPENSATORY_CASH_RATE_DEFAULT,
  compensatoryCashReason,
  compensatoryDays,
  compensatoryNoticeProblem,
  compensatoryOffProblems,
  compensatoryRateProblems,
  compensatoryRecordCheck,
  compensatoryRequestProblems,
  compensatorySameMonthProblem,
  compensatoryWorkedProblems,
  EMPTY_PAYROLL_INPUTS,
  historyDay,
  payrollLine,
  type CompensatoryOffDay,
  type CompensatoryWorkedDay,
  type PayrollAdjustmentItem,
  type PayrollTerms,
  type SourcedDay,
} from '@trendlix/shared';

// Compensatory days (owner, 26 October 2026: "my compensatory is a compensation with another day in the same month. and
// rarely to be compensated in cash"; then "if paid in cash make it 1.5" and "if the day is compensated with a day, we pay
// nothing"): packages/shared compensatory.ts. 2026-11-01 is a Sunday; a Sunday to Thursday shift rests on Friday (11-06)
// and Saturday (11-07).

const TODAY = '2026-11-12';
const WORKED_REST: CompensatoryWorkedDay = { workingDay: false, holiday: null, claimed: false, checkedIn: true };
const OFF_OK: CompensatoryOffDay = { workingDay: true, holiday: null, leave: null, other: null };
const worked = (over: Partial<CompensatoryWorkedDay> = {}): CompensatoryWorkedDay => ({ ...WORKED_REST, ...over });
const off = (over: Partial<CompensatoryOffDay> = {}): CompensatoryOffDay => ({ ...OFF_OK, ...over });

describe('the same-month rule', () => {
  it('is met by two days of one calendar month, before or after the day worked', () => {
    expect(compensatorySameMonthProblem('2026-11-06', '2026-11-10')).toBeNull();
    expect(compensatorySameMonthProblem('2026-11-20', '2026-11-02')).toBeNull();
  });

  it('refuses a day off in another month, naming both', () => {
    expect(compensatorySameMonthProblem('2026-10-30', '2026-11-02')).toBe('The day off must be in the same month as the day worked: 30/10/2026 is in October 2026, 02/11/2026 in November 2026.');
  });
});

describe('the day worked', () => {
  it('is a rest day of the shift', () => {
    expect(compensatoryWorkedProblems('2026-11-06', worked())).toEqual([]);
  });

  it('or an official holiday, even on a working weekday', () => {
    expect(compensatoryWorkedProblems('2026-11-10', worked({ workingDay: true, holiday: 'Test Day' }))).toEqual([]);
  });

  it('is never a plain working day', () => {
    expect(compensatoryWorkedProblems('2026-11-04', worked({ workingDay: true }))).toEqual([
      '04/11/2026 is a working day of your shift, not a rest day or an official holiday: there is nothing to compensate.',
    ]);
    expect(compensatoryWorkedProblems('2026-11-04', worked({ workingDay: true }), 'Mona')[0]).toContain("Mona's shift");
  });

  it('is not one already claimed', () => {
    expect(compensatoryWorkedProblems('2026-11-06', worked({ claimed: true }))).toEqual(['You have asked to compensate 06/11/2026 already.']);
  });
});

describe('the day off', () => {
  it('is a working day of the shift', () => {
    expect(compensatoryOffProblems('2026-11-10', off())).toEqual([]);
  });

  it('is not a rest day, an official holiday, leave, work from home, official duty or another compensatory day', () => {
    expect(compensatoryOffProblems('2026-11-13', off({ workingDay: false }))).toEqual(['13/11/2026 is a rest day of your shift: the day off must be a working day.']);
    expect(compensatoryOffProblems('2026-11-10', off({ holiday: 'Test Day' }))).toEqual(['10/11/2026 is an official holiday (Test Day): the day off must be a working day.']);
    expect(compensatoryOffProblems('2026-11-10', off({ leave: { type: 'Annual leave', status: 'approved' } }))).toEqual(['You have Annual leave on 10/11/2026 (approved): it is a day off already.']);
    expect(compensatoryOffProblems('2026-11-10', off({ other: 'a work from home day' }))).toEqual(['You have a work from home day on 10/11/2026 already.']);
    expect(compensatoryOffProblems('2026-11-10', off({ other: 'a compensatory day off' }), 'Ben')).toEqual(['Ben has a compensatory day off on 10/11/2026 already.']);
  });
});

describe('asking', () => {
  it('needs a day before the day off at the latest; a past or same-day off is only HR’s', () => {
    expect(compensatoryNoticeProblem('2026-11-13', TODAY)).toBeNull();
    expect(compensatoryNoticeProblem(TODAY, TODAY)).toBe('12/11/2026 is today: ask for a compensatory day a day before the day off at the latest.');
    expect(compensatoryNoticeProblem('2026-11-10', TODAY)).toBe('10/11/2026 has gone by: only HR records a day off that is past.');
  });

  it('is refused with every reason, the day worked first', () => {
    expect(compensatoryRequestProblems('2026-11-06', '2026-11-16', worked(), off(), TODAY)).toEqual([]);
    expect(compensatoryRequestProblems('2026-11-04', '2026-12-02', worked({ workingDay: true }), off(), TODAY)).toEqual([
      '04/11/2026 is a working day of your shift, not a rest day or an official holiday: there is nothing to compensate.',
      'The day off must be in the same month as the day worked: 04/11/2026 is in November 2026, 02/12/2026 in December 2026.',
    ]);
  });

  it('is not for a day worked still to come', () => {
    expect(compensatoryRequestProblems('2026-11-13', '2026-11-16', worked(), off(), TODAY)).toEqual(["13/11/2026 hasn't come yet: a compensatory day is asked for a day already worked."]);
  });
});

describe('HR recording one', () => {
  it('may record a past day off, with a warning', () => {
    const checked = compensatoryRecordCheck('2026-11-06', '2026-11-09', worked(), off(), TODAY, 'Ben');
    expect(checked.problems).toEqual([]);
    expect(checked.warnings).toEqual(["09/11/2026 has gone by: it is recorded without a day's notice."]);
  });

  it('warns, not refuses, a day worked with no check-in kept', () => {
    const checked = compensatoryRecordCheck('2026-11-06', '2026-11-16', worked({ checkedIn: false }), off(), TODAY, 'Ben');
    expect(checked.problems).toEqual([]);
    expect(checked.warnings).toEqual(['No check-in is kept on 06/11/2026: HR confirms the day was worked when deciding.']);
  });

  it('records a cash one without a day off', () => {
    expect(compensatoryRecordCheck('2026-11-06', null, worked(), null, TODAY, 'Ben')).toEqual({ problems: [], warnings: [] });
  });

  it('still refuses the days themselves', () => {
    expect(compensatoryRecordCheck('2026-11-04', '2026-11-16', worked({ workingDay: true }), off(), TODAY, 'Ben').problems).toEqual([
      "04/11/2026 is a working day of Ben's shift, not a rest day or an official holiday: there is nothing to compensate.",
    ]);
  });
});

describe('the cash rate', () => {
  it('is 1.5 days’ pay, for a rest day and a holiday alike', () => {
    expect(COMPENSATORY_CASH_RATE_DEFAULT).toBe(1.5);
    expect(compensatoryRateProblems(1.5)).toEqual([]);
    expect(compensatoryRateProblems(2)).toEqual([]);
  });

  it('is in half days from 0.5 to 5', () => {
    for (const bad of [0, 0.4, 1.25, 5.5, Number.NaN, '1.5']) expect(compensatoryRateProblems(bad)).toEqual(["Enter the days' pay for cash instead in whole or half days from 0.5 to 5, e.g. 1.5."]);
  });

  it('is paid as the payroll’s Bonus (days): 1.5 days of the fixed gross, a day being the gross ÷ the day divisor', () => {
    const terms: PayrollTerms = { year: 2026, payBasis: 'monthly', gross: 12_000, basicPercent: 80, hourlyRate: null, allowances: [], paidDays: 30, statutory: true, insured: true, insuredWage: 12_000, hoursPerDay: 9 };
    const item = (days: number): PayrollAdjustmentItem => ({ id: `cash-${days}`, kind: 'addition', type: 'bonus_days', taxed: true, amount: null, days, reason: compensatoryCashReason('2026-11-06') });
    const without = payrollLine(terms, EMPTY_PAYROLL_INPUTS);
    const with15 = payrollLine({ ...terms, adjustments: [item(1.5)] }, EMPTY_PAYROLL_INPUTS);
    const with1 = payrollLine({ ...terms, adjustments: [item(1)] }, EMPTY_PAYROLL_INPUTS);
    const paid15 = with15.adjustments!.find((a) => a.id === 'cash-1.5')!.amount;
    const paid1 = with1.adjustments!.find((a) => a.id === 'cash-1')!.amount;
    expect(paid1).toBeGreaterThan(0);
    // 1.5 days is one and a half of one day's pay (to the piaster)
    expect(paid15).toBeCloseTo(paid1 * 1.5, 1);
    expect(with15.net).toBeGreaterThan(without.net);
    expect(compensatoryCashReason('2026-11-06')).toBe('Compensation for working 06/11/2026');
  });
});

describe('the attendance', () => {
  const ctx = (over = {}) => ({
    month: '2026-11',
    today: TODAY,
    workingDays: [0, 1, 2, 3, 4],
    holidays: [] as string[],
    leaveDays: [] as string[],
    employedFrom: '2024-01-01',
    employedTo: null,
    hoursADay: 9,
    daysOff: ['2026-11-10'],
    daysWorked: ['2026-11-06'],
    ...over,
  });
  const day = (date: string, status: SourcedDay['status'], hoursCounted = 0): SourcedDay => ({ date, status, checkIn: null, checkOut: null, place: null, zohoStatus: null, permissionHours: 0, hoursCounted, source: 'system', flags: [] });
  const month = (): SourcedDay[] => [day('2026-11-04', 'worked', 9), day('2026-11-06', 'worked', 9), day('2026-11-10', 'absent'), day('2026-11-11', 'worked', 9)];

  it('reads the day off as a full paid day: worked for the shift’s hours, never absent or short', () => {
    const days = compensatoryDays(month(), ctx());
    const off = days.find((d) => d.date === '2026-11-10')!;
    expect(off).toMatchObject({ status: 'worked', hoursCounted: 9, exempt: true, compensatory: true, flags: [] });
    const view = attendanceDayView(off, 9);
    expect(view).toMatchObject({ shortHours: 0, extraHours: 0, missingCheckOut: false, missingCheckIn: false, compensatory: true });
    expect(attendanceFigures(days.map((d) => attendanceDayView(d, 9)))).toMatchObject({ absentDays: 0, shortHours: 0, compensatoryDays: 1, exemptDays: 0 });
  });

  it('is said Compensatory day off in the history, on time', () => {
    const off = compensatoryDays(month(), ctx()).find((d) => d.date === '2026-11-10')!;
    const log = historyDay({ ...attendanceDayView(off, 9), source: 'system', wfh: false, shift: null, scheduled: true });
    expect(log).toMatchObject({ mode: 'compensatory', onTime: true, lateMinutes: 0, attended: true });
  });

  it('keeps the day worked’s check-ins but leaves its hours out of the month', () => {
    const days = compensatoryDays(month(), ctx());
    expect(days.find((d) => d.date === '2026-11-06')).toMatchObject({ status: 'worked', hoursCounted: 9, compensated: true });
    expect(days.find((d) => d.date === '2026-11-04')).not.toHaveProperty('compensated');
  });

  it('adds nothing to the payroll: the same hours and no-show days as the day off simply worked, and no money', () => {
    const control = [day('2026-11-04', 'worked', 9), day('2026-11-10', 'worked', 9), day('2026-11-11', 'worked', 9)];
    const options = { systemPermissionHours: 0, permissionHoursPerMonth: 4, hourly: false, hoursADay: 9 };
    const withComp = attendanceLineInputs(compensatoryDays(month(), ctx()), options);
    expect(withComp).toEqual(attendanceLineInputs(control, options));
    expect(withComp).toMatchObject({ workedHours: 27, noShowDays: 0 });
    // paid by the hour: the day off is a paid day, the day worked adds no hours
    expect(attendanceLineInputs(compensatoryDays(month(), ctx()), { ...options, hourly: true })).toEqual({ workedHours: 27 });
    // the day off left absent (no compensatory day) is a no-show, as before
    expect(attendanceLineInputs(month(), options)).toMatchObject({ noShowDays: 1, workedHours: 27 });
  });

  it('never makes a leave day, a holiday or a rest day a day off, nor a future one', () => {
    const base = [day('2026-11-10', 'leave'), day('2026-11-06', 'rest'), day('2026-11-11', 'holiday')];
    const days = compensatoryDays(base, ctx({ daysOff: ['2026-11-10', '2026-11-06', '2026-11-11', '2026-11-20'], daysWorked: [] }));
    expect(days.map((d) => [d.date, d.status])).toEqual([['2026-11-06', 'rest'], ['2026-11-10', 'leave'], ['2026-11-11', 'holiday']]);
  });

  it('adds a day off with no day kept at all (source system)', () => {
    const days = compensatoryDays([], ctx({ daysWorked: [] }));
    expect(days).toEqual([expect.objectContaining({ date: '2026-11-10', status: 'worked', hoursCounted: 9, source: 'system', compensatory: true, exempt: true })]);
  });

  it('leaves the days as they are with none', () => {
    const base = month();
    expect(compensatoryDays(base, ctx({ daysOff: [], daysWorked: [] }))).toEqual(base);
  });
});
