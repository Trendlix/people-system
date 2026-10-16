import { EMPTY_PAYROLL_INPUTS, PAYROLL_RULE_DEFAULTS, type PayrollResult, type PayrollTerms } from '@trendlix/shared';
import { describe, expect, it } from 'vitest';
import { breakdown, cutText, percentText } from './breakdown';

// an invented employee's month, with round figures
const terms: PayrollTerms = {
  year: 2026,
  payBasis: 'monthly',
  gross: 10_000,
  basicPercent: 80,
  hourlyRate: null,
  allowances: [{ name: 'Transport', amount: 500, taxable: true, insured: false }],
  paidDays: 30,
  statutory: true,
  insured: true,
  insuredWage: 10_000,
};

const result: PayrollResult = {
  fixed: 8000,
  variable: 2000,
  attendanceRatio: 0.85,
  attendanceScore: 0.85,
  kpiScore: 0.85,
  attendanceCut: 1200,
  kpiCut: 300,
  noShowCut: 666.67,
  overtime: 0,
  bonus: 0,
  commission: 1000,
  settlements: -100,
  earned: 8733.33,
  allowances: 500,
  taxableAllowances: 500,
  insuredWage: 10_000,
  employeeInsurance: 1100,
  employerInsurance: 1875,
  monthlyTaxable: 8133.33,
  annualNetIncome: 77_590,
  monthlyTax: 500,
  martyrsFund: 4.62,
  penaltyCut: 0,
  deductions: 1604.62,
  net: 7628.71,
  released: 1000,
  transfer: 6628.71,
  companyCost: 11_108.33,
  warnings: [],
};

const line = { payBasis: 'monthly' as const, terms, inputs: { ...EMPTY_PAYROLL_INPUTS, noShowDays: 1, workedHours: 238, expectedHours: 280 }, result };

const row = (key: string) => breakdown(line, PAYROLL_RULE_DEFAULTS).find((r) => r.key === key);

describe('a line’s breakdown', () => {
  it('goes through every step, in order', () => {
    expect(breakdown(line, PAYROLL_RULE_DEFAULTS).map((r) => r.label)).toEqual([
      'Fixed',
      'Variable',
      'Attendance',
      'Attendance cut',
      'KPI score',
      'KPI cut',
      'No-show cut',
      'Overtime',
      'Bonus',
      'Commission',
      'Settlements',
      'Earned',
      'Allowances',
      'Insured wage',
      'Social insurance',
      'Taxable pay',
      'Income tax',
      'Martyrs’ fund',
      'Penalties',
      'Deductions',
      'Net',
      'Released',
      'Transfer',
      'Company cost',
    ]);
  });

  it('shows every amount in EGP with two decimals, what is taken off with a minus', () => {
    expect(row('fixed')?.value).toBe('EGP 8,000.00');
    expect(row('attendanceCut')?.value).toBe('−EGP 1,200.00');
    expect(row('settlements')).toMatchObject({ value: '−EGP 100.00', kind: 'cut' });
    expect(row('overtime')?.value).toBe('EGP 0.00');
    expect(row('net')).toMatchObject({ value: 'EGP 7,628.71', kind: 'total' });
    expect(row('companyCost')?.note).toBe("Earned, allowances and the company's social insurance (EGP 1,875.00)");
  });

  it('explains the attendance, the KPIs, the no-shows and the insurance', () => {
    expect(row('attendance')).toMatchObject({ value: '85%', note: 'Below 90%: the fixed part follows it' });
    expect(row('kpi')?.value).toBe('85%');
    expect(row('noShowCut')?.note).toBe("1 day, each costing 2 days' pay");
    expect(row('employeeInsurance')?.note).toBe('11% of the insured wage');
    expect(row('allowances')?.note).toBe('Transport');
  });

  it('says when attendance isn’t tracked, the part month, and who has no insurance deducted', () => {
    const untracked = breakdown(
      { ...line, terms: { ...terms, paidDays: 19, insured: false }, result: { ...result, attendanceRatio: null, attendanceScore: 1 } },
      PAYROLL_RULE_DEFAULTS,
    );
    const find = (key: string) => untracked.find((r) => r.key === key);
    expect(find('attendance')).toMatchObject({ value: 'Not tracked', note: 'No hours typed: counts in full' });
    expect(find('fixed')?.note).toBe('80% of the gross, for 19 of 30 days');
    expect(find('employeeInsurance')?.note).toBe('Not registered with social insurance: nothing deducted');
    const freelance = breakdown({ ...line, terms: { ...terms, statutory: false } }, PAYROLL_RULE_DEFAULTS);
    expect(freelance.find((r) => r.key === 'employeeInsurance')?.note).toBe('Freelance: no social insurance, tax or Martyrs’ fund');
  });

  it('pays the hours at the rate for pay by the hour, with no split or cuts', () => {
    const hourly = breakdown(
      {
        payBasis: 'hourly',
        terms: { ...terms, payBasis: 'hourly', hourlyRate: 100 },
        inputs: { ...EMPTY_PAYROLL_INPUTS, workedHours: 120.5 },
        result: { ...result, fixed: 0, variable: 0, earned: 12_950, bonus: 0, commission: 1000, settlements: -100 },
      },
      PAYROLL_RULE_DEFAULTS,
    );
    expect(hourly.slice(0, 2).map((r) => r.label)).toEqual(['Pay for the hours', 'Bonus']);
    expect(hourly[0]).toMatchObject({ value: 'EGP 12,050.00', note: '120:30 hours at EGP 100.00 an hour' });
  });
});

describe('the figures', () => {
  it('shows a fraction as a percent and an amount taken off with a minus', () => {
    expect(percentText(0.9661)).toBe('96.61%');
    expect(percentText(1)).toBe('100%');
    expect(cutText(0)).toBe('EGP 0.00');
    expect(cutText(1100)).toBe('−EGP 1,100.00');
  });
});
