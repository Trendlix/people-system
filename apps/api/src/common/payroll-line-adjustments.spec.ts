import { EMPTY_PAYROLL_INPUTS, monthlySalaryTax, payrollLine, resultAdjustments, type PayrollAdjustmentItem, type PayrollTerms } from '@trendlix/shared';

// A month's additions and deductions on a payroll line (owner, 17 October 2026: Additions / Deductions, one-off amounts
// per employee and month): the taxed additions in the pay earned (so in the gross and the taxed pay), the untaxed ones
// added after tax, the deductions taken after tax with the others. Invented figures throughout.

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

let n = 0;
const item = (over: Partial<PayrollAdjustmentItem>): PayrollAdjustmentItem => ({
  id: `adj-${++n}`,
  kind: 'addition',
  type: 'bonus',
  taxed: true,
  amount: 1000,
  reason: 'Invented',
  ...over,
});

const without = payrollLine(salaried, EMPTY_PAYROLL_INPUTS);

describe('a line’s additions and deductions', () => {
  it('none: the line as before, with the sums at 0', () => {
    expect(resultAdjustments(without)).toEqual({ taxed: 0, untaxed: 0, deductions: 0 });
    expect(payrollLine({ ...salaried, adjustments: [] }, EMPTY_PAYROLL_INPUTS)).toEqual(without);
    // a line worked out before 17 October 2026 has none of the fields
    expect(resultAdjustments({})).toEqual({ taxed: 0, untaxed: 0, deductions: 0 });
  });

  it('a taxed addition is pay earned: in the gross and the taxed pay, so the tax and the Martyrs’ Fund take their share', () => {
    const line = payrollLine({ ...salaried, adjustments: [item({ amount: 2000 })] }, EMPTY_PAYROLL_INPUTS);
    expect(line.additionsTaxed).toBe(2000);
    expect(line.earned).toBe(without.earned + 2000);
    // social insurance stays on the insured wage
    expect(line.employeeInsurance).toBe(without.employeeInsurance);
    const tax = monthlySalaryTax({ taxedPay: 14_000, employeeInsurance: line.employeeInsurance }, 2026);
    expect(line.monthlyTax).toBe(tax.monthlyTax);
    expect(line.martyrsFund).toBe(tax.martyrsFund);
    expect(line.net).toBe(Math.round((14_000 - line.deductions) * 100) / 100);
    expect(line.companyCost).toBe(Math.round((14_000 + line.employerInsurance) * 100) / 100);
  });

  it('an untaxed addition is added after tax: the tax is the line’s without it', () => {
    const line = payrollLine({ ...salaried, adjustments: [item({ type: 'reimbursement', taxed: false, amount: 320.75 })] }, EMPTY_PAYROLL_INPUTS);
    expect(line).toMatchObject({ additionsUntaxed: 320.75, additionsTaxed: 0, earned: without.earned, monthlyTax: without.monthlyTax, deductions: without.deductions });
    expect(line.net).toBe(Math.round((without.net + 320.75) * 100) / 100);
    expect(line.transfer).toBe(line.net);
    // it costs the company too
    expect(line.companyCost).toBe(Math.round((without.companyCost + 320.75) * 100) / 100);
  });

  it('a deduction is taken after tax with the others: the tax as without it', () => {
    const line = payrollLine(
      {
        ...salaried,
        adjustments: [item({ kind: 'deduction', type: 'penalty', taxed: false, amount: 250 }), item({ kind: 'deduction', type: 'loan_installment', taxed: false, amount: 1000 })],
      },
      EMPTY_PAYROLL_INPUTS,
    );
    expect(line).toMatchObject({ adjustmentDeductions: 1250, monthlyTax: without.monthlyTax, earned: without.earned, companyCost: without.companyCost });
    expect(line.deductions).toBe(Math.round((without.deductions + 1250) * 100) / 100);
    expect(line.net).toBe(Math.round((without.net - 1250) * 100) / 100);
  });

  it('all together, with what was already paid out taken from the transfer', () => {
    const line = payrollLine(
      {
        ...salaried,
        adjustments: [
          item({ amount: 1000 }),
          item({ type: 'reimbursement', taxed: false, amount: 500 }),
          item({ kind: 'deduction', type: 'damage_loss', taxed: false, amount: 300 }),
        ],
      },
      { ...EMPTY_PAYROLL_INPUTS, released: 2000 },
    );
    expect(resultAdjustments(line)).toEqual({ taxed: 1000, untaxed: 500, deductions: 300 });
    expect(line.net).toBe(Math.round((line.earned + line.allowances + 500 - line.deductions) * 100) / 100);
    expect(line.transfer).toBe(Math.round((line.net - 2000) * 100) / 100);
  });

  it('a freelancer’s taxed addition pays no tax, as their pay doesn’t', () => {
    const freelance = payrollLine({ ...salaried, statutory: false, insured: false, adjustments: [item({ amount: 1500 })] }, EMPTY_PAYROLL_INPUTS);
    expect(freelance).toMatchObject({ earned: 13_500, monthlyTax: 0, martyrsFund: 0, net: 13_500 });
  });
});
