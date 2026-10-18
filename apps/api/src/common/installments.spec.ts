import {
  addByMonth,
  changeInstallment,
  damageLimit,
  damageLimitWarning,
  deductionBaseOf,
  deductionLimit,
  deductionLimitWarning,
  fewestInstallments,
  installmentLimit,
  installmentLimitProblem,
  installmentLimitWarning,
  installmentPlan,
  installmentPlanProblems,
  installmentPlanText,
  isInstallmentLimitPercent,
  monthOverInstallmentLimit,
  monthPlus,
  planLimitProblem,
  postponeInstallment,
  recurringDeductionProblems,
  recurringDue,
} from '@trendlix/shared';

// Installments and recurring deductions (packages/shared/src/installments.ts; owner, 18 October 2026: "in the
// deductions i might have a loan of a medical subscription or something that needs to be deducted as installments on
// the employee"): a plan made at once, moved or changed by HR; a recurring share until stopped; and the Labour Law's
// limits (owner, 18 October 2026, after reading the law: "Block above 10%", "Warn above 25%, record the consent"):
// installments at most 10% of the wage, refused past it; recurring deductions past 25% after tax, insurance and
// installments warned of; damage past 5 days' wage warned of. Every figure is invented.

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

describe('the law’s limit on installments (Art. 113: 10% of the wage, refused past it)', () => {
  it('is 10% of the wage, or the lower limit set, to the piaster below', () => {
    expect(installmentLimit(20_000, 10)).toBe(2000);
    expect(installmentLimit(9999.99, 10)).toBe(999.99);
    expect(installmentLimit(20_000, 7.5)).toBe(1500);
    expect(installmentLimit(20_000, null)).toBeNull();
  });

  it('may be set from 1 to 10 percent, never above the law’s', () => {
    for (const ok of [1, 5.5, 10]) expect(isInstallmentLimitPercent(ok)).toBe(true);
    for (const bad of [0, 0.5, 10.01, 20, 100, 1.234, '10', null, NaN]) expect(isInstallmentLimitPercent(bad)).toBe(false);
  });

  it('refuses a month past it, naming the month, the total and the limit, and saying what to do', () => {
    expect(installmentLimitProblem('2026-11', 900, 9000, 10)).toBeNull();
    expect(installmentLimitProblem('2026-11', 900.01, 9000, 10)).toBe(
      'In November 2026 the installments of advances and loans would be EGP 900.01, more than 10% of the gross pay of EGP 9,000.00 (EGP 900.00), the most the law allows (Labour Law Art. 113). Spread it over more months.',
    );
    // a lower limit set in Payroll Setup says so
    expect(installmentLimitProblem('2027-01', 800, 10_000, 5, 'Do less.')).toBe(
      'In January 2027 the installments of advances and loans would be EGP 800.00, more than 5% of the gross pay of EGP 10,000.00 (EGP 500.00), the limit set in Payroll Setup (the law allows at most 10%, Labour Law Art. 113). Do less.',
    );
  });

  it('a change takes a month over it only when the month rises past it', () => {
    const before = { '2026-11': 1000, '2026-12': 1000 };
    // 1,000 a month on 9,000 is over 900 already: moving or lowering never refused
    expect(monthOverInstallmentLimit(before, { '2026-11': 1000, '2026-12': 500, '2027-01': 500 }, 9000, 10)).toBeNull();
    expect(monthOverInstallmentLimit(before, { '2026-11': 1000, '2026-12': 1000.01 }, 9000, 10)).toEqual({ month: '2026-12', installments: 1000.01 });
    expect(monthOverInstallmentLimit({}, { '2027-02': 950, '2027-01': 901 }, 9000, 10)).toEqual({ month: '2027-01', installments: 901 });
    expect(monthOverInstallmentLimit({}, { '2027-01': 900 }, 9000, 10)).toBeNull();
  });

  it('adds installments by month', () => {
    expect(addByMonth({ '2026-12': 100.1 }, [{ month: '2026-11', amount: 50 }, { month: '2026-12', amount: 0.2 }])).toEqual({ '2026-11': 50, '2026-12': 100.3 });
    expect(addByMonth({ '2026-11': 1 }, { '2026-11': 2 })).toEqual({ '2026-11': 3 });
  });

  it('finds the fewest months a plan fits in, with the employee’s other installments', () => {
    // 6,000 on 9,000: at most 900 a month, so 7 months (857.14 …)
    expect(fewestInstallments(6000, '2026-11', 9000, 10, {})).toBe(7);
    // another loan's 500 a month to January leaves 400 then: 6,000 needs months enough for the first three to be 400 at most
    expect(fewestInstallments(6000, '2026-11', 9000, 10, { '2026-11': 500, '2026-12': 500, '2027-01': 500 })).toBe(15);
    // more than the months tried
    expect(fewestInstallments(6000, '2026-11', 9000, 10, {}, 7)).toBe(8);
    // another takes it all: none
    expect(fewestInstallments(6000, '2026-11', 9000, 10, { '2026-11': 900 })).toBeNull();
  });

  it('refuses a new plan past it, saying how many months would do', () => {
    expect(planLimitProblem(installmentPlan(6000, 7, '2026-11'), {}, 9000, 10)).toBeNull();
    expect(planLimitProblem(installmentPlan(6000, 6, '2026-11'), {}, 9000, 10)).toBe(
      'In November 2026 the installments of advances and loans would be EGP 1,000.00, more than 10% of the gross pay of EGP 9,000.00 (EGP 900.00), the most the law allows (Labour Law Art. 113). Spread it over more months: 7 monthly installments would keep every month within the limit.',
    );
    // 600 in one month with 800 there already: 6 months of 100 would do
    expect(planLimitProblem(installmentPlan(600, 1, '2026-12'), { '2026-12': 800 }, 9000, 10)).toMatch(/would be EGP 1,400\.00, .* 6 monthly installments would keep every month within the limit\.$/);
    // another loan takes the first month's 900 already: no number of months starting then will do
    expect(planLimitProblem(installmentPlan(600, 2, '2026-12'), { '2026-12': 900 }, 9000, 10)).toMatch(
      /^In December 2026 the installments of advances and loans would be EGP 1,200\.00, .* Start it later, once the other installments leave room, or record a smaller amount\.$/,
    );
    expect(planLimitProblem([], {}, 9000, 10)).toBeNull();
  });

  it('warns on the run’s line when the month’s pay leaves them past it, never without a percent', () => {
    expect(installmentLimitWarning(2000, 20_000, 10)).toBeNull();
    expect(installmentLimitWarning(2000.01, 20_000, 10)).toBe(
      "This month's installments of advances and loans, EGP 2,000.01, are more than 10% of the pay (EGP 2,000.00), the most the law allows (Labour Law Art. 113).",
    );
    expect(installmentLimitWarning(1500, 20_000, 5)).toBe(
      "This month's installments of advances and loans, EGP 1,500.00, are more than 5% of the pay (EGP 1,000.00), the limit set in Payroll Setup (the law allows at most 10%, Labour Law Art. 113).",
    );
    expect(installmentLimitWarning(5000, 20_000, null)).toBeNull();
  });
});

describe('the law’s limit on other deductions (Art. 114: 25% after tax, insurance and installments, a warning)', () => {
  // 10,000 gross, about 1,000 tax, 1,100 insurance and 900 installments: 7,000 left, of which 25% is 1,750
  const base = { pay: 10_000, tax: 1000, insurance: 1100, installments: 900 };

  it('is worked out after the tax, the insurance and the installments, never below 0', () => {
    expect(deductionBaseOf(base)).toBe(7000);
    expect(deductionLimit(base)).toBe(1750);
    expect(deductionBaseOf({ ...base, installments: 9000 })).toBe(0);
    expect(deductionLimit({ pay: 1000.03, tax: 0, insurance: 0, installments: 0 })).toBe(250);
  });

  it('warns past it, for the run’s line or a form’s month, never a block', () => {
    expect(deductionLimitWarning(1750, base)).toBeNull();
    expect(deductionLimitWarning(0, base)).toBeNull();
    expect(deductionLimitWarning(1750.01, base)).toBe(
      "This month's recurring deductions, EGP 1,750.01, are more than 25% (EGP 1,750.00) of the pay after income tax, social insurance and installments (EGP 7,000.00): the law allows at most 25% (Labour Law Art. 114).",
    );
    expect(deductionLimitWarning(2000, base, '2026-11')).toBe(
      'In November 2026 the recurring deductions would be EGP 2,000.00, more than 25% (EGP 1,750.00) of the pay after income tax, social insurance and installments (EGP 7,000.00): the law allows at most 25% (Labour Law Art. 114).',
    );
  });
});

describe('the law’s limit on damage (Art. 151: 5 days’ wage a month, a warning)', () => {
  it('is 5 days of the monthly gross, by the payroll’s days in a month', () => {
    expect(damageLimit(9000, 30)).toBe(1500);
    expect(damageLimit(10_000, 30)).toBe(1666.66);
    expect(damageLimit(0, 30)).toBeNull();
    expect(damageLimit(9000, 0)).toBeNull();
  });

  it('warns past it', () => {
    expect(damageLimitWarning(1500, 9000, 30)).toBeNull();
    expect(damageLimitWarning(1500.01, 9000, 30)).toBe(
      "This month's damage or loss deductions, EGP 1,500.01, are more than 5 days' wage (EGP 1,500.00: the gross of EGP 9,000.00 ÷ 30 days × 5): the law allows at most 5 days' wage a month (Labour Law Art. 151).",
    );
    expect(damageLimitWarning(5000, 0, 30)).toBeNull();
  });
});
