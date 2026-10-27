import {
  COMPENSATORY_RULE_DEFAULTS,
  compensationEarned,
  compensationEarnedText,
  compensationText,
  compensatoryCashDays,
  compensatoryForOdCheck,
  compensatoryRulesProblems,
  compensatoryWindowProblem,
  hoursWorkedProblems,
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

// The Compensatory Setup (owner, 27 October 2026: "i need a setup dashboard for the compensatory leaves", "minimum working
// hours"; "Hours off for hours worked"; "up to 4 hours to be compensated by hours - minimum 6 hours can be compensated by a
// day"; "Capped at 4 hours").
describe('the Compensatory Setup', () => {
  const rules = COMPENSATORY_RULE_DEFAULTS;

  it('starts with the owner’s numbers: 1.5 days’ pay, 2 hours to qualify, 4 hours off at most, a whole day from 6, the same month', () => {
    expect(rules).toEqual({ cashRate: 1.5, minHours: 2, hoursCap: 4, fullDayHours: 6, offWithinDays: null });
    expect(compensatoryRulesProblems(rules)).toEqual([]);
  });

  it('refuses hours that don’t fit together, and a window outside 1 to 60 days', () => {
    expect(compensatoryRulesProblems({ ...rules, minHours: 5 })).toEqual(['The most hours off can’t be fewer than the minimum hours to qualify.']);
    expect(compensatoryRulesProblems({ ...rules, fullDayHours: 3 })).toEqual(['The hours for a whole day can’t be fewer than the most hours off.']);
    expect(compensatoryRulesProblems({ ...rules, minHours: 0.3 })).toEqual(['Enter the minimum hours to qualify in whole or half hours from 0.5 to 24, e.g. 2.']);
    expect(compensatoryRulesProblems({ ...rules, offWithinDays: 0 })).toEqual(['Enter the days after the day worked as a whole number from 1 to 60, or choose the same month.']);
    expect(compensatoryRulesProblems({ ...rules, offWithinDays: 14 })).toEqual([]);
  });

  it('what the hours worked earn: below 2 nothing, up to 4 those hours, 4 to 6 capped at 4, from 6 a whole day', () => {
    expect(compensationEarned(null)).toEqual({ kind: 'day' });
    expect(compensationEarned(1.5)).toEqual({ kind: 'none', hours: 1.5 });
    expect(compensationEarned(2)).toEqual({ kind: 'hours', hours: 2 });
    expect(compensationEarned(3.5)).toEqual({ kind: 'hours', hours: 3.5 });
    expect(compensationEarned(5)).toEqual({ kind: 'hours', hours: 4 });
    expect(compensationEarned(6)).toEqual({ kind: 'day' });
    expect(compensationEarned(8)).toEqual({ kind: 'day' });
    expect([compensationEarnedText({ kind: 'day' }), compensationEarnedText({ kind: 'hours', hours: 4 }), compensationEarnedText({ kind: 'none', hours: 1 })]).toEqual([
      'a whole day off',
      '4 hours off',
      'nothing: fewer than 2 hours worked',
    ]);
    expect(hoursWorkedProblems(1, rules, 'Ben')).toEqual(['Ben worked 1 hour: fewer than the 2 hours that earn a compensation (Compensatory Setup).']);
    expect(hoursWorkedProblems(null)).toEqual([]);
    expect(hoursWorkedProblems(30)).toEqual(['Enter the hours worked, e.g. 4 or 3.5.']);
  });

  it('cash instead: a whole day the rate, hours their share of the shift’s day at the rate', () => {
    expect(compensatoryCashDays({ kind: 'day' }, rules, 8)).toBe(1.5);
    // 4 hours of an 8-hour day at 1.5: 0.75 days' pay
    expect(compensatoryCashDays({ kind: 'hours', hours: 4 }, rules, 8)).toBe(0.75);
    expect(compensatoryCashDays({ kind: 'hours', hours: 3 }, rules, 9)).toBe(0.5);
    // without a shift, an 8-hour day
    expect(compensatoryCashDays({ kind: 'hours', hours: 2 }, rules, null)).toBe(0.38);
    expect(compensatoryCashDays({ kind: 'none', hours: 1 }, rules, 8)).toBe(0);
    expect(compensationText({ outcome: 'cash', dayOff: null, hoursOff: 4 }, 1.5)).toBe("cash instead (4 hours' pay at 1.5×)");
    expect(compensationText({ outcome: 'day_off', dayOff: '2026-11-10', hoursOff: 4 }, 1.5)).toBe('4 hours off on 10/11/2026');
    expect(compensationText({ outcome: 'day_off', dayOff: '2026-11-10' }, 1.5)).toBe('a day off on 10/11/2026');
  });

  it('when the day off is taken: the same month, or within the days after the day worked', () => {
    expect(compensatoryWindowProblem('2026-11-06', '2026-11-02')).toBeNull();
    expect(compensatoryWindowProblem('2026-11-27', '2026-12-02')).toBe(compensatorySameMonthProblem('2026-11-27', '2026-12-02'));
    expect(compensatoryWindowProblem('2026-11-27', '2026-12-02', 7)).toBeNull();
    expect(compensatoryWindowProblem('2026-11-27', '2026-11-20', 7)).toBe('The day off must be within 7 days after the day worked: from 28/11/2026 to 04/12/2026.');
    expect(compensatoryWindowProblem('2026-11-27', '2026-12-05', 7)).not.toBeNull();
    expect(compensatoryRequestProblems('2026-11-06', '2026-11-20', worked(), off(), TODAY, { offWithinDays: 7 })).toEqual([
      'The day off must be within 7 days after the day worked: from 07/11/2026 to 13/11/2026.',
    ]);
  });

  it('with an official duty: the day worked not compensated already, the day off free, a day ahead for an employee', () => {
    const asked = { outcome: 'day_off' as const, dayOff: '2026-11-16' };
    expect(compensatoryForOdCheck('2026-11-06', asked, { claimed: false }, off(), TODAY)).toEqual({ problems: [], warnings: [] });
    expect(compensatoryForOdCheck('2026-11-06', asked, { claimed: true }, off(), TODAY, 'Ben').problems).toEqual(['Ben has asked to compensate 06/11/2026 already.']);
    expect(compensatoryForOdCheck('2026-11-06', { outcome: 'day_off', dayOff: null }, { claimed: false }, null, TODAY).problems).toEqual(['Enter the day off, e.g. 2026-11-10.']);
    // an employee's day off a day ahead at the latest; HR's past one a warning
    expect(compensatoryForOdCheck('2026-11-06', { outcome: 'day_off', dayOff: '2026-11-10' }, { claimed: false }, off(), TODAY).problems).toEqual([
      '10/11/2026 has gone by: only HR records a day off that is past.',
    ]);
    expect(compensatoryForOdCheck('2026-11-06', { outcome: 'day_off', dayOff: '2026-11-10' }, { claimed: false }, off(), TODAY, 'Ben')).toEqual({
      problems: [],
      warnings: ["10/11/2026 has gone by: it is recorded without a day's notice."],
    });
    // cash instead has no day off
    expect(compensatoryForOdCheck('2026-11-06', { outcome: 'cash', dayOff: null }, { claimed: false }, null, TODAY)).toEqual({ problems: [], warnings: [] });
    // the Setup's window
    expect(compensatoryForOdCheck('2026-11-06', { outcome: 'day_off', dayOff: '2026-11-30' }, { claimed: false }, off(), TODAY, null, { offWithinDays: 7 }).problems).toEqual([
      'The day off must be within 7 days after the day worked: from 07/11/2026 to 13/11/2026.',
    ]);
  });
});

describe('hours off in the attendance (27 October 2026: "Hours off for hours worked")', () => {
  const base = { month: '2026-11', today: TODAY, workingDays: [0, 1, 2, 3, 4], holidays: [] as string[], leaveDays: [] as string[], employedFrom: '2024-01-01', employedTo: null, hoursADay: 9, daysOff: [] as string[] };
  const day = (date: string, status: SourcedDay['status'], hoursCounted = 0): SourcedDay => ({ date, status, checkIn: null, checkOut: null, place: null, zohoStatus: null, permissionHours: 0, hoursCounted, source: 'system', flags: [] });

  it('adds the hours off to the day worked, at most the shift’s hours, the rest of the day short as usual', () => {
    const days = compensatoryDays([day('2026-11-10', 'worked', 5), day('2026-11-11', 'worked', 7)], { ...base, daysWorked: ['2026-11-06'], hoursOff: [{ date: '2026-11-10', hours: 4 }, { date: '2026-11-11', hours: 4 }] });
    expect(days.find((d) => d.date === '2026-11-10')).toMatchObject({ status: 'worked', hoursCounted: 9, compensatoryHours: 4 });
    expect(days.find((d) => d.date === '2026-11-11')).toMatchObject({ hoursCounted: 9, compensatoryHours: 4 });
  });

  it('a day with no check-in is worked for the hours off alone: short hours, not a no-show', () => {
    const days = compensatoryDays([day('2026-11-10', 'absent')], { ...base, daysWorked: [], hoursOff: [{ date: '2026-11-10', hours: 4 }] });
    expect(days[0]).toMatchObject({ status: 'worked', hoursCounted: 4, compensatoryHours: 4, flags: [] });
    const options = { systemPermissionHours: 0, permissionHoursPerMonth: 4, hourly: false, hoursADay: 9 };
    expect(attendanceLineInputs(days, options)).toMatchObject({ noShowDays: 0, workedHours: 4 });
    // a day gone by with nothing kept gets a day for them
    expect(compensatoryDays([], { ...base, daysWorked: [], hoursOff: [{ date: '2026-11-10', hours: 3 }] })).toEqual([
      expect.objectContaining({ date: '2026-11-10', status: 'worked', hoursCounted: 3, source: 'system', compensatoryHours: 3 }),
    ]);
  });

  it('never on leave, a holiday, a rest day or a day to come', () => {
    const days = compensatoryDays([day('2026-11-10', 'leave')], { ...base, daysWorked: [], hoursOff: [{ date: '2026-11-10', hours: 4 }, { date: '2026-11-06', hours: 4 }, { date: '2026-11-20', hours: 4 }] });
    expect(days.map((d) => [d.date, d.status, d.hoursCounted])).toEqual([['2026-11-10', 'leave', 0]]);
  });
});
