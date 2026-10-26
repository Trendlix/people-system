import { EMPTY_PAYROLL_INPUTS, leaveDaysOf, leaveDaysOff, payrollLine, type PayrollLeave, type PayrollTerms } from '@trendlix/shared';
import { leaveTermsOf, roster, type RosterEmployment } from './roster.js';

// The month's approved leave on its payroll line (owner, 18 October 2026: "can you apply the leaves according to the
// law?"): the Leave days and the Unpaid leave days filled in from it unless HR types others, a day of the gross cut for
// each unpaid day, a partly paid leave's unpaid share too, and both out of the shift's expected hours. A leave counted in
// calendar days (maternity, hajj, childcare) takes only its working days out of the expected hours (27 October 2026),
// its unpaid days still cut one by one. Everyone here is invented.

const SUN_TO_THU = [0, 1, 2, 3, 4];

const leave = (startDate: string, endDate: string, paid: PayrollLeave['paid'], payPercent: number | null = null): PayrollLeave => ({
  startDate,
  endDate,
  halfDay: false,
  paid,
  payPercent,
  calendarDays: false,
});

function employment(over: Partial<RosterEmployment> = {}): RosterEmployment {
  return {
    id: 'employment-1',
    employmentType: 'full_time',
    joinDate: '2025-01-01',
    endDate: null,
    department: { nameEn: 'Sales', parent: null },
    jobTitle: 'Account Manager',
    shift: { startTime: '09:00', endTime: '18:00', workingDays: SUN_TO_THU },
    employee: { id: 'employee-1', employeeCode: 'EMP-0001', fullNameEn: 'Person One', socialInsured: false, insuranceComprehensiveWage: null },
    contracts: [
      {
        id: 'contract-1',
        number: 'CON-2025-0001',
        version: 1,
        startDate: '2025-01-01',
        endDate: '2026-12-31',
        payBasis: 'monthly',
        grossSalary: 12000,
        basicPercent: 80,
        hourlyRate: null,
        allowances: [],
      },
    ],
    ...over,
  };
}

// September 2026: 22 working days Sunday to Thursday; annual leave Sunday 6 to Thursday 10 (5 days), unpaid leave Sunday
// 13 and Monday 14 (2 days), sick leave at 75% Tuesday 15 and Wednesday 16 (1.5 days paid, 0.5 unpaid)
const SEPTEMBER = [leave('2026-09-06', '2026-09-10', 'paid'), leave('2026-09-13', '2026-09-14', 'unpaid'), leave('2026-09-15', '2026-09-16', 'partly', 75)];

describe('leaveTermsOf', () => {
  it('counts each leave’s days in the parts of the month paid, a partly paid one by its percent', () => {
    expect(leaveTermsOf('2026-09', [{ from: '2026-09-01', to: '2026-09-30' }], SUN_TO_THU, [], SEPTEMBER, 30)).toEqual({ paidDays: 6.5, unpaidDays: 2.5 });
    // a holiday on a leave day isn't a leave day
    expect(leaveTermsOf('2026-09', [{ from: '2026-09-01', to: '2026-09-30' }], SUN_TO_THU, ['2026-09-08'], SEPTEMBER, 30)).toEqual({ paidDays: 5.5, unpaidDays: 2.5 });
    // only within the parts paid (joined on the 14th)
    expect(leaveTermsOf('2026-09', [{ from: '2026-09-14', to: '2026-09-30' }], SUN_TO_THU, [], SEPTEMBER, 17)).toEqual({ paidDays: 1.5, unpaidDays: 1.5 });
  });

  it('is none without leave, and never more than the days paid', () => {
    expect(leaveTermsOf('2026-09', [{ from: '2026-09-01', to: '2026-09-30' }], SUN_TO_THU, [], [], 30)).toBeNull();
    const month = { ...leave('2026-08-01', '2026-10-31', 'unpaid'), calendarDays: true };
    // August's 31 calendar days capped at the 30 paid; its 22 working days (Sunday to Thursday) out of the hours
    expect(leaveTermsOf('2026-08', [{ from: '2026-08-01', to: '2026-08-31' }], SUN_TO_THU, [], [month], 30)).toEqual({ paidDays: 0, unpaidDays: 30, unpaidWorkingDays: 22 });
  });
});

// November 2026: 22 working days Sunday to Thursday; maternity Sunday 8 to Thursday 19 (12 calendar days, 10 working
// days); childcare, unpaid, Sunday 1 to Sunday 15 (15 calendar days, 11 working days)
const MATERNITY: PayrollLeave = { ...leave('2026-11-08', '2026-11-19', 'paid'), calendarDays: true };
const CHILDCARE: PayrollLeave = { ...leave('2026-11-01', '2026-11-15', 'unpaid'), calendarDays: true };
const NOVEMBER = [{ from: '2026-11-01', to: '2026-11-30' }];

describe('leaveTermsOf: leave counted in calendar days (27 October 2026)', () => {
  it('takes a paid calendar-day leave’s working days alone out of the expected hours: maternity 8–19 November is 10 days, not 12', () => {
    expect(leaveTermsOf('2026-11', NOVEMBER, SUN_TO_THU, [], [MATERNITY], 30)).toEqual({ paidDays: 10, unpaidDays: 0 });
    // a holiday on one of them isn't a leave day either
    expect(leaveTermsOf('2026-11', NOVEMBER, SUN_TO_THU, ['2026-11-10'], [MATERNITY], 30)).toEqual({ paidDays: 9, unpaidDays: 0 });
    // only within the parts paid (joined on the 15th): 15–19
    expect(leaveTermsOf('2026-11', [{ from: '2026-11-15', to: '2026-11-30' }], SUN_TO_THU, [], [MATERNITY], 16)).toEqual({ paidDays: 5, unpaidDays: 0 });
  });

  it('keeps an unpaid calendar-day leave’s every day for the cut, its working days beside them for the hours', () => {
    expect(leaveTermsOf('2026-11', NOVEMBER, SUN_TO_THU, [], [CHILDCARE], 30)).toEqual({ paidDays: 0, unpaidDays: 15, unpaidWorkingDays: 11 });
    // a type counted in working days has no separate working days: the same number
    expect(leaveTermsOf('2026-11', NOVEMBER, SUN_TO_THU, [], [leave('2026-11-01', '2026-11-05', 'unpaid')], 30)).toEqual({ paidDays: 0, unpaidDays: 5 });
  });
});

describe('payrollLine with leave counted in calendar days (27 October 2026)', () => {
  const november = (leaves: PayrollLeave[]): PayrollTerms => roster('2026-11', [employment({ leaves })], { dayDivisor: 30 }).lines[0].terms;

  it('maternity 8–19 November: 10 days of the shift out of the 198 hours (108 left), so the real attendance shows', () => {
    const terms = november([MATERNITY]);
    expect(terms.leave).toEqual({ paidDays: 10, unpaidDays: 0 });
    expect(terms.expectedHours).toBe(198);
    // 7:30 on each of the other 12 working days: 90 of 108 is 83.3%, below the grace, cut on the fixed 9,600; nothing cut for the leave itself
    const line = payrollLine(terms, { ...EMPTY_PAYROLL_INPUTS, workedHours: 90 });
    expect(line).toMatchObject({ leaveHours: 90, expectedHours: 108, unpaidLeaveCut: 0, attendanceCut: 1600 });
    expect(line.attendanceRatio).toBeCloseTo(90 / 108, 9);
    expect(leaveDaysOf(terms, EMPTY_PAYROLL_INPUTS)).toEqual({ leaveDays: 10, unpaidLeaveDays: null });
    expect(leaveDaysOff(terms, EMPTY_PAYROLL_INPUTS)).toEqual({ leaveDays: 10, unpaidLeaveDays: null });
    // before 27 October 2026 all 12 came out: 90 of 90, the cut hidden
    expect(payrollLine({ ...terms, leave: { paidDays: 12, unpaidDays: 0 } }, { ...EMPTY_PAYROLL_INPUTS, workedHours: 90 })).toMatchObject({ expectedHours: 90, attendanceRatio: 1, attendanceCut: 0 });
  });

  it('unpaid childcare 1–15 November: 15 days of the gross cut as before, 11 days of the shift out of the hours', () => {
    const terms = november([CHILDCARE]);
    expect(terms.leave).toEqual({ paidDays: 0, unpaidDays: 15, unpaidWorkingDays: 11 });
    // 15 × 12,000 ÷ 30; 198 − 99 expected
    const line = payrollLine(terms, { ...EMPTY_PAYROLL_INPUTS, workedHours: 99 });
    expect(line).toMatchObject({ unpaidLeaveCut: 6000, leaveHours: 99, expectedHours: 99, attendanceRatio: 1, attendanceCut: 0, earned: 6000 });
    expect(leaveDaysOf(terms, EMPTY_PAYROLL_INPUTS)).toEqual({ leaveDays: null, unpaidLeaveDays: 15 });
    expect(leaveDaysOff(terms, EMPTY_PAYROLL_INPUTS)).toEqual({ leaveDays: null, unpaidLeaveDays: 11 });
    // HR's typed days win for both, a day of the shift each, as before
    expect(payrollLine(terms, { ...EMPTY_PAYROLL_INPUTS, workedHours: 90, unpaidLeaveDays: 12 })).toMatchObject({ unpaidLeaveCut: 4800, leaveHours: 108, expectedHours: 90 });
    expect(leaveDaysOff(terms, { leaveDays: null, unpaidLeaveDays: 12 })).toEqual({ leaveDays: null, unpaidLeaveDays: 12 });
    // a line made before then (no working days kept): its unpaid days come out of the hours, as they did
    const before = { ...terms, leave: { paidDays: 0, unpaidDays: 15 } };
    expect(payrollLine(before, { ...EMPTY_PAYROLL_INPUTS, workedHours: 63 })).toMatchObject({ unpaidLeaveCut: 6000, leaveHours: 135, expectedHours: 63 });
    expect(leaveDaysOff(before, EMPTY_PAYROLL_INPUTS)).toEqual({ leaveDays: null, unpaidLeaveDays: 15 });
  });
});

describe('roster: the month’s leave in the terms', () => {
  it('takes the approved leave into a monthly paid line’s terms, and none without leave or for pay by the hour', () => {
    const [withLeave] = roster('2026-09', [employment({ leaves: SEPTEMBER })], { dayDivisor: 30 }).lines;
    expect(withLeave.terms.leave).toEqual({ paidDays: 6.5, unpaidDays: 2.5 });
    const [none] = roster('2026-09', [employment()], { dayDivisor: 30 }).lines;
    expect('leave' in none.terms).toBe(false);
    const hourly = employment({ leaves: SEPTEMBER });
    hourly.contracts = [{ ...hourly.contracts[0], payBasis: 'hourly', hourlyRate: 100 }];
    expect('leave' in roster('2026-09', [hourly], { dayDivisor: 30 }).lines[0].terms).toBe(false);
  });
});

describe('payrollLine with the month’s leave', () => {
  const terms = (): PayrollTerms => roster('2026-09', [employment({ leaves: SEPTEMBER })], { dayDivisor: 30 }).lines[0].terms;

  it('fills in the leave days and the unpaid leave days, cuts a day of the gross for each unpaid one, and takes both out of the expected hours', () => {
    const line = payrollLine(terms(), { ...EMPTY_PAYROLL_INPUTS, workedHours: 117 });
    // 2.5 unpaid days of 12,000 ÷ 30
    expect(line.unpaidLeaveCut).toBe(1000);
    // the shift's 198 hours (22 days × 9) less 9 days of leave
    expect(line).toMatchObject({ leaveHours: 81, expectedHours: 117, attendanceRatio: 1, attendanceCut: 0, earned: 11_000 });
    expect(leaveDaysOf(terms(), EMPTY_PAYROLL_INPUTS)).toEqual({ leaveDays: 6.5, unpaidLeaveDays: 2.5 });
  });

  it('takes what HR typed instead', () => {
    const line = payrollLine(terms(), { ...EMPTY_PAYROLL_INPUTS, leaveDays: 5, unpaidLeaveDays: 1 });
    expect(line).toMatchObject({ unpaidLeaveCut: 400, leaveHours: 54, earned: 11_600 });
    expect(leaveDaysOf(terms(), { leaveDays: 0, unpaidLeaveDays: 0 })).toEqual({ leaveDays: 0, unpaidLeaveDays: 0 });
  });

  it('never cuts more than the salary left, and has no leave for a line without it', () => {
    const { leave: _l, ...without } = terms();
    const capped = payrollLine(without, { ...EMPTY_PAYROLL_INPUTS, unpaidLeaveDays: 31 });
    expect(capped.unpaidLeaveCut).toBe(12_000);
    expect(capped.earned).toBe(0);
    expect(capped.warnings).toContain('The unpaid leave days cost more than the salary left for the days paid: the cut is capped there');
    expect(payrollLine(without, EMPTY_PAYROLL_INPUTS)).toMatchObject({ unpaidLeaveCut: 0, leaveHours: 0, earned: 12_000 });
  });
});
