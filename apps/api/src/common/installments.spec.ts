import {
  changeInstallment,
  installmentLimit,
  installmentLimitWarning,
  installmentPlan,
  installmentPlanProblems,
  installmentPlanText,
  monthPlus,
  postponeInstallment,
  recurringDeductionProblems,
  recurringDue,
} from '@trendlix/shared';

// Installments and recurring deductions (packages/shared/src/installments.ts; owner, 18 October 2026: "in the
// deductions i might have a loan of a medical subscription or something that needs to be deducted as installments on
// the employee"): a plan made at once, moved or changed by HR; a recurring share until stopped; a warning past a share
// of the pay.

const total = (plan: readonly { amount: number }[]) => Math.round(plan.reduce((s, p) => s + p.amount * 100, 0)) / 100;

describe('monthPlus', () => {
  it('goes across years both ways', () => {
    expect(monthPlus('2026-11', 1)).toBe('2026-12');
    expect(monthPlus('2026-12', 1)).toBe('2027-01');
    expect(monthPlus('2026-01', -1)).toBe('2025-12');
    expect(monthPlus('2026-10', 26)).toBe('2028-12');
  });
});

describe('installmentPlan', () => {
  it('splits the total into equal months, the last taking the rounding', () => {
    expect(installmentPlan(10_000, 3, '2026-11')).toEqual([
      { month: '2026-11', amount: 3333.33 },
      { month: '2026-12', amount: 3333.33 },
      { month: '2027-01', amount: 3333.34 },
    ]);
    expect(installmentPlan(6000, 6, '2026-10').every((p) => p.amount === 1000)).toBe(true);
    expect(total(installmentPlan(1234.57, 7, '2026-10'))).toBe(1234.57);
  });

  it('says what is wrong with a plan as typed', () => {
    expect(installmentPlanProblems(6000, 6, '2026-11')).toEqual([]);
    expect(installmentPlanProblems(0, 6, '2026-11')).toHaveLength(1);
    expect(installmentPlanProblems(6000, 0, '2026-11')).toHaveLength(1);
    expect(installmentPlanProblems(6000, 61, '2026-11')).toHaveLength(1);
    expect(installmentPlanProblems(6000, 2.5, '2026-11')).toHaveLength(1);
    expect(installmentPlanProblems(6000, 6, '2026-13')).toHaveLength(1);
    expect(installmentPlanProblems(0.02, 3, '2026-11')).toEqual(['The total is too small to split into that many installments.']);
  });

  it('describes the plan', () => {
    expect(installmentPlanText(installmentPlan(6000, 6, '2026-11'))).toBe('6 installments of EGP 1,000.00');
    expect(installmentPlanText(installmentPlan(10_000, 3, '2026-11'))).toBe('3 installments: EGP 3,333.33 … 3,333.34');
    expect(installmentPlanText(installmentPlan(500, 1, '2026-11'))).toBe('1 installment of EGP 500.00');
  });
});

describe('postponeInstallment', () => {
  it('moves that month and every later one a month on, amounts as they were', () => {
    const plan = installmentPlan(3000, 3, '2026-11');
    expect(postponeInstallment(plan, '2026-12')).toEqual([
      { month: '2026-11', amount: 1000 },
      { month: '2027-01', amount: 1000 },
      { month: '2027-02', amount: 1000 },
    ]);
  });
});

describe('changeInstallment', () => {
  const plan = installmentPlan(6000, 6, '2026-11');

  it('lets the later ones share what is left, the total unchanged', () => {
    const result = changeInstallment(plan, '2026-12', 500);
    if (!('plan' in result)) throw new Error(result.problem);
    expect(result.plan.slice(0, 2)).toEqual([
      { month: '2026-11', amount: 1000 },
      { month: '2026-12', amount: 500 },
    ]);
    expect(result.plan.slice(2).map((p) => p.amount)).toEqual([1125, 1125, 1125, 1125]);
    expect(total(result.plan)).toBe(6000);
  });

  it('drops the later ones when the changed one takes all that is left', () => {
    const result = changeInstallment(plan, '2027-02', 3000);
    if (!('plan' in result)) throw new Error(result.problem);
    expect(result.plan.map((p) => p.month)).toEqual(['2026-11', '2026-12', '2027-01', '2027-02']);
    expect(total(result.plan)).toBe(6000);
  });

  it('adds one more month when the last one is lowered', () => {
    const result = changeInstallment(plan, '2027-04', 400);
    if (!('plan' in result)) throw new Error(result.problem);
    expect(result.plan.slice(-2)).toEqual([
      { month: '2027-04', amount: 400 },
      { month: '2027-05', amount: 600 },
    ]);
    expect(total(result.plan)).toBe(6000);
  });

  it('refuses more than what is left, nothing, or a month not waiting', () => {
    expect(changeInstallment(plan, '2027-03', 2000.01)).toEqual({ problem: 'The installment can be at most EGP 2,000.00, what is left from that month on.' });
    expect('problem' in changeInstallment(plan, '2026-11', 0)).toBe(true);
    expect('problem' in changeInstallment(plan, '2028-01', 100)).toBe(true);
  });
});

describe('recurring deductions', () => {
  it('are due from the start, to the end, until stopped', () => {
    const open = { startMonth: '2026-11', endMonth: null, stoppedFrom: null };
    expect(recurringDue(open, '2026-10')).toBe(false);
    expect(recurringDue(open, '2026-11')).toBe(true);
    expect(recurringDue(open, '2030-01')).toBe(true);
    expect(recurringDue({ ...open, endMonth: '2027-10' }, '2027-10')).toBe(true);
    expect(recurringDue({ ...open, endMonth: '2027-10' }, '2027-11')).toBe(false);
    expect(recurringDue({ ...open, stoppedFrom: '2027-03' }, '2027-02')).toBe(true);
    expect(recurringDue({ ...open, stoppedFrom: '2027-03' }, '2027-03')).toBe(false);
  });

  it('say what is wrong as typed', () => {
    expect(recurringDeductionProblems(350, '2026-11', null)).toEqual([]);
    expect(recurringDeductionProblems(350, '2026-11', '2027-10')).toEqual([]);
    expect(recurringDeductionProblems(0, '2026-11', null)).toHaveLength(1);
    expect(recurringDeductionProblems(350, '2026-11', '2026-10')).toEqual(["The last month can't be before the first."]);
  });
});

describe('the share of pay warning', () => {
  it('warns past the percent set, never without one', () => {
    expect(installmentLimit(20_000, 10)).toBe(2000);
    expect(installmentLimit(20_000, null)).toBeNull();
    expect(installmentLimitWarning(2000, 20_000, 10)).toBeNull();
    expect(installmentLimitWarning(2000.01, 20_000, 10)).toBe(
      "This month's installments, EGP 2,000.01, are more than 10% of the pay (EGP 2,000.00), the share set in Payroll Setup.",
    );
    expect(installmentLimitWarning(5000, 20_000, null)).toBeNull();
  });
});
