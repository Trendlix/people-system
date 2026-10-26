import {
  annualAvailable,
  annualEntitlement,
  annualMinimumFlags,
  annualUnused,
  carriedAfterClosing,
  employeeMayCancelLeave,
  firstLeaveStatus,
  isLeaveDays,
  LAW_LEAVE_TYPES,
  LEAVE_KINDS,
  LEAVE_RULE_DEFAULTS,
  LEAVE_STATUSES,
  LEAVE_STEP_KINDS,
  leaveDaysBetween,
  leaveDayRate,
  leaveDecisionNeedsComment,
  leaveDecisionStepKind,
  leavePayAmount,
  leavePayoutMonth,
  leaveRequestProblems,
  leaveStage,
  leaveStatusAfterApproval,
  leaveTypeLeft,
  leaveTypeRulesText,
  monthLeaveDays,
  overBalanceDays,
  overBalanceStepText,
  overBalanceWarning,
  rulesForYear,
  settleByAge,
  unusedByYear,
  yearClosingProblems,
  yearlyDaysFor,
  type AnnualEntitlementInput,
  type LeaveHistory,
  type LeaveRequestInput,
  type LeaveTypeRules,
} from '@trendlix/shared';

// The leave rules (owner, 18 October 2026: "can you apply the leaves according to the law?", and on unused leave:
// "make it with decision with the year closing"): packages/shared leaves.ts, after Labour Law 14/2025 Arts. 54–57 and
// 124–133.

const BASE: AnnualEntitlementInput = {
  year: 2026,
  joinDate: '2020-01-01',
  endDate: null,
  dateOfBirth: '1995-05-05',
  priorServiceMonths: null,
  disability: false,
  hazardousWork: false,
  rules: LEAVE_RULE_DEFAULTS,
};
const law = (key: string): LeaveTypeRules => {
  const t = LAW_LEAVE_TYPES.find((x) => x.key === key);
  if (!t) throw new Error(key);
  return t;
};

describe('the law’s leave types and the lists', () => {
  it('seeds every leave type of the law, childcare off (a company of 50 or more)', () => {
    expect(LAW_LEAVE_TYPES.map((t) => t.key)).toEqual(['annual', 'casual', 'sick', 'birth', 'exam', 'maternity', 'hajj', 'childcare', 'unpaid']);
    expect(LAW_LEAVE_TYPES.filter((t) => !t.active).map((t) => t.key)).toEqual(['childcare']);
    expect(LEAVE_KINDS).toContain('custom');
    expect(LEAVE_STATUSES).toEqual(['with_manager', 'with_hr', 'approved', 'rejected', 'cancelled']);
    expect(LEAVE_STEP_KINDS).toEqual(['submitted', 'no_manager', 'recorded_by_hr', 'manager_decision', 'hr_decision', 'cancelled']);
  });

  it('has the law’s numbers: casual 7 a year and 2 at a time from the annual balance (Art. 128), Hajj once after 5 years (Art. 130)', () => {
    expect(law('casual')).toMatchObject({ balance: 'from_annual', daysPerYear: 7, maxPerRequest: 2, paid: 'paid' });
    expect(law('birth')).toMatchObject({ balance: 'per_request', maxPerRequest: 1, maxTimesInService: 3, gender: 'male' });
    expect(law('exam')).toMatchObject({ balance: 'none', noticeDays: 10, documentRequired: true });
    expect(law('hajj')).toMatchObject({ maxPerRequest: 30, calendarDays: true, maxTimesInService: 1, minServiceMonths: 60 });
    expect(law('sick')).toMatchObject({ paid: 'partly', payPercent: 100, documentRequired: true, balance: 'none' });
    expect(law('maternity')).toMatchObject({ maxPerRequest: 120, calendarDays: true, maxTimesInService: 3, gender: 'female', documentRequired: true });
    expect(law('childcare')).toMatchObject({ paid: 'unpaid', maxPerRequest: 730, minServiceMonths: 12, maxTimesInService: 3, gender: 'female' });
    expect(law('unpaid')).toMatchObject({ paid: 'unpaid', balance: 'none' });
  });

  it('says a type’s rules in words', () => {
    expect(leaveTypeRulesText(law('casual'))).toBe('Paid · Working days · From the annual balance · At most 7 days a year · At most 2 days at a time · Half days allowed');
    expect(leaveTypeRulesText(law('hajj'))).toBe('Paid · Calendar days · At most 30 days at a time · Once in service · After 5 years of service');
    expect(leaveTypeRulesText({ ...law('sick'), payPercent: 75 })).toBe('Paid at 75% · Working days · No balance · Document needed');
    expect(leaveTypeRulesText(law('exam'))).toBe("Paid · Working days · No balance · 10 days' notice · Document needed");
  });
});

describe('annualEntitlement (Art. 124)', () => {
  it('a first year is pro-rata, month by month, by the days of the month joined in, and usable six months after joining', () => {
    const e = annualEntitlement({ ...BASE, joinDate: '2026-03-15' });
    // March: 17 of 31 days at 15 a year, April to December at 15 a year: 11.94, to the nearest half day
    expect(e.days).toBe(12);
    expect(e.usableFrom).toBe('2026-09-15');
    expect(e.tierByMonth).toEqual([0, 0, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15]);
  });

  it('a whole first year is 15, usable from 1 July', () => {
    expect(annualEntitlement({ ...BASE, joinDate: '2026-01-01' })).toMatchObject({ days: 15, usableFrom: '2026-07-01' });
  });

  it('the year a year of service is completed earns 15 a year until then and 21 after', () => {
    const e = annualEntitlement({ ...BASE, year: 2027, joinDate: '2026-03-15' });
    expect(e.tierByMonth).toEqual([15, 15, 21, 21, 21, 21, 21, 21, 21, 21, 21, 21]);
    expect(e.days).toBe(20);
    expect(e.usableFrom).toBe('2027-01-01');
  });

  it('a joiner late in the year may use it only in the next year, six months after joining', () => {
    expect(annualEntitlement({ ...BASE, joinDate: '2026-10-01' })).toMatchObject({ days: 4, usableFrom: '2027-04-01' });
    expect(annualEntitlement({ ...BASE, year: 2027, joinDate: '2026-10-01' }).usableFrom).toBe('2027-04-01');
  });

  it('is 21 from the second year', () => {
    expect(annualEntitlement(BASE)).toMatchObject({ days: 21, usableFrom: '2026-01-01' });
  });

  it('is 30 once 10 full years of service with one or more employers are reached, earlier employers counted', () => {
    // 90 months before, joined 2024: 120 months on 1 July 2026
    const e = annualEntitlement({ ...BASE, joinDate: '2024-01-01', priorServiceMonths: 90 });
    expect(e.tierByMonth).toEqual([21, 21, 21, 21, 21, 21, 30, 30, 30, 30, 30, 30]);
    expect(e.days).toBe(25.5);
    expect(annualEntitlement({ ...BASE, joinDate: '2016-01-01' }).days).toBe(30);
  });

  it('is 30 once over 50, from the month of the 50th birthday', () => {
    const e = annualEntitlement({ ...BASE, dateOfBirth: '1976-06-10' });
    expect(e.tierByMonth).toEqual([21, 21, 21, 21, 21, 30, 30, 30, 30, 30, 30, 30]);
    expect(e.days).toBe(26.5);
    expect(annualEntitlement({ ...BASE, dateOfBirth: '1970-01-01' }).days).toBe(30);
  });

  it('is 30 from the start for a joiner over 50 or with 10 years before: the better right applies', () => {
    expect(annualEntitlement({ ...BASE, joinDate: '2026-01-01', dateOfBirth: '1970-01-01' }).days).toBe(30);
    expect(annualEntitlement({ ...BASE, joinDate: '2026-01-01', priorServiceMonths: 120 }).days).toBe(30);
  });

  it('is 45 with a disability, also in the first year', () => {
    expect(annualEntitlement({ ...BASE, disability: true }).days).toBe(45);
    expect(annualEntitlement({ ...BASE, joinDate: '2026-01-01', disability: true }).days).toBe(45);
  });

  it('is 7 more for hazardous work, in all cases', () => {
    expect(annualEntitlement({ ...BASE, hazardousWork: true }).days).toBe(28);
    expect(annualEntitlement({ ...BASE, hazardousWork: true, disability: true }).days).toBe(52);
    expect(annualEntitlement({ ...BASE, joinDate: '2026-01-01', hazardousWork: true }).days).toBe(22);
  });

  it('a leaver earns to the last day, and nothing when they left before six months were served', () => {
    expect(annualEntitlement({ ...BASE, endDate: '2026-06-30' }).days).toBe(10.5);
    expect(annualEntitlement({ ...BASE, joinDate: '2026-01-01', endDate: '2026-05-31' }).days).toBe(0);
    expect(annualEntitlement({ ...BASE, joinDate: '2026-01-01', endDate: '2026-06-30' }).days).toBe(7.5);
  });

  it('follows the Leave Setup’s numbers', () => {
    expect(annualEntitlement({ ...BASE, rules: { ...LEAVE_RULE_DEFAULTS, standardDays: 24 } }).days).toBe(24);
    expect(annualEntitlement({ ...BASE, joinDate: '2026-01-01', rules: { ...LEAVE_RULE_DEFAULTS, firstYearMinMonths: 3 } }).usableFrom).toBe('2026-04-01');
  });

  it('is nothing for a year not employed in', () => {
    expect(annualEntitlement({ ...BASE, year: 2019 }).days).toBe(0);
    expect(annualEntitlement({ ...BASE, endDate: '2025-12-31' }).days).toBe(0);
  });
});

describe('leaveDaysBetween', () => {
  const sunToThu = { workingDays: [0, 1, 2, 3, 4], holidays: [] as string[], calendarDays: false, halfDay: false };

  it('counts the shift’s working days, rest days and official holidays not counted (Art. 124)', () => {
    // Sunday 18 to Saturday 24 October 2026
    expect(leaveDaysBetween('2026-10-18', '2026-10-24', sunToThu)).toBe(5);
    // Sunday 4 to Thursday 8 October, the 6th a holiday
    expect(leaveDaysBetween('2026-10-04', '2026-10-08', { ...sunToThu, holidays: ['2026-10-06'] })).toBe(4);
    // a Friday and a Saturday: none
    expect(leaveDaysBetween('2026-10-23', '2026-10-24', sunToThu)).toBe(0);
    // another shift's days
    expect(leaveDaysBetween('2026-10-18', '2026-10-24', { ...sunToThu, workingDays: [0, 1, 2, 3, 4, 6] })).toBe(6);
  });

  it('counts calendar days for a type counted so', () => {
    expect(leaveDaysBetween('2026-10-18', '2026-11-16', { ...sunToThu, calendarDays: true, holidays: ['2026-10-20'] })).toBe(30);
  });

  it('counts a half day as half', () => {
    expect(leaveDaysBetween('2026-10-18', '2026-10-18', { ...sunToThu, halfDay: true })).toBe(0.5);
    expect(leaveDaysBetween('2026-10-23', '2026-10-23', { ...sunToThu, halfDay: true })).toBe(0);
  });

  it('is 0 for dates the wrong way round or not dates', () => {
    expect(leaveDaysBetween('2026-10-20', '2026-10-18', sunToThu)).toBe(0);
    expect(leaveDaysBetween('', '2026-10-18', sunToThu)).toBe(0);
  });
});

describe('leaveRequestProblems', () => {
  const input = (over: Partial<LeaveRequestInput> = {}): LeaveRequestInput => ({
    startDate: '2026-11-01',
    endDate: '2026-11-02',
    halfDay: false,
    days: 2,
    documents: 0,
    today: '2026-10-18',
    byHr: false,
    ...over,
  });
  const history = (over: Partial<LeaveHistory> = {}): LeaveHistory => ({ usedInYear: 0, timesInService: 0, serviceMonths: 80, gender: 'male', ...over });
  const balance = { available: 10, usableFrom: '2026-01-01' };

  it('none for a request that keeps the rules', () => {
    expect(leaveRequestProblems(input(), law('annual'), balance, history())).toEqual([]);
    expect(leaveRequestProblems(input(), law('casual'), balance, history())).toEqual([]);
  });

  it('the dates first', () => {
    expect(leaveRequestProblems(input({ startDate: '' }), law('annual'), balance, history())).toEqual(['Enter the first day of the leave.']);
    expect(leaveRequestProblems(input({ endDate: '2026-10-30' }), law('annual'), balance, history())).toEqual(["The last day can't be before the first."]);
    expect(leaveRequestProblems(input({ days: 0 }), law('annual'), balance, history())).toEqual([
      "These dates have no working days: rest days and official holidays aren't counted as leave.",
    ]);
    expect(leaveRequestProblems(input({ endDate: '2027-01-03' }), law('annual'), balance, history())[0]).toMatch(/can't run into the next one/);
    // a type counted per request may run into the next year
    expect(leaveRequestProblems(input({ endDate: '2027-01-03', days: 64, documents: 1 }), law('maternity'), balance, history({ gender: 'female' }))).toEqual([]);
  });

  it('half days only where the type allows them, and for one day', () => {
    expect(leaveRequestProblems(input({ halfDay: true, endDate: '2026-11-01', days: 0.5, documents: 1 }), law('sick'), balance, history())).toEqual([
      "Sick leave can't be taken as a half day.",
    ]);
    expect(leaveRequestProblems(input({ halfDay: true, days: 1.5 }), law('annual'), balance, history())).toEqual(['A half day is for one day: make the first and last day the same.']);
  });

  it('casual leave: at most 2 days at a time and 7 a year, counted against the annual balance (Art. 128)', () => {
    expect(leaveRequestProblems(input({ endDate: '2026-11-03', days: 3 }), law('casual'), balance, history())).toEqual(['Casual leave is at most 2 days at a time; this is 3 days.']);
    expect(leaveRequestProblems(input(), law('casual'), balance, history({ usedInYear: 6 }))).toEqual(["Only 1 day left of casual leave's 7 days a year."]);
    expect(leaveRequestProblems(input(), law('casual'), { ...balance, available: 1.5 }, history())).toEqual([
      'Only 1.5 days left of the annual balance, which casual leave is counted against.',
    ]);
  });

  it('annual leave: the balance, and not before six months were served', () => {
    expect(leaveRequestProblems(input({ endDate: '2026-11-12', days: 10.5 }), law('annual'), balance, history())).toEqual(['Only 10 days left of the annual balance.']);
    expect(leaveRequestProblems(input(), law('annual'), { available: 5, usableFrom: '2026-12-01' }, history())).toEqual([
      'Annual leave can be used from 01/12/2026, six months after joining.',
    ]);
  });

  it('who may take it: gender, service, times in service', () => {
    expect(leaveRequestProblems(input({ documents: 1 }), law('maternity'), balance, history())).toEqual(['Maternity leave is for female employees only.']);
    expect(leaveRequestProblems(input({ documents: 1 }), law('maternity'), balance, history({ gender: null }))).toEqual([
      'Maternity leave is for female employees: ask HR to record your gender first.',
    ]);
    expect(leaveRequestProblems(input(), law('hajj'), balance, history({ serviceMonths: 40 }))).toEqual([
      'Hajj or Jerusalem visit needs 5 years of service with the company first; by the first day there will be 40 months.',
    ]);
    expect(leaveRequestProblems(input(), law('hajj'), balance, history({ timesInService: 1 }))).toEqual([
      'Hajj or Jerusalem visit can be taken once in service, and it has been already.',
    ]);
    expect(leaveRequestProblems(input({ endDate: '2026-11-01', days: 1 }), law('birth'), balance, history({ timesInService: 3 }))).toEqual([
      'Birth of a child can be taken 3 times in service, and it has been already.',
    ]);
    expect(leaveRequestProblems(input(), law('birth'), balance, history())).toEqual(['Birth of a child is at most 1 day at a time; this is 2 days.']);
  });

  it('the notice an employee’s request needs, not HR’s on their behalf (Art. 126: ten days for exam leave)', () => {
    expect(leaveRequestProblems(input({ startDate: '2026-10-25', endDate: '2026-10-25', days: 1, documents: 1 }), law('exam'), balance, history())).toEqual([
      "Exam leave needs 10 days' notice: the first day can be 28/10/2026 at the earliest.",
    ]);
    expect(
      leaveRequestProblems(input({ startDate: '2026-10-25', endDate: '2026-10-25', days: 1, documents: 1, byHr: true }), law('exam'), balance, history()),
    ).toEqual([]);
    expect(leaveRequestProblems(input({ startDate: '2026-10-28', endDate: '2026-10-28', days: 1, documents: 1 }), law('exam'), balance, history())).toEqual([]);
  });

  it('the document a type needs', () => {
    expect(leaveRequestProblems(input(), law('sick'), balance, history())).toEqual(['Attach a document: sick leave needs one.']);
    expect(leaveRequestProblems(input({ documents: 1 }), law('sick'), balance, history())).toEqual([]);
  });
});

describe('statuses, stages and steps', () => {
  it('goes to the manager, then HR; straight to HR without a manager', () => {
    expect(firstLeaveStatus(true)).toBe('with_manager');
    expect(firstLeaveStatus(false)).toBe('with_hr');
    expect(leaveStage('with_manager')).toBe('manager');
    expect(leaveStage('with_hr')).toBe('hr');
    expect(leaveStage('approved')).toBeNull();
    expect(leaveStatusAfterApproval('manager')).toBe('with_hr');
    expect(leaveStatusAfterApproval('hr')).toBe('approved');
    expect(leaveDecisionStepKind('hr')).toBe('hr_decision');
    expect(leaveDecisionNeedsComment('reject')).toBe(true);
    expect(leaveDecisionNeedsComment('approve')).toBe(false);
  });

  it('its employee may cancel it while it is decided, or approved and not started', () => {
    expect(employeeMayCancelLeave({ status: 'with_hr', startDate: '2026-10-01' }, '2026-10-18')).toBe(true);
    expect(employeeMayCancelLeave({ status: 'approved', startDate: '2026-10-19' }, '2026-10-18')).toBe(true);
    expect(employeeMayCancelLeave({ status: 'approved', startDate: '2026-10-18' }, '2026-10-18')).toBe(false);
    expect(employeeMayCancelLeave({ status: 'rejected', startDate: '2026-11-01' }, '2026-10-18')).toBe(false);
  });
});

describe('balances', () => {
  it('the annual balance available and unused', () => {
    const b = { entitlement: 21, carriedIn: 4, adjustments: -1, taken: 5, booked: 2, pending: 1.5 };
    expect(annualAvailable(b)).toBe(15.5);
    expect(annualUnused(b)).toBe(17);
  });

  it('a type’s own days a year left', () => {
    expect(leaveTypeLeft(law('casual'), 2.5)).toBe(4.5);
    expect(leaveTypeLeft(law('casual'), 9)).toBe(0);
    expect(leaveTypeLeft(law('sick'), 9)).toBeNull();
    expect(leaveTypeLeft({ balance: 'yearly', daysPerYear: 3 }, 1)).toBe(2);
  });

  it('whole or half days', () => {
    expect(isLeaveDays(1.5)).toBe(true);
    expect(isLeaveDays(-2)).toBe(true);
    expect(isLeaveDays(1.25)).toBe(false);
    expect(isLeaveDays('1')).toBe(false);
  });

  it('flags fewer than 15 days taken, or none of 6 in a row (Art. 125): never blocks', () => {
    expect(annualMinimumFlags(21, [{ days: 6 }, { days: 9 }])).toEqual([]);
    expect(annualMinimumFlags(21, [{ days: 5 }, { days: 5 }])).toEqual([
      '10 days of annual leave taken this year: the law asks for at least 15 (Art. 125).',
      'No annual leave of 6 days in a row this year: the law asks for one (Art. 125).',
    ]);
    expect(annualMinimumFlags(7.5, [])).toEqual([]);
  });
});

describe('Year Closing (Art. 125)', () => {
  it('takes the days used from the oldest first', () => {
    expect(unusedByYear({ '2024': 3, '2025': 5 }, 2026, 21, 10)).toEqual({ '2026': 19 });
    expect(unusedByYear({ '2024': 3, '2025': 5 }, 2026, 21, 2)).toEqual({ '2024': 1, '2025': 5, '2026': 21 });
    expect(unusedByYear({}, 2026, 21, 25)).toEqual({ '2026': -4 });
    // a balance below 0 carried in comes out of the year's own days
    expect(unusedByYear({ '2025': -4 }, 2026, 21, 0)).toEqual({ '2026': 17 });
  });

  it('days earned three years ago or more must be settled at the closing', () => {
    expect(settleByAge({ '2024': 1, '2025': 5, '2026': 21 }, 2026)).toBe(1);
    expect(settleByAge({ '2023': 2, '2024': 1, '2025': 5 }, 2026)).toBe(3);
    expect(settleByAge({ '2025': 5, '2026': 21 }, 2026)).toBe(0);
    expect(settleByAge({ '2025': 5, '2026': 21 }, 2026, 2)).toBe(5);
  });

  it('carry and pay must add up to the unused, and what must be settled is paid', () => {
    expect(yearClosingProblems(27, 20, 7)).toEqual([]);
    expect(yearClosingProblems(27, 20, 5)).toEqual(["The days carried and paid must add up to the 27 days unused: leave can't be lost (Art. 125)."]);
    expect(yearClosingProblems(27, 26, 1, 1)).toEqual([]);
    expect(yearClosingProblems(27, 27, 0, 1)).toEqual(['1 day has been carried for three years and must be paid now (Art. 125): pay at least 1 day.']);
    expect(yearClosingProblems(27, -1, 28)).toEqual(['Enter the days carried: 0 or more, in whole or half days.']);
    expect(yearClosingProblems(10, 9.75, 0.25)).toHaveLength(2);
    expect(yearClosingProblems(-2, -2, 0)).toEqual([]);
    expect(yearClosingProblems(-2, 0, 0)).toHaveLength(1);
  });

  it('carries what is not paid, the oldest paid first', () => {
    expect(carriedAfterClosing({ '2024': 1, '2025': 5, '2026': 21 }, 3)).toEqual({ '2025': 3, '2026': 21 });
    expect(carriedAfterClosing({ '2026': -4 }, 0)).toEqual({ '2026': -4 });
  });

  it('pays in January of the next year, or the next open month, at a day of the gross', () => {
    expect(leavePayoutMonth(2026, [])).toBe('2027-01-01');
    expect(leavePayoutMonth(2026, ['2027-01-01'])).toBe('2027-02-01');
    expect(leaveDayRate(10_000, 30)).toBe(333.33);
    expect(leavePayAmount(7, 333.33)).toBe(2333.31);
  });
});

describe('monthLeaveDays: the payroll’s leave and unpaid leave days', () => {
  const count = { workingDays: [0, 1, 2, 3, 4], holidays: ['2026-10-06'] };
  const leave = (startDate: string, endDate: string, paid: 'paid' | 'unpaid' | 'partly', payPercent: number | null = null, halfDay = false) => ({
    startDate,
    endDate,
    halfDay,
    paid,
    payPercent,
    calendarDays: false,
  });

  it('shares each leave’s days in the month between paid and unpaid, a partly paid one by its percent', () => {
    expect(
      monthLeaveDays(
        [leave('2026-10-04', '2026-10-08', 'paid'), leave('2026-10-11', '2026-10-14', 'partly', 75), leave('2026-10-18', '2026-10-19', 'unpaid'), leave('2026-10-20', '2026-10-20', 'paid', null, true)],
        '2026-10',
        count,
      ),
    ).toEqual({ paid: 4 + 3 + 0.5, unpaid: 1 + 2 });
  });

  it('only the days in the month, and the days employed', () => {
    expect(monthLeaveDays([leave('2026-09-27', '2026-10-01', 'paid')], '2026-10', count)).toEqual({ paid: 1, unpaid: 0 });
    expect(monthLeaveDays([leave('2026-10-25', '2026-11-03', 'unpaid')], '2026-10', { ...count, to: '2026-10-27' })).toEqual({ paid: 0, unpaid: 3 });
    // a half day in a leave that runs into the next month is that month's
    expect(monthLeaveDays([leave('2026-10-29', '2026-11-01', 'paid', null, true)], '2026-10', count)).toEqual({ paid: 1, unpaid: 0 });
  });

  it('counts a leave on the shift’s working days for the expected hours (onWorkingDays, 27 October 2026), a calendar-day type’s too', () => {
    const maternity = { ...leave('2026-11-08', '2026-11-19', 'paid'), calendarDays: true };
    const november = { workingDays: [0, 1, 2, 3, 4], holidays: ['2026-11-10'] };
    // 12 calendar days to the leave itself; its 10 working days less the holiday on the 10th to the expected hours
    expect(monthLeaveDays([maternity], '2026-11', november)).toEqual({ paid: 12, unpaid: 0 });
    expect(monthLeaveDays([maternity], '2026-11', { ...november, onWorkingDays: true })).toEqual({ paid: 9, unpaid: 0 });
    // a type counted in working days counts the same either way
    expect(monthLeaveDays([leave('2026-10-04', '2026-10-08', 'unpaid')], '2026-10', { ...count, onWorkingDays: true })).toEqual({ paid: 0, unpaid: 4 });
  });
});

describe('a type’s days a year are a share in the year someone joins or leaves (owner, 26 October 2026: "Yes, a share")', () => {
  it('a joiner on 1 July has 3.5 of casual leave’s 7; a full year has 7', () => {
    expect(yearlyDaysFor(7, '2026-07-01', null, 2026)).toBe(3.5);
    expect(yearlyDaysFor(7, '2026-01-01', null, 2026)).toBe(7);
    expect(yearlyDaysFor(7, '2020-03-01', null, 2026)).toBe(7);
    // the year after joining is a full one
    expect(yearlyDaysFor(7, '2026-07-01', null, 2027)).toBe(7);
  });

  it('a joiner part-way through a month has that month by days, to the nearest half day', () => {
    // 16 March: 16 of 31 days of March and nine full months
    expect(yearlyDaysFor(7, '2026-03-16', null, 2026)).toBe(5.5);
    expect(yearlyDaysFor(7, '2026-12-31', null, 2026)).toBe(0);
  });

  it('a leaver has the share of the year until the last day', () => {
    expect(yearlyDaysFor(7, '2020-01-01', '2026-06-30', 2026)).toBe(3.5);
    expect(yearlyDaysFor(7, '2026-03-01', '2026-08-31', 2026)).toBe(3.5);
    expect(yearlyDaysFor(7, '2020-01-01', '2026-06-30', 2027)).toBe(0);
  });

  it('a type without days a year has none; the rules carry the year’s number', () => {
    expect(yearlyDaysFor(null, '2026-07-01', null, 2026)).toBeNull();
    expect(rulesForYear(law('casual'), { joinDate: '2026-07-01', endDate: null }, 2026).daysPerYear).toBe(3.5);
    expect(rulesForYear(law('annual'), { joinDate: '2026-07-01', endDate: null }, 2026)).toBe(law('annual'));
  });

  it('shows in what is left of it, and in the request’s check', () => {
    const casual = rulesForYear(law('casual'), { joinDate: '2026-07-01', endDate: null }, 2026);
    expect(leaveTypeLeft(casual, 2)).toBe(1.5);
    const input = { startDate: '2026-11-01', endDate: '2026-11-02', halfDay: false, days: 2, documents: 0, today: '2026-10-18', byHr: false };
    const history = { usedInYear: 2, timesInService: 1, serviceMonths: 4, gender: 'male' as const };
    expect(leaveRequestProblems(input, casual, { available: 10, usableFrom: '2026-01-01' }, history)).toEqual(["Only 1.5 days left of casual leave's 3.5 days a year."]);
    expect(leaveRequestProblems(input, law('casual'), { available: 10, usableFrom: '2026-01-01' }, history)).toEqual([]);
  });
});

describe('leave beyond the balance (owner, 26 October 2026: "only allow super admin to add leaves with a negative balance")', () => {
  const input = { startDate: '2026-11-01', endDate: '2026-11-05', halfDay: false, days: 5, documents: 0, today: '2026-10-18', byHr: true };
  const history = { usedInYear: 0, timesInService: 0, serviceMonths: 80, gender: 'male' as const };

  it('is a problem unless allowed, and then it is not', () => {
    expect(leaveRequestProblems(input, law('annual'), { available: 3, usableFrom: '2026-01-01' }, history)).toEqual(['Only 3 days left of the annual balance.']);
    expect(leaveRequestProblems(input, law('annual'), { available: 3, usableFrom: '2026-01-01', allowNegative: false }, history)).toEqual(['Only 3 days left of the annual balance.']);
    expect(leaveRequestProblems(input, law('annual'), { available: 3, usableFrom: '2026-01-01', allowNegative: true }, history)).toEqual([]);
  });

  it('counts the days over, only for a type from the annual balance', () => {
    expect(overBalanceDays(law('annual'), 3, 5)).toBe(2);
    expect(overBalanceDays(law('casual'), 1, 1.5)).toBe(0.5);
    expect(overBalanceDays(law('annual'), 5, 5)).toBe(0);
    expect(overBalanceDays(law('unpaid'), 0, 5)).toBe(0);
    expect(overBalanceStepText(2)).toBe('Over the balance by 2 days: allowed by a Super Admin');
    expect(overBalanceStepText(0.5)).toBe('Over the balance by 0.5 days: allowed by a Super Admin');
    expect(overBalanceWarning(3, 5)).toBe('This leaves the annual balance at −2 days.');
    expect(overBalanceWarning(4, 5)).toBe('This leaves the annual balance at −1 day.');
  });

  it('a Super Admin’s own type days a year are still kept', () => {
    const casual = law('casual');
    expect(leaveRequestProblems({ ...input, endDate: '2026-11-02', days: 2 }, casual, { available: 0, usableFrom: '2026-01-01', allowNegative: true }, { ...history, usedInYear: 6.5 })).toEqual([
      "Only 0.5 days left of casual leave's 7 days a year.",
    ]);
  });
});
