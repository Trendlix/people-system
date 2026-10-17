import {
  ADDITION_TYPES,
  adjustmentSums,
  adjustmentTaxed,
  adjustmentTypeLabel,
  advanceBalance,
  daysBetween,
  DEDUCTION_TYPES,
  isAdjustmentDays,
  isAdjustmentType,
  isDaysType,
  isRecovered,
  recoveredKind,
  sumAmounts,
  type AdjustmentAmount,
} from '@trendlix/shared';

// Additions / Deductions and advances and loans (owner, 17 October 2026: one-off amounts per employee and month, not
// recurring; additions taxed but for a reimbursement, other as HR chooses; deductions all after tax; an advance or a
// loan recovered by the deductions linked to it, the applied ones counting).

const add = (amount: number, taxed: boolean, status: AdjustmentAmount['status'] = 'pending'): AdjustmentAmount => ({ kind: 'addition', taxed, amount, status });
const cut = (amount: number, status: AdjustmentAmount['status'] = 'pending'): AdjustmentAmount => ({ kind: 'deduction', taxed: false, amount, status });

describe('the types', () => {
  it('are the owner’s lists, each of its kind', () => {
    // the Bonus (days) and Penalty (days), and a Correction taken off (17 October 2026: the grid's columns moved here)
    expect(ADDITION_TYPES).toEqual(['bonus', 'bonus_days', 'commission', 'incentive', 'correction', 'reimbursement', 'other']);
    expect(DEDUCTION_TYPES).toEqual(['penalty', 'penalty_days', 'correction', 'damage_loss', 'advance_recovery', 'loan_installment', 'other']);
    expect(isAdjustmentType('addition', 'bonus')).toBe(true);
    expect(isAdjustmentType('addition', 'penalty')).toBe(false);
    expect(isAdjustmentType('deduction', 'other')).toBe(true);
    expect(isAdjustmentType('deduction', 'reimbursement')).toBe(false);
    expect(adjustmentTypeLabel('addition', 'other')).toBe('Other addition');
    expect(adjustmentTypeLabel('deduction', 'damage_loss')).toBe('Damage or loss');
    expect(adjustmentTypeLabel('deduction', 'unknown')).toBe('unknown');
    expect([adjustmentTypeLabel('addition', 'bonus_days'), adjustmentTypeLabel('deduction', 'penalty_days'), adjustmentTypeLabel('deduction', 'correction')]).toEqual([
      'Bonus (days)',
      'Penalty (days)',
      'Correction',
    ]);
    expect(isAdjustmentType('deduction', 'bonus_days')).toBe(false);
    expect(isAdjustmentType('addition', 'penalty_days')).toBe(false);
  });

  it('takes the Bonus (days) and Penalty (days) in whole or half days, up to a month’s', () => {
    expect(['bonus_days', 'penalty_days', 'bonus', 'correction'].map(isDaysType)).toEqual([true, true, false, false]);
    expect([0.5, 1, 2.5, 31].every(isAdjustmentDays)).toBe(true);
    expect([0, -1, 0.25, 31.5, Number.NaN, '2', null].some(isAdjustmentDays)).toBe(false);
  });

  it('taxes every addition but a reimbursement; Other as chosen; never a deduction', () => {
    for (const type of ['bonus', 'bonus_days', 'commission', 'incentive', 'correction']) expect(adjustmentTaxed('addition', type, undefined)).toBe(true);
    expect(adjustmentTaxed('addition', 'reimbursement', undefined)).toBe(false);
    expect(adjustmentTaxed('addition', 'other', true)).toBe(true);
    expect(adjustmentTaxed('addition', 'other', false)).toBe(false);
    expect(adjustmentTaxed('addition', 'other', null)).toBeNull(); // not chosen: refused
    expect(adjustmentTaxed('addition', 'penalty', true)).toBeNull(); // not an addition's type
    for (const type of DEDUCTION_TYPES) expect(adjustmentTaxed('deduction', type, true)).toBe(false);
  });

  it('links an advance’s recovery to an advance and a loan’s installment to a loan, nothing else', () => {
    expect(recoveredKind('deduction', 'advance_recovery')).toBe('advance');
    expect(recoveredKind('deduction', 'loan_installment')).toBe('loan');
    expect(recoveredKind('deduction', 'penalty')).toBeNull();
    expect(recoveredKind('addition', 'advance_recovery')).toBeNull();
  });
});

describe('adjustmentSums', () => {
  it('splits the additions into taxed and untaxed, sums the deductions, and leaves out the cancelled ones', () => {
    const sums = adjustmentSums([add(1000, true), add(250.5, false), add(0.1, true, 'applied'), cut(300), cut(0.2, 'applied'), add(5000, true, 'cancelled'), cut(99, 'cancelled')]);
    expect(sums).toEqual({ taxedAdditions: 1000.1, untaxedAdditions: 250.5, additions: 1250.6, deductions: 300.2, net: 950.4, count: 5 });
  });

  it('is all zero for none, and the net can be below 0', () => {
    expect(adjustmentSums([])).toEqual({ taxedAdditions: 0, untaxedAdditions: 0, additions: 0, deductions: 0, net: 0, count: 0 });
    expect(adjustmentSums([cut(1500), add(500, true)]).net).toBe(-1000);
  });

  it('adds to the piaster without the noise of fractions', () => {
    expect(sumAmounts([0.1, 0.2])).toBe(0.3);
    expect(sumAmounts([1000.01, 2000.02, -0.03])).toBe(3000);
  });
});

describe('advanceBalance', () => {
  it('counts the applied recoveries as recovered and the pending ones as planned', () => {
    const b = advanceBalance(6000, [
      { amount: 1000, status: 'applied' },
      { amount: 1000, status: 'applied' },
      { amount: 1000, status: 'pending' },
      { amount: 1000, status: 'cancelled' },
    ]);
    expect(b).toEqual({ recovered: 2000, planned: 1000, outstanding: 4000, unplanned: 3000 });
    expect(isRecovered(b)).toBe(false);
  });

  it('is recovered once nothing is outstanding, never below 0', () => {
    expect(advanceBalance(1500.5, [{ amount: 1500.5, status: 'applied' }])).toEqual({ recovered: 1500.5, planned: 0, outstanding: 0, unplanned: 0 });
    expect(isRecovered(advanceBalance(1000, [{ amount: 1200, status: 'applied' }]))).toBe(true);
    expect(advanceBalance(1000, [])).toEqual({ recovered: 0, planned: 0, outstanding: 1000, unplanned: 1000 });
  });
});

describe('daysBetween', () => {
  it('counts the whole days since the end date, never below 0', () => {
    expect(daysBetween('2026-09-30', '2026-10-17')).toBe(17);
    expect(daysBetween('2026-10-17', '2026-10-17')).toBe(0);
    expect(daysBetween('2026-10-20', '2026-10-17')).toBe(0);
    expect(daysBetween('2025-12-31', '2026-03-01')).toBe(60);
  });
});
