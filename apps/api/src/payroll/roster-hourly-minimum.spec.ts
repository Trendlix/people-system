import { EMPTY_PAYROLL_INPUTS, payrollLine } from '@trendlix/shared';
import { roster, type RosterEmployment } from './roster.js';

// The minimum a month by the hour on the payroll (owner, 27 October 2026: "can i add rate per hour with a minimum monthly
// payment?"; he chose "On each contract" and "Prorated by days"): the line's terms keep the month-end contract's, whose
// rate is paid, and the line pays the hours or the minimum for the days paid if more. Everyone here is invented.

let n = 0;
function contract(over: Partial<RosterEmployment['contracts'][number]> = {}): RosterEmployment['contracts'][number] {
  n += 1;
  return {
    id: `contract-${n}`,
    number: `CON-2026-${String(n).padStart(4, '0')}`,
    version: 1,
    startDate: '2026-01-01',
    endDate: '2026-12-31',
    payBasis: 'hourly',
    grossSalary: 21666.67,
    basicPercent: 80,
    hourlyRate: 250,
    hourlyMinimum: 12000,
    allowances: [],
    ...over,
  };
}

function employment(over: Partial<RosterEmployment> = {}): RosterEmployment {
  n += 1;
  return {
    id: `employment-${n}`,
    employmentType: 'part_time',
    joinDate: '2026-01-01',
    endDate: null,
    department: { nameEn: 'Video', parent: null },
    jobTitle: 'Video Editor',
    shift: null,
    employee: { id: `employee-${n}`, employeeCode: `EMP-${String(n).padStart(4, '0')}`, fullNameEn: `Person ${n}`, socialInsured: true, insuranceComprehensiveWage: null },
    contracts: [contract()],
    ...over,
  };
}

const rules = { dayDivisor: 30 };

describe('the minimum a month by the hour on the roster', () => {
  it('keeps the contract’s minimum on the terms and its part, and the line tops the hours up to it', () => {
    const [line] = roster('2026-10', [employment()], rules).lines;
    expect(line.terms).toMatchObject({ payBasis: 'hourly', hourlyRate: 250, hourlyMinimum: 12000, paidDays: 30 });
    expect(line.terms.segments).toMatchObject([{ payBasis: 'hourly', hourlyRate: 250, hourlyMinimum: 12000, days: 30 }]);
    // October: 32 h × 250 = 8,000, paid 12,000
    expect(payrollLine(line.terms, { ...EMPTY_PAYROLL_INPUTS, workedHours: 32 })).toMatchObject({ fixed: 12000, hourlyTopUp: 4000, earned: 12000 });
  });

  it('joined on the 16th: 16 days paid, the minimum for them', () => {
    const [line] = roster('2026-10', [employment({ joinDate: '2026-10-16', contracts: [contract({ startDate: '2026-10-16' })] })], rules).lines;
    expect(line.terms).toMatchObject({ paidDays: 16, hourlyMinimum: 12000 });
    expect(payrollLine(line.terms, { ...EMPTY_PAYROLL_INPUTS, workedHours: 10 })).toMatchObject({ fixed: 6400, hourlyTopUp: 3900 });
  });

  it('the month-end contract’s minimum: a raise of the minimum from the 1st pays the new one', () => {
    const before = contract({ endDate: '2026-12-31' });
    const raised = contract({ version: 2, startDate: '2026-10-01', hourlyMinimum: 14000 });
    const [line] = roster('2026-10', [employment({ contracts: [before, raised] })], rules).lines;
    expect(line.terms.hourlyMinimum).toBe(14000);
  });

  it('none on the terms without one, nor for a monthly salary: the terms read as they did', () => {
    const [none] = roster('2026-10', [employment({ contracts: [contract({ hourlyMinimum: null })] })], rules).lines;
    expect(none.terms).not.toHaveProperty('hourlyMinimum');
    expect(none.terms.segments![0]).not.toHaveProperty('hourlyMinimum');
    const [monthly] = roster('2026-10', [employment({ contracts: [contract({ payBasis: 'monthly', grossSalary: 12000, hourlyRate: null, hourlyMinimum: 5000 })] })], rules).lines;
    expect(monthly.terms).not.toHaveProperty('hourlyMinimum');
  });
});
