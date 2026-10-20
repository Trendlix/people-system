import { roster, type RosterEmployment } from './roster.js';

// Make-up hours on the payroll line's terms (owner, 20 October 2026: "within the same month with no working hours to be
// counted after 8 PM even if the check out was 11 PM"): a monthly-paid line on a shift that counts hours until a time is
// marked makeUpHours, so its long days fill the month's short hours (payroll.ts). Everyone here is invented.

const SUN_TO_THU = [0, 1, 2, 3, 4];

function employment(shift: RosterEmployment['shift'], payBasis: 'monthly' | 'hourly' = 'monthly'): RosterEmployment {
  return {
    id: 'employment-1',
    employmentType: 'full_time',
    joinDate: '2025-01-01',
    endDate: null,
    department: { nameEn: 'Sales', parent: null },
    jobTitle: 'Account Manager',
    shift,
    employee: { id: 'employee-1', employeeCode: 'EMP-0001', fullNameEn: 'Person One', socialInsured: false, insuranceComprehensiveWage: null },
    contracts: [
      {
        id: 'contract-1',
        number: 'CON-2025-0001',
        version: 1,
        startDate: '2025-01-01',
        endDate: '2026-12-31',
        payBasis,
        grossSalary: 12000,
        basicPercent: 80,
        hourlyRate: payBasis === 'hourly' ? 100 : null,
        allowances: [],
      },
    ],
  };
}

const MORNING = { startTime: '09:00', endTime: '19:00', hoursPerDay: 9, workingDays: SUN_TO_THU };
const termsOf = (e: RosterEmployment) => roster('2026-10', [e], { dayDivisor: 30 }).lines[0].terms;

describe('roster: make-up hours in the terms', () => {
  it('marks a monthly-paid line on a shift that counts hours until a time', () => {
    expect(termsOf(employment({ ...MORNING, countUntil: '20:00' }))).toMatchObject({ makeUpHours: true, hoursPerDay: 9 });
  });

  it('leaves every other line as it was: no limit, a limit not allowed, pay by the hour, no shift', () => {
    expect('makeUpHours' in termsOf(employment(MORNING))).toBe(false);
    expect('makeUpHours' in termsOf(employment({ ...MORNING, countUntil: null }))).toBe(false);
    expect('makeUpHours' in termsOf(employment({ ...MORNING, countUntil: '18:00' }))).toBe(false);
    expect('makeUpHours' in termsOf(employment({ ...MORNING, countUntil: '20:00' }, 'hourly'))).toBe(false);
    expect('makeUpHours' in termsOf(employment(null))).toBe(false);
  });
});
