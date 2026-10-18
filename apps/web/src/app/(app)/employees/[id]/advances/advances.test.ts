import { describe, expect, it } from 'vitest';
import type { DeductionPlansView } from '../../../../../lib/types';
import type { AdvanceRow } from '../../../payroll/adjustments/adjustments';
import { formatEgp } from '../contracts/salary';
import { advanceTotals, hasPlans, plansFromAdvances, plansNote, plansTotals } from './advances';

// The employee's advances and loans on the Salary sub-tab (owner, 17 October 2026), and their Loans and Deductions
// (owner, 18 October 2026). Every figure is invented.

describe('advanceTotals', () => {
  it('adds what was given, and what is outstanding on the open ones only', () => {
    expect(
      advanceTotals([
        { amount: 6000, outstanding: 4000.5, status: 'open' },
        { amount: 500, outstanding: 0, status: 'settled' },
        // settled by HR with something left (paid back in cash): nothing outstanding any more
        { amount: 1000, outstanding: 300, status: 'settled' },
      ]),
    ).toEqual({ amount: 7500, outstanding: 4000.5, open: 1 });
    expect(advanceTotals([])).toEqual({ amount: 0, outstanding: 0, open: 0 });
  });
});

const plans = (over: Partial<DeductionPlansView> = {}): DeductionPlansView => ({
  advances: [
    { id: 'a1', kind: 'loan', reason: 'Medical', amount: 6000, recovered: 2000, outstanding: 4000, nextInstallment: { month: '2026-12', amount: 1000 }, status: 'open' },
    { id: 'a2', kind: 'advance', reason: 'Rent', amount: 500, recovered: 0, outstanding: 500.5, nextInstallment: null, status: 'open' },
  ],
  recurring: [
    { id: 'r1', name: 'Medical subscription (family)', amount: 350, startMonth: '2026-08', endMonth: null, status: 'running' },
    { id: 'r2', name: 'Gym', amount: 200, startMonth: '2027-01', endMonth: '2027-12', status: 'upcoming' },
  ],
  ...over,
});

describe('Loans and Deductions', () => {
  it('adds what is left to pay and what the recurring ones running take a month', () => {
    expect(plansTotals(plans())).toEqual({ outstanding: 4500.5, monthly: 350 });
    expect(plansNote(plans(), formatEgp)).toBe('EGP 4,500.50 left to pay · EGP 350.00 a month recurring');
    expect(plansNote(plans({ recurring: [] }), formatEgp)).toBe('EGP 4,500.50 left to pay');
    expect(plansNote(plans({ advances: [], recurring: [] }), formatEgp)).toBeUndefined();
  });

  it('has something to show with an open advance or a recurring deduction', () => {
    expect(hasPlans(plans())).toBe(true);
    expect(hasPlans(plans({ advances: [] }))).toBe(true);
    expect(hasPlans(plans({ advances: [], recurring: [] }))).toBe(false);
    expect(hasPlans(null)).toBe(false);
  });

  it('takes the open ones from HR’s list for an API from before the plans', () => {
    const row = (over: Partial<AdvanceRow>) =>
      ({ id: 'a1', kind: 'loan', reason: 'Medical', amount: 6000, recovered: 2000, outstanding: 4000, status: 'open', ...over }) as AdvanceRow;
    expect(plansFromAdvances([row({ nextInstallment: { month: '2026-12', amount: 1000 } }), row({ id: 'a2', status: 'settled' }), row({ id: 'a3' })])).toEqual([
      { id: 'a1', kind: 'loan', reason: 'Medical', amount: 6000, recovered: 2000, outstanding: 4000, nextInstallment: { month: '2026-12', amount: 1000 }, status: 'open' },
      { id: 'a3', kind: 'loan', reason: 'Medical', amount: 6000, recovered: 2000, outstanding: 4000, nextInstallment: null, status: 'open' },
    ]);
  });
});
