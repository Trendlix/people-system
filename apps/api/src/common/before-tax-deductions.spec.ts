import {
  beforeTaxMonthlyLimit,
  EMPTY_PAYROLL_INPUTS,
  isBeforeTax,
  lawRatesFor,
  lawRatesProblems,
  mayBeBeforeTax,
  monthlySalaryTax,
  normalLawRates,
  payrollLine,
  PAYROLL_RULE_DEFAULTS,
  resultBeforeTax,
  type PayrollAdjustmentItem,
  type PayrollTerms,
} from '@trendlix/shared';

// Deductions before tax (owner, 20 October 2026, asked whether the employee's medical share, a recurring deduction, is
// taken before or after tax: "Before Tax i think"): a Recurring deduction ticked "Deducted before tax" lowers the
// taxable pay before the income tax (never below 0, within the year's before-tax health insurance limit when set), then
// is taken from the net as every deduction is; social insurance and the Martyrs' Fund don't change. Invented figures.
//
// 12,000 gross, insured on 12,000 (1,320 insurance): taxable 10,680, a year's net income 108,160, tax 948.50 a month.
// Less 1,000 before tax: taxable 9,680, a year's 96,160, tax 748.50: 200 less, the 20% band.

const Y2026 = lawRatesFor(2026);

const salaried: PayrollTerms = {
  year: 2026,
  payBasis: 'monthly',
  gross: 12_000,
  basicPercent: 80,
  hourlyRate: null,
  allowances: [],
  paidDays: 30,
  statutory: true,
  insured: true,
  insuredWage: 12_000,
  hoursPerDay: 9,
};

const medical = (over: Partial<PayrollAdjustmentItem> = {}): PayrollAdjustmentItem => ({
  id: 'r1',
  kind: 'deduction',
  type: 'recurring',
  taxed: false,
  amount: 1000,
  reason: 'Medical subscription (family)',
  ...over,
});

const line = (items: PayrollAdjustmentItem[], terms: Partial<PayrollTerms> = {}, law = Y2026) =>
  payrollLine({ ...salaried, ...terms, adjustments: items }, EMPTY_PAYROLL_INPUTS, PAYROLL_RULE_DEFAULTS, law);

const without = payrollLine(salaried, EMPTY_PAYROLL_INPUTS);

describe('monthlySalaryTax: deductions before tax', () => {
  it('lowers the taxable pay by them before the tax, the Fund on the pay as before', () => {
    expect(monthlySalaryTax({ taxedPay: 12_000, employeeInsurance: 1_320, beforeTax: 1_000 }, 2026)).toEqual({
      healthInsurance: 0,
      monthlyTaxable: 9_680,
      annualNetIncome: 96_160,
      annualTax: 8_982,
      monthlyTax: 748.5,
      martyrsFund: 6,
      beforeTax: 1_000,
    });
    // without any (none, 0 or not a number): as it always was, without the field
    const plain = monthlySalaryTax({ taxedPay: 12_000, employeeInsurance: 1_320 }, 2026);
    expect(plain).toEqual({ healthInsurance: 0, monthlyTaxable: 10_680, annualNetIncome: 108_160, annualTax: 11_382, monthlyTax: 948.5, martyrsFund: 6 });
    for (const beforeTax of [0, -50, Number.NaN]) expect(monthlySalaryTax({ taxedPay: 12_000, employeeInsurance: 1_320, beforeTax }, 2026)).toEqual(plain);
  });

  it('never takes the taxable pay below 0, nor lowers one below 0 already', () => {
    expect(monthlySalaryTax({ taxedPay: 3_000, employeeInsurance: 330, beforeTax: 5_000 }, 2026)).toMatchObject({ monthlyTaxable: 0, beforeTax: 2_670, monthlyTax: 0, martyrsFund: 1.5 });
    expect(monthlySalaryTax({ taxedPay: -500, employeeInsurance: 1_100, beforeTax: 100 }, 2026)).toMatchObject({ monthlyTaxable: -1_600, beforeTax: 0, monthlyTax: 0 });
  });

  it("lowers it by at most a twelfth of the year's before-tax health insurance limit, when one is set", () => {
    const limited = { ...Y2026, beforeTaxHealthLimit: 6_000 };
    expect(monthlySalaryTax({ taxedPay: 12_000, employeeInsurance: 1_320, beforeTax: 1_000 }, limited)).toMatchObject({
      monthlyTaxable: 10_180,
      annualNetIncome: 102_160,
      monthlyTax: 848.5,
      beforeTax: 500,
    });
    // within the limit: all of it
    expect(monthlySalaryTax({ taxedPay: 12_000, employeeInsurance: 1_320, beforeTax: 400 }, limited)).toMatchObject({ monthlyTaxable: 10_280, beforeTax: 400 });
  });
});

describe('the before-tax health insurance limit a year (Payroll Setup)', () => {
  it('is a twelfth a month, down to the piaster; none set, no limit', () => {
    expect(beforeTaxMonthlyLimit({ beforeTaxHealthLimit: 6_000 })).toBe(500);
    expect(beforeTaxMonthlyLimit({ beforeTaxHealthLimit: 10_000 })).toBe(833.33);
    expect(beforeTaxMonthlyLimit({ beforeTaxHealthLimit: 100.05 })).toBe(8.33);
    expect(beforeTaxMonthlyLimit({ beforeTaxHealthLimit: null })).toBeNull();
    expect(beforeTaxMonthlyLimit({})).toBeNull();
    expect(beforeTaxMonthlyLimit(Y2026)).toBeNull(); // not built in: the accountant gives it
  });

  it('is an amount above 0 to the piaster, or empty; kept in the shared shape only when set', () => {
    expect(lawRatesProblems({ ...Y2026, beforeTaxHealthLimit: 6_000 })).toEqual([]);
    expect(lawRatesProblems({ ...Y2026, beforeTaxHealthLimit: null })).toEqual([]);
    for (const wrong of [0, -1, 10.005]) {
      expect(lawRatesProblems({ ...Y2026, beforeTaxHealthLimit: wrong })).toEqual([
        'Enter the before-tax health insurance limit a year as an amount above 0, to the piaster, or leave it empty for no limit.',
      ]);
    }
    expect(normalLawRates({ ...Y2026, beforeTaxHealthLimit: 6_000 }).beforeTaxHealthLimit).toBe(6_000);
    expect(normalLawRates({ ...Y2026, beforeTaxHealthLimit: null })).not.toHaveProperty('beforeTaxHealthLimit');
    expect(normalLawRates({ ...Y2026, beforeTaxHealthLimit: null })).toEqual(normalLawRates(Y2026));
  });
});

describe('payrollLine: a Recurring deduction before tax', () => {
  it('only a Recurring deduction may be; every other is after tax', () => {
    expect(mayBeBeforeTax('deduction', 'recurring')).toBe(true);
    for (const [kind, type] of [
      ['deduction', 'other'],
      ['deduction', 'loan_installment'],
      ['addition', 'recurring'],
      ['addition', 'bonus'],
    ]) {
      expect(mayBeBeforeTax(kind, type)).toBe(false);
    }
    expect(isBeforeTax(medical({ beforeTax: true }))).toBe(true);
    expect(isBeforeTax(medical())).toBe(false);
    expect(isBeforeTax(medical({ type: 'other', beforeTax: true }))).toBe(false);
  });

  it('lowers the taxable pay and so the income tax, then is taken from the net with the others', () => {
    const before = line([medical({ beforeTax: true })]);
    expect(without).toMatchObject({ employeeInsurance: 1_320, monthlyTaxable: 10_680, monthlyTax: 948.5, martyrsFund: 6, net: 9_725.5 });
    expect(before).toMatchObject({
      earned: without.earned,
      employeeInsurance: 1_320, // on the insured wage, unchanged
      employerInsurance: without.employerInsurance,
      monthlyTaxable: 9_680,
      annualNetIncome: 96_160,
      monthlyTax: 748.5,
      martyrsFund: 6, // on the taxed pay, unchanged
      adjustmentDeductions: 1_000,
      beforeTaxDeductions: 1_000,
      taxableLowered: 1_000,
      deductions: 3_074.5, // 1,320 + 748.50 + 6 + 1,000
      net: 8_925.5,
      companyCost: without.companyCost,
    });
    expect(before.transfer).toBe(before.net);
    expect(resultBeforeTax(before)).toEqual({ deductions: 1_000, lowered: 1_000 });
    // the tax it saves is the net's difference from the same deduction after tax
    const after = line([medical()]);
    expect(after).toMatchObject({ monthlyTaxable: 10_680, monthlyTax: 948.5, adjustmentDeductions: 1_000, net: 8_725.5 });
    expect(Math.round((before.net - after.net) * 100) / 100).toBe(200);
  });

  it('after tax, as it was: the line as without it but for the deduction, without the before-tax fields', () => {
    const after = line([medical()]);
    expect(after).not.toHaveProperty('beforeTaxDeductions');
    expect(after).not.toHaveProperty('taxableLowered');
    expect(after.monthlyTax).toBe(without.monthlyTax);
    expect(after.net).toBe(Math.round((without.net - 1_000) * 100) / 100);
    expect(resultBeforeTax(after)).toEqual({ deductions: 0, lowered: 0 });
    // a line without any, and one worked out before 20 October 2026: as they were
    expect(resultBeforeTax(without)).toEqual({ deductions: 0, lowered: 0 });
    expect(line([])).toEqual(without);
  });

  it('a before-tax flag on any other item is ignored: after tax', () => {
    const other = line([medical({ type: 'other', beforeTax: true })]);
    expect(other).toMatchObject({ monthlyTax: without.monthlyTax, adjustmentDeductions: 1_000 });
    expect(other).not.toHaveProperty('beforeTaxDeductions');
  });

  it('adds up the month’s before-tax ones, beside those after tax', () => {
    const both = line([medical({ beforeTax: true, amount: 600 }), medical({ id: 'r2', beforeTax: true, amount: 400, reason: 'Dental' }), medical({ id: 'r3', type: 'other', amount: 250 })]);
    expect(both).toMatchObject({ beforeTaxDeductions: 1_000, taxableLowered: 1_000, monthlyTax: 748.5, adjustmentDeductions: 1_250 });
    expect(both.net).toBe(8_675.5);
  });

  it('never takes the taxable pay below 0', () => {
    const low = line([medical({ beforeTax: true, amount: 5_000 })], { gross: 3_000, insuredWage: 3_000 });
    expect(low).toMatchObject({ employeeInsurance: 330, monthlyTaxable: 0, monthlyTax: 0, beforeTaxDeductions: 5_000, taxableLowered: 2_670, martyrsFund: 1.5 });
    // all of it still comes off the net
    expect(low.net).toBe(Math.round((3_000 - 330 - 1.5 - 5_000) * 100) / 100);
  });

  it("lowers it by at most a twelfth of the run's before-tax health insurance limit a year", () => {
    const limited = line([medical({ beforeTax: true })], {}, { ...Y2026, beforeTaxHealthLimit: 6_000 });
    expect(limited).toMatchObject({ beforeTaxDeductions: 1_000, taxableLowered: 500, monthlyTaxable: 10_180, monthlyTax: 848.5, adjustmentDeductions: 1_000 });
    expect(limited.net).toBe(Math.round((12_000 - 1_320 - 848.5 - 6 - 1_000) * 100) / 100);
  });

  it('a freelancer pays no tax: nothing to lower, the deduction still taken', () => {
    const freelance = line([medical({ beforeTax: true })], { statutory: false, insured: false });
    expect(freelance).toMatchObject({ monthlyTax: 0, monthlyTaxable: 0, beforeTaxDeductions: 1_000, taxableLowered: 0, net: 11_000 });
  });
});
