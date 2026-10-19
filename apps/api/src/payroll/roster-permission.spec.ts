import { EMPTY_PAYROLL_INPUTS, payrollLine, permissionHoursOf, type PayrollTerms } from '@trendlix/shared';
import { permissionTermsOf, roster, type RosterEmployment } from './roster.js';

// The month's approved permission on its payroll line (owner, 19 October 2026: "this is an option given by us .. 4 hours
// per month with a maximum 2 hours per day", counted as worked): the Permission hours filled in from it unless HR types
// others, added to the worked hours for the attendance, so they are never cut as short hours. Everyone here is invented.

const SUN_TO_THU = [0, 1, 2, 3, 4];

function employment(over: Partial<RosterEmployment> = {}): RosterEmployment {
  return {
    id: 'employment-1',
    employmentType: 'full_time',
    joinDate: '2025-01-01',
    endDate: null,
    department: { nameEn: 'Sales', parent: null },
    jobTitle: 'Account Manager',
    shift: { startTime: '09:00', endTime: '19:00', hoursPerDay: 9, workingDays: SUN_TO_THU },
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

// September 2026: 22 working days Sunday to Thursday, 198 hours of the shift; 2 hours on the 8th and 2 on the 22nd
const SEPTEMBER = [
  { date: '2026-09-08', hours: 2 },
  { date: '2026-09-22', hours: 2 },
];

describe('permissionTermsOf', () => {
  it('counts the approved hours on the days paid, at most the month’s allowance', () => {
    expect(permissionTermsOf('2026-09', [{ from: '2026-09-01', to: '2026-09-30' }], SEPTEMBER, 4)).toBe(4);
    expect(permissionTermsOf('2026-09', [{ from: '2026-09-15', to: '2026-09-30' }], SEPTEMBER, 4)).toBe(2);
    expect(permissionTermsOf('2026-09', [{ from: '2026-09-01', to: '2026-09-30' }], SEPTEMBER, 3)).toBe(3);
    expect(permissionTermsOf('2026-09', [{ from: '2026-09-01', to: '2026-09-30' }], [], 4)).toBeNull();
  });
});

describe('roster: the month’s permission in the terms', () => {
  it('takes the approved hours into a monthly paid line’s terms, none without any or for pay by the hour', () => {
    expect(roster('2026-09', [employment({ permissions: SEPTEMBER })], { dayDivisor: 30 }).lines[0].terms.permissionHours).toBe(4);
    // the Leave Setup's hours a month, lowered to 3 since
    expect(roster('2026-09', [employment({ permissions: SEPTEMBER })], { dayDivisor: 30 }, [], undefined, 3).lines[0].terms.permissionHours).toBe(3);
    expect('permissionHours' in roster('2026-09', [employment()], { dayDivisor: 30 }).lines[0].terms).toBe(false);
    const hourly = employment({ permissions: SEPTEMBER });
    hourly.contracts = [{ ...hourly.contracts[0], payBasis: 'hourly', hourlyRate: 100 }];
    expect('permissionHours' in roster('2026-09', [hourly], { dayDivisor: 30 }).lines[0].terms).toBe(false);
  });
});

describe('payrollLine with the month’s permission', () => {
  const terms = (): PayrollTerms => roster('2026-09', [employment({ permissions: SEPTEMBER })], { dayDivisor: 30 }).lines[0].terms;
  const without = (): PayrollTerms => {
    const { permissionHours: _p, ...rest } = terms();
    return rest;
  };

  it('counts the permission hours as worked, so they are never cut as short hours', () => {
    // 175 of 198 hours worked: 88.4%, below the 90% grace, cut; with the 4 permission hours, 179: 90.4%, not cut
    const short = payrollLine(without(), { ...EMPTY_PAYROLL_INPUTS, workedHours: 175 });
    expect(short.attendanceCut).toBeGreaterThan(0);
    expect(short).not.toHaveProperty('permissionHours');
    const line = payrollLine(terms(), { ...EMPTY_PAYROLL_INPUTS, workedHours: 175 });
    expect(line).toMatchObject({ permissionHours: 4, expectedHours: 198, attendanceCut: 0, attendanceScore: 1, earned: 12_000 });
    expect(line.attendanceRatio).toBeCloseTo(179 / 198, 9);
  });

  it('takes what HR typed (or an import filled) instead, and counts nothing while attendance isn’t tracked', () => {
    expect(permissionHoursOf(terms(), EMPTY_PAYROLL_INPUTS)).toBe(4);
    expect(permissionHoursOf(terms(), { permissionHours: 1 })).toBe(1);
    expect(permissionHoursOf(terms(), { permissionHours: 0 })).toBe(0);
    expect(permissionHoursOf(without(), EMPTY_PAYROLL_INPUTS)).toBeNull();
    const typed = payrollLine(terms(), { ...EMPTY_PAYROLL_INPUTS, workedHours: 175, permissionHours: 1 });
    expect(typed.permissionHours).toBe(1);
    expect(typed.attendanceCut).toBeGreaterThan(0);
    // no worked hours: attendance isn't tracked, so there is nothing to add the permission to
    expect(payrollLine(terms(), EMPTY_PAYROLL_INPUTS)).toMatchObject({ attendanceRatio: null, attendanceCut: 0 });
    expect(payrollLine(terms(), EMPTY_PAYROLL_INPUTS)).not.toHaveProperty('permissionHours');
  });

  it('doesn’t warn of worked hours above the shift’s for the permission hours added', () => {
    const full = payrollLine(terms(), { ...EMPTY_PAYROLL_INPUTS, workedHours: 198 });
    expect(full.warnings.filter((w) => w.startsWith('Worked hours are more than'))).toEqual([]);
  });

  it('pays only the hours worked by the hour, and says so of permission hours typed', () => {
    const hourly: PayrollTerms = { ...without(), payBasis: 'hourly', hourlyRate: 100, expectedHours: null };
    const line = payrollLine(hourly, { ...EMPTY_PAYROLL_INPUTS, workedHours: 100, permissionHours: 2 });
    expect(line.fixed).toBe(10_000);
    expect(line.warnings).toContain("Paid by the hour: the permission hours aren't paid, only the hours worked");
  });
});
