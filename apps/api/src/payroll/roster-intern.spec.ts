import { EMPTY_PAYROLL_INPUTS, payrollLine } from '@trendlix/shared';
import { roster, type RosterContract, type RosterEmployment } from './roster.js';

// An unpaid intern on the payroll (owner, 19 October 2026: "in case of trainee, we are not paying them salary, its just
// transportation allowance. can i add the gross with 0?"): the internship agreement pays no wage, the gross 0, and its
// allowances on top; outside the labour law, like a freelancer, so no social insurance, no salary tax and no Martyrs'
// Fund, whatever the profile says about social insurance. Everyone here is invented.

const agreement = (over: Partial<RosterContract> = {}): RosterContract => ({
  id: 'contract-i1',
  number: 'CON-2026-0050',
  version: 1,
  startDate: '2026-10-01',
  endDate: '2026-12-31',
  payBasis: 'monthly',
  grossSalary: 0,
  basicPercent: 80,
  hourlyRate: null,
  // the transportation allowance, taxable as it is set up: still no tax for an intern
  allowances: [{ nameEn: 'Transportation', amount: 1500, taxable: true, insured: true }],
  ...over,
});

const intern = (over: Partial<RosterEmployment> = {}): RosterEmployment => ({
  id: 'employment-i1',
  employmentType: 'intern',
  joinDate: '2026-10-01',
  endDate: null,
  department: null,
  jobTitle: 'Design Intern',
  shift: { startTime: '09:00', endTime: '18:00', workingDays: [0, 1, 2, 3, 4] },
  // registered with social insurance on the profile by mistake: an intern still pays none
  employee: { id: 'employee-i1', employeeCode: 'EMP-0951', fullNameEn: 'Ilham Intern', socialInsured: true, insuranceComprehensiveWage: null },
  contracts: [agreement()],
  ...over,
});

describe('an unpaid intern on the payroll', () => {
  it('is on the run with the agreement’s terms, outside the labour law: no insurance, tax or Martyrs’ Fund', () => {
    const { lines, exclusions } = roster('2026-11', [intern()], { dayDivisor: 30 });
    expect(exclusions).toEqual([]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ employmentType: 'intern', payBasis: 'monthly', contractId: 'contract-i1' });
    expect(lines[0].terms).toMatchObject({ gross: 0, statutory: false, insured: true, paidDays: 30 });
  });

  it('pays the transportation allowance alone: nothing earned, nothing deducted', () => {
    const [line] = roster('2026-11', [intern()], { dayDivisor: 30 }).lines;
    const result = payrollLine(line.terms, EMPTY_PAYROLL_INPUTS);
    expect(result).toMatchObject({
      fixed: 0,
      variable: 0,
      earned: 0,
      allowances: 1500,
      taxableAllowances: 1500,
      insuredWage: 0,
      employeeInsurance: 0,
      employerInsurance: 0,
      monthlyTax: 0,
      martyrsFund: 0,
      deductions: 0,
      net: 1500,
      transfer: 1500,
      companyCost: 1500,
    });
    expect(result.warnings).toEqual([]);
  });

  it('pays the allowance for the days under the agreement in a part month', () => {
    // joined on the 16th of November: 15 of 30 days
    const late = intern({ joinDate: '2026-11-16', contracts: [agreement({ startDate: '2026-11-16', endDate: '2027-02-15' })] });
    const [line] = roster('2026-11', [late], { dayDivisor: 30 }).lines;
    expect(line.terms.paidDays).toBe(15);
    const result = payrollLine(line.terms, EMPTY_PAYROLL_INPUTS);
    expect(result).toMatchObject({ earned: 0, allowances: 750, net: 750, monthlyTax: 0, employeeInsurance: 0 });
  });

  it('has no salary for no-show or unpaid leave days to cut, nor a warning that the cut is capped', () => {
    const [line] = roster('2026-11', [intern()], { dayDivisor: 30 }).lines;
    const result = payrollLine(line.terms, { ...EMPTY_PAYROLL_INPUTS, noShowDays: 2, unpaidLeaveDays: 1 });
    expect(result).toMatchObject({ noShowCut: 0, unpaidLeaveCut: 0, earned: 0, net: 1500 });
    expect(result.warnings).toEqual([]);
  });

  it('pays an addition untaxed, as a freelancer’s, while a full-time employee’s is taxed', () => {
    const withBonus = (type: RosterEmployment['employmentType'], grossSalary: number) => {
      const [line] = roster('2026-11', [intern({ employmentType: type, contracts: [agreement({ grossSalary })] })], { dayDivisor: 30 }).lines;
      return payrollLine({ ...line.terms, adjustments: [{ id: 'a1', kind: 'addition', type: 'bonus', taxed: true, amount: 2000, reason: 'Launch' }] }, EMPTY_PAYROLL_INPUTS);
    };
    expect(withBonus('intern', 0)).toMatchObject({ earned: 2000, monthlyTax: 0, martyrsFund: 0, employeeInsurance: 0, net: 3500 });
    expect(withBonus('freelance', 0)).toMatchObject({ monthlyTax: 0, martyrsFund: 0, employeeInsurance: 0 });
    // under the labour law the same pay is insured and taxed
    const fullTime = withBonus('full_time', 12000);
    expect(fullTime.employeeInsurance).toBeGreaterThan(0);
    expect(fullTime.monthlyTax).toBeGreaterThan(0);
  });
});
