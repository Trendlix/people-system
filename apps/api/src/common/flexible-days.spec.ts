import {
  attendanceLineInputs,
  contractDaysMismatch,
  EMPTY_PAYROLL_INPUTS,
  expectedHoursOf,
  flexibleDaysProblem,
  flexibleWeeks,
  flexNeighbourMonths,
  isFlexibleDays,
  payrollLine,
  shiftDaysAWeek,
  shiftWeekText,
  weekAskedDays,
  type AttendanceDayStatus,
  type FlexDay,
  type FlexWeekContext,
  type PayrollInputs,
  type PayrollTerms,
} from '@trendlix/shared';

// Flexible days (owner, 31 October 2026: a part-timer's "3 days a week" and an intern's "1 day a week" counted absent on
// the shift's other days; "yes please" to a shift worked on any N of its days a week, and to a warning on a contract
// whose days a week differ from the shift's): packages/shared flexible-days.ts and the payroll's days off. The week of
// 18 to 24 October 2026 runs Sunday to Saturday; every figure here is invented.

/** Any 3 of Sunday to Thursday. */
const THREE_OF_FIVE = { workingDays: [0, 1, 2, 3, 4], daysPerWeek: 3 };
const ctx = (more: Partial<FlexWeekContext> = {}): FlexWeekContext => ({ shift: THREE_OF_FIVE, holidays: [], employedFrom: '2026-01-01', employedTo: null, today: '2026-10-25', ...more });

/** The week's days, Sunday 18 to Thursday 22 October, each as given ('-': none kept). */
function week(...statuses: (AttendanceDayStatus | '-')[]): FlexDay[] {
  return statuses.flatMap((s, i) => (s === '-' ? [] : [{ date: `2026-10-${18 + i}`, status: s }]));
}
/** Each day's status after the rule, "off" for a day off it made. */
const read = (days: readonly FlexDay[]) => days.map((d) => (d.flexOff ? 'off' : d.status));

describe('a shift’s week', () => {
  it('is flexible with fewer days a week than working days, and says so', () => {
    expect(isFlexibleDays(THREE_OF_FIVE)).toBe(true);
    expect(isFlexibleDays({ workingDays: [0, 1, 2, 3, 4] })).toBe(false);
    expect(isFlexibleDays({ workingDays: [0, 1, 2, 3, 4], daysPerWeek: 5 })).toBe(false);
    expect(shiftDaysAWeek(THREE_OF_FIVE)).toBe(3);
    expect(shiftDaysAWeek({ workingDays: [0, 2, 4] })).toBe(3);
    expect(shiftWeekText(THREE_OF_FIVE)).toBe('Any 3 of Sun, Mon, Tue, Wed, Thu');
    expect(shiftWeekText({ workingDays: [4, 0, 2] })).toBe('Sun, Tue, Thu');
  });

  it('takes days a week from 1 to one fewer than the working days, or none', () => {
    expect(flexibleDaysProblem(null, [0, 1, 2, 3, 4])).toBeNull();
    expect(flexibleDaysProblem(4, [0, 1, 2, 3, 4])).toBeNull();
    expect(flexibleDaysProblem(5, [0, 1, 2, 3, 4])).toMatch(/from 1 to 4/);
    expect(flexibleDaysProblem(0, [0, 1, 2, 3, 4])).toMatch(/from 1 to 4/);
    expect(flexibleDaysProblem(1, [2])).toMatch(/two working days or more/);
  });

  it('asks its days in proportion to the days a week has', () => {
    expect(weekAskedDays(3, 5, 5)).toBe(3);
    // a holiday on one: round(2.4)
    expect(weekAskedDays(3, 5, 4)).toBe(2);
    // a first week from a Wednesday: round(1.2)
    expect(weekAskedDays(3, 5, 2)).toBe(1);
    expect(weekAskedDays(2, 5, 1)).toBe(0);
    expect(weekAskedDays(3, 5, 0)).toBe(0);
  });
});

describe('a contract’s days a week against its shift', () => {
  const morning = { code: 'MORNING', workingDays: [0, 1, 2, 3, 4] };

  it('warns when they differ, saying what to do', () => {
    expect(contractDaysMismatch(3, morning)).toBe(
      "The contract says 3 days a week; shift MORNING asks 5 days (Sun, Mon, Tue, Wed, Thu). Attendance and payroll follow the shift: change the shift, or the contract's days a week.",
    );
    expect(contractDaysMismatch(1, { code: 'PT', ...THREE_OF_FIVE })).toMatch(/^The contract says 1 day a week; shift PT asks 3 days \(Any 3 of Sun/);
  });

  it('is quiet when they agree, when the contract leaves it to the shift, or without a shift', () => {
    expect(contractDaysMismatch(5, morning)).toBeNull();
    expect(contractDaysMismatch(3, { code: 'PT', ...THREE_OF_FIVE })).toBeNull();
    expect(contractDaysMismatch(null, morning)).toBeNull();
    expect(contractDaysMismatch(3, null)).toBeNull();
  });
});

describe('a week of a flexible days shift', () => {
  it('worked its 3 days: the other two are days off, none absent', () => {
    expect(read(flexibleWeeks(week('worked', 'absent', 'worked', 'absent', 'worked'), ctx()))).toEqual(['worked', 'off', 'worked', 'off', 'worked']);
  });

  it('worked 1 of 3: two absent, the latest, the rest days off', () => {
    expect(read(flexibleWeeks(week('worked', 'absent', 'absent', 'absent', 'absent'), ctx()))).toEqual(['worked', 'off', 'off', 'absent', 'absent']);
  });

  it('counts leave and a day kept as present towards its days', () => {
    expect(read(flexibleWeeks(week('leave', 'worked', 'no_check_in', 'absent', 'absent'), ctx()))).toEqual(['leave', 'worked', 'no_check_in', 'off', 'off']);
  });

  it('mid-week, a day is absent only once the days left can’t make the week', () => {
    // Wednesday: Sunday worked, Wednesday and Thursday still to come
    expect(read(flexibleWeeks(week('worked', 'absent', 'absent'), ctx({ today: '2026-10-21' })))).toEqual(['worked', 'off', 'off']);
    // Thursday: only Thursday left of the 2 still needed, so Wednesday is absent
    expect(read(flexibleWeeks(week('worked', 'absent', 'absent', 'absent'), ctx({ today: '2026-10-22' })))).toEqual(['worked', 'off', 'off', 'absent']);
  });

  it('asks fewer days in a week with a holiday, and of the days employed', () => {
    // Monday a holiday: 2 of the 4 days left; Sunday worked, so Thursday alone absent
    const holiday = ctx({ holidays: ['2026-10-19'] });
    expect(read(flexibleWeeks(week('worked', 'holiday', 'absent', 'absent', 'absent'), holiday))).toEqual(['worked', 'holiday', 'off', 'off', 'absent']);
    // joined on Wednesday: 1 of the 2 days employed
    expect(read(flexibleWeeks(week('-', '-', '-', 'absent', 'absent'), ctx({ employedFrom: '2026-10-21' })))).toEqual(['off', 'absent']);
  });

  it('takes a day gone by with nothing kept, before the first check-in, as worked', () => {
    expect(read(flexibleWeeks(week('-', '-', 'absent', 'absent', 'absent'), ctx()))).toEqual(['off', 'off', 'absent']);
  });

  it('reads a week across two months with the month next to it', () => {
    // Sunday 27 September to Saturday 3 October: September's Sunday worked and Monday to Wednesday absent, October's Thursday absent
    const october: FlexDay[] = [{ date: '2026-10-01', status: 'absent' }];
    const september: FlexDay[] = [
      { date: '2026-09-27', status: 'worked' },
      { date: '2026-09-28', status: 'absent' },
      { date: '2026-09-29', status: 'absent' },
      { date: '2026-09-30', status: 'absent' },
    ];
    // short 2: the latest two, 30 September and 1 October, stay absent
    expect(read(flexibleWeeks(october, ctx(), september))).toEqual(['absent']);
    // without September's days they are taken as worked: October's Thursday is a day off
    expect(read(flexibleWeeks(october, ctx()))).toEqual(['off']);
    // October 2026 starts on a Thursday and ends on a Saturday
    expect(flexNeighbourMonths('2026-10')).toEqual({ before: '2026-09', after: null });
    // November 2026 starts on a Sunday and ends on a Monday
    expect(flexNeighbourMonths('2026-11')).toEqual({ before: null, after: '2026-12' });
  });

  it('leaves a shift that isn’t flexible as it is', () => {
    const days = week('worked', 'absent', 'absent', 'absent', 'absent');
    expect(flexibleWeeks(days, ctx({ shift: { workingDays: [0, 1, 2, 3, 4] } }))).toEqual(days);
  });
});

describe('a flexible days shift on payroll', () => {
  /** 9 hours a day, 22 working days of Sunday–Thursday in the month: 198 scheduled. */
  const terms: PayrollTerms = {
    year: 2026,
    payBasis: 'monthly',
    gross: 9_000,
    basicPercent: 80,
    hourlyRate: null,
    allowances: [],
    paidDays: 30,
    statutory: true,
    insured: true,
    insuredWage: 9_000,
    hoursPerDay: 9,
    expectedHours: 198,
    expectedDays: { workingDays: 22, holidays: 0 },
  };
  const inputs = (given: Partial<PayrollInputs>): PayrollInputs => ({ ...EMPTY_PAYROLL_INPUTS, ...given });

  it('fills the days off from the attendance days, on a monthly salary only', () => {
    const days = [
      { status: 'worked' as const, hoursCounted: 9, permissionHours: 0 },
      { status: 'rest' as const, hoursCounted: 0, permissionHours: 0, flexOff: true },
      { status: 'absent' as const, hoursCounted: 0, permissionHours: 0 },
    ];
    const opts = { systemPermissionHours: 0, permissionHoursPerMonth: 4, hourly: false };
    expect(attendanceLineInputs(days, { ...opts, flexible: true })).toEqual({ workedHours: 9, noShowDays: 1, permissionHours: null, flexDaysOff: 1 });
    expect(attendanceLineInputs(days, opts)).toEqual({ workedHours: 9, noShowDays: 1, permissionHours: null });
    expect(attendanceLineInputs(days, { ...opts, hourly: true, flexible: true })).toEqual({ workedHours: 9 });
  });

  it('takes the days off out of the expected hours, so 3 days a week worked in full are full attendance', () => {
    // 13 days worked of the 22, 9 days off: 117 expected, 117 worked, nothing cut
    expect(expectedHoursOf(terms, inputs({ flexDaysOff: 9 }))).toBe(117);
    const line = payrollLine(terms, inputs({ workedHours: 117, flexDaysOff: 9 }));
    expect(line).toMatchObject({ expectedHours: 117, attendanceRatio: 1, attendanceCut: 0, noShowCut: 0, earned: 9_000 });
    expect(line.warnings).toEqual([]);
    // without them the same month reads 59% attended and the fixed part is cut
    expect(payrollLine(terms, inputs({ workedHours: 117 })).attendanceCut).toBeGreaterThan(0);
  });

  it('still charges an absent day as a no-show, with the days off beside it', () => {
    // 12 worked, 1 absent, 9 off: 108 expected for the 12 days, the no-show day cut on its own
    const line = payrollLine(terms, inputs({ workedHours: 108, noShowDays: 1, flexDaysOff: 9 }));
    expect(line).toMatchObject({ expectedHours: 108, attendanceRatio: 1, attendanceCut: 0, noShowCut: 600 });
  });
});
