import { EMPTY_PAYROLL_INPUTS, leaveDaysOf, payrollLine, type PayrollLeave, type PayrollTerms } from '@trendlix/shared';
import { leaveTermsOf, roster, type RosterEmployment } from './roster.js';

// The month's approved leave on its payroll line (owner, 18 October 2026: "can you apply the leaves according to the
// law?"): the Leave days and the Unpaid leave days filled in from it unless HR types others, a day of the gross cut for
// each unpaid day, a partly paid leave's unpaid share too, and both out of the shift's expected hours. Everyone here is
// invented.

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
    expect(leaveTermsOf('2026-08', [{ from: '2026-08-01', to: '2026-08-31' }], SUN_TO_THU, [], [month], 30)).toEqual({ paidDays: 0, unpaidDays: 30 });
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
