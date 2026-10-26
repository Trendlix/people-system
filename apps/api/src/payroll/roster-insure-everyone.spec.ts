import { EMPTY_PAYROLL_INPUTS, payrollLine } from '@trendlix/shared';
import { roster, type RosterEmployment } from './roster.js';

// Social insurance for everyone, registered or not (owner, 26 October 2026: "when calculating the payroll for now,
// calculate as if the employee is insured, no matter he is registered or not"; "till i adjust my system dont connect
// them togeather"). Everyone here is invented.

let n = 0;
function employment(type: RosterEmployment['employmentType'], socialInsured: boolean): RosterEmployment {
  n += 1;
  return {
    id: `employment-${n}`,
    employmentType: type,
    joinDate: '2025-01-01',
    endDate: null,
    department: null,
    jobTitle: 'Account Manager',
    shift: { startTime: '09:00', endTime: '18:00', workingDays: [0, 1, 2, 3, 4] },
    employee: { id: `employee-${n}`, employeeCode: `EMP-${String(n).padStart(4, '0')}`, fullNameEn: `Person ${n}`, socialInsured, insuranceComprehensiveWage: null },
    contracts: [
      {
        id: `contract-${n}`,
        number: `CON-2025-${String(n).padStart(4, '0')}`,
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
  };
}

const lineOf = (employee: RosterEmployment, insureEveryone: boolean) => {
  const { lines } = roster('2026-11', [employee], { dayDivisor: 30, insureEveryone });
  const line = lines[0];
  return { terms: line.terms, result: payrollLine(line.terms, EMPTY_PAYROLL_INPUTS) };
};

describe('social insurance for everyone, registered or not', () => {
  it('on: someone not registered has the employee share deducted and the company share counted', () => {
    const { terms, result } = lineOf(employment('full_time', false), true);
    expect(terms).toMatchObject({ statutory: true, insured: true, notRegistered: true });
    expect(result.insuredWage).toBe(12000);
    expect(result.employeeInsurance).toBe(1320);
    expect(result.employerInsurance).toBeGreaterThan(0);
    expect(result.companyCost).toBeGreaterThan(result.net);
  });

  it('on: someone registered is as before, with no "not registered" mark', () => {
    const { terms, result } = lineOf(employment('full_time', true), true);
    expect(terms.insured).toBe(true);
    expect(terms.notRegistered).toBeUndefined();
    expect(result.employeeInsurance).toBe(1320);
  });

  it('off (or a rule missing): nothing deducted for someone not registered', () => {
    for (const given of [false, undefined]) {
      const { lines } = roster('2026-11', [employment('full_time', false)], given === undefined ? { dayDivisor: 30 } : { dayDivisor: 30, insureEveryone: given });
      const result = payrollLine(lines[0].terms, EMPTY_PAYROLL_INPUTS);
      expect(lines[0].terms).toMatchObject({ insured: false });
      expect(lines[0].terms.notRegistered).toBeUndefined();
      expect(result).toMatchObject({ insuredWage: 0, employeeInsurance: 0, employerInsurance: 0 });
    }
  });

  it('a freelancer has none either way', () => {
    for (const on of [true, false]) {
      const { terms, result } = lineOf(employment('freelance', false), on);
      expect(terms).toMatchObject({ statutory: false, insured: false });
      expect(result).toMatchObject({ employeeInsurance: 0, employerInsurance: 0 });
    }
  });
});
