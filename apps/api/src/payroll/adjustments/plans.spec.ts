import { changeInstallment, installmentLimitWarning, installmentPlan, postponeInstallment, type PayrollResult, type PayrollTerms } from '@trendlix/shared';
import { installmentWarning } from '../views.js';
import { byMonth, installmentReason, isInstallmentReason, lastMonthOf, lineInstallments, planChanges, recurringStatus, renumbered } from './plans.js';

// Installments and recurring deductions as the API keeps them (owner, 18 October 2026: "in the deductions i might have a
// loan of a medical subscription or something that needs to be deducted as installments on the employee. how will it be
// managed?"): the reasons the installments are made with, what a plan's change does to the deductions saved, where a
// recurring deduction stands, and the share of pay warning on a run's line. Every figure is invented.

const saved = (plan: { month: string; amount: number }[]) => plan.map((p, i) => ({ id: `d${i + 1}`, ...p }));

describe('installmentReason', () => {
  it('names the installment by its type and its place in the plan; only those it made are its', () => {
    expect(installmentReason('loan', 2, 6)).toBe('Loan installment 2 of 6');
    expect(installmentReason('advance', 1, 3)).toBe('Advance recovery 1 of 3');
    expect(isInstallmentReason('Loan installment 12 of 12')).toBe(true);
    expect(isInstallmentReason('Car loan, 2 of 6')).toBe(false); // HR's own
    expect(isInstallmentReason('Loan installment 2 of 6 (moved)')).toBe(false);
  });
});

describe('planChanges', () => {
  const plan = saved(installmentPlan(6000, 6, '2026-11'));

  it('a postponed one: it and every later one move a month on, nothing made or cancelled', () => {
    const changes = planChanges(plan, postponeInstallment(plan, '2027-01'));
    expect(changes.update.map((u) => [u.id, u.month, u.amount])).toEqual([
      ['d3', '2027-02', 1000],
      ['d4', '2027-03', 1000],
      ['d5', '2027-04', 1000],
      ['d6', '2027-05', 1000],
    ]);
    expect([changes.create, changes.cancel]).toEqual([[], []]);
  });

  it('a changed one: the later ones share what is left, updated in place', () => {
    const changed = changeInstallment(plan, '2026-12', 1500);
    if ('problem' in changed) throw new Error(changed.problem);
    const changes = planChanges(plan, changed.plan);
    expect(changes.update.map((u) => [u.id, u.amount])).toEqual([
      ['d2', 1500],
      ['d3', 875],
      ['d4', 875],
      ['d5', 875],
      ['d6', 875],
    ]);
    expect([changes.create, changes.cancel]).toEqual([[], []]);
  });

  it('a lowered last one: one more installment the month after, made', () => {
    const changed = changeInstallment(plan, '2027-04', 400);
    if ('problem' in changed) throw new Error(changed.problem);
    const changes = planChanges(plan, changed.plan);
    expect(changes.update).toEqual([{ id: 'd6', month: '2027-04', amount: 400 }]);
    expect(changes.create).toEqual([{ month: '2027-05', amount: 600 }]);
    expect(changes.cancel).toEqual([]);
  });

  it('one taking all that is left: the later ones cancelled', () => {
    const changed = changeInstallment(plan, '2027-02', 3000);
    if ('problem' in changed) throw new Error(changed.problem);
    const changes = planChanges(plan, changed.plan);
    expect(changes.update).toEqual([{ id: 'd4', month: '2027-02', amount: 3000 }]);
    expect(changes.cancel).toEqual(['d5', 'd6']);
  });

  it('nothing changed: nothing to do', () => {
    expect(planChanges(plan, plan)).toEqual({ update: [], create: [], cancel: [] });
  });
});

describe('renumbered', () => {
  it('numbers the installments not cancelled in month order, on the pending ones the plan named', () => {
    const rows = [
      { id: 'a', month: '2026-11', status: 'applied', reason: 'Loan installment 1 of 6' },
      { id: 'b', month: '2026-12', status: 'pending', reason: 'Loan installment 2 of 6' },
      { id: 'c', month: '2027-01', status: 'cancelled', reason: 'Loan installment 3 of 6' },
      { id: 'd', month: '2027-02', status: 'pending', reason: 'Loan installment 4 of 6' },
      { id: 'e', month: '2027-03', status: 'pending', reason: 'Paid in two, as agreed' },
    ];
    // a, b, d, e counted: 4 in all; the applied one and HR's own keep theirs
    expect([...renumbered('loan', rows)]).toEqual([
      ['b', 'Loan installment 2 of 4'],
      ['d', 'Loan installment 3 of 4'],
    ]);
    expect(renumbered('loan', [{ id: 'x', month: '2026-11', status: 'pending', reason: 'Loan installment 1 of 1' }]).size).toBe(0);
  });
});

describe('byMonth', () => {
  it('sums the pending and applied ones by month to the piaster, the cancelled left out', () => {
    expect(
      byMonth([
        { month: '2026-12', amount: 0.1, status: 'pending' },
        { month: '2026-11', amount: 1000, status: 'applied' },
        { month: '2026-12', amount: 0.2, status: 'pending' },
        { month: '2027-01', amount: 500, status: 'cancelled' },
      ]),
    ).toEqual({ '2026-11': 1000, '2026-12': 0.3 });
    expect(byMonth([])).toEqual({});
  });
});

describe('recurring deductions', () => {
  const medical = { startMonth: '2026-11', endMonth: null, stoppedFrom: null };

  it('has its last month: the end month, or the month before it was stopped, the earlier', () => {
    expect(lastMonthOf(medical)).toBeNull();
    expect(lastMonthOf({ endMonth: '2027-06', stoppedFrom: null })).toBe('2027-06');
    expect(lastMonthOf({ endMonth: '2027-06', stoppedFrom: '2027-01' })).toBe('2026-12');
    expect(lastMonthOf({ endMonth: '2027-01', stoppedFrom: '2027-06' })).toBe('2027-01');
    expect(lastMonthOf({ endMonth: null, stoppedFrom: '2027-01' })).toBe('2026-12');
  });

  it('is upcoming before its first month, running to its last, then ended', () => {
    expect(recurringStatus(medical, '2026-10')).toBe('upcoming');
    expect(recurringStatus(medical, '2026-11')).toBe('running');
    expect(recurringStatus(medical, '2030-01')).toBe('running');
    expect(recurringStatus({ ...medical, endMonth: '2026-12' }, '2026-12')).toBe('running');
    expect(recurringStatus({ ...medical, endMonth: '2026-12' }, '2027-01')).toBe('ended');
    // stopped from this month: no longer taken
    expect(recurringStatus({ ...medical, stoppedFrom: '2027-01' }, '2027-01')).toBe('ended');
    expect(recurringStatus({ ...medical, stoppedFrom: '2027-01' }, '2026-12')).toBe('running');
    // stopped before it began: never taken
    expect(recurringStatus({ ...medical, stoppedFrom: '2026-11' }, '2026-10')).toBe('ended');
  });
});

describe('the share of pay warning on a run’s line', () => {
  const item = (type: string, amount: number) => ({ id: type, kind: 'deduction' as const, type: type as 'other', taxed: false, amount, reason: 'Invented' });
  const line = (items: ReturnType<typeof item>[], earned = 9000, allowances = 1000) => ({
    terms: { adjustments: items } as unknown as PayrollTerms,
    result: { earned, allowances, warnings: [] } as unknown as PayrollResult,
  });

  it('counts the advances’ recoveries and the loans’ installments only', () => {
    expect(lineInstallments([item('loan_installment', 700), item('advance_recovery', 400.5), item('recurring', 350), item('penalty', 99)])).toBe(1100.5);
    expect(lineInstallments([{ kind: 'addition', type: 'loan_installment', amount: 5 }])).toBe(0);
  });

  it('warns when they pass the share of the month’s gross (the pay earned and the allowances), else not', () => {
    // 10% of 10,000 is 1,000
    expect(installmentWarning(line([item('loan_installment', 1000)]), 10)).toBeNull();
    expect(installmentWarning(line([item('loan_installment', 1000.01)]), 10)).toBe(installmentLimitWarning(1000.01, 10000, 10));
    expect(installmentWarning(line([item('loan_installment', 1000.01)]), 10)).toMatch(/^This month's installments, EGP 1,000\.01, are more than 10% of the pay \(EGP 1,000\.00\)/);
    // no percent set: no warning; recurring deductions don't count
    expect(installmentWarning(line([item('loan_installment', 5000)]), null)).toBeNull();
    expect(installmentWarning(line([item('recurring', 5000)]), 10)).toBeNull();
  });
});
