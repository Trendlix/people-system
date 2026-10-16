import type { Role } from '@trendlix/shared';
import { describe, expect, it } from 'vitest';
import {
  adjustmentBody,
  adjustmentsHref,
  advanceOption,
  advancesFor,
  asksTaxed,
  byEmployee,
  canSeeAdjustments,
  changeable,
  entersAdjustments,
  linksAdvance,
  monthChoices,
  monthTotals,
  netText,
  readMonth,
  signedAmount,
  taxText,
  typeChoices,
  type AdjustmentRow,
  type AdvanceRow,
} from './adjustments';

// Additions / Deductions (owner, 17 October 2026: one-off amounts per employee and month). Today is 17 October 2026.
// Everyone here is invented.

const TODAY = '2026-10-17';
const as = (...roles: Role[]) => ({ roles });

let n = 0;
function row(over: Partial<AdjustmentRow> = {}): AdjustmentRow {
  n += 1;
  return {
    id: `a${n}`,
    employee: { id: 'e1', employeeCode: 'EMP-0001', name: 'Nour Ali' },
    month: '2026-10',
    kind: 'addition',
    type: 'bonus',
    taxed: true,
    amount: 1000,
    reason: 'Invented',
    advance: null,
    status: 'pending',
    lineId: null,
    appliedAt: null,
    createdBy: { id: 'u1', name: 'Mona Adel' },
    createdAt: `2026-10-0${Math.min(n, 9)}T10:00:00Z`,
    updatedAt: '2026-10-01T10:00:00Z',
    cancelledBy: null,
    cancelledAt: null,
    ...over,
  };
}

const advance = (over: Partial<AdvanceRow> = {}): AdvanceRow => ({
  id: 'l1',
  employee: { id: 'e1', employeeCode: 'EMP-0001', name: 'Nour Ali' },
  kind: 'loan',
  amount: 6000,
  givenOn: '2026-09-30',
  reason: 'Invented',
  plan: null,
  status: 'open',
  settledAt: null,
  settledBy: null,
  settledNote: null,
  createdBy: null,
  createdAt: '2026-09-30T10:00:00Z',
  recovered: 1000,
  planned: 1000,
  outstanding: 5000,
  unplanned: 4000,
  recoveries: [],
  ...over,
});

const form = (fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
};

describe('who sees them', () => {
  it('is HR, Finance and the CEO; HR enters them', () => {
    expect(canSeeAdjustments(as('finance'))).toBe(true);
    expect(canSeeAdjustments(as('ceo'))).toBe(true);
    expect(canSeeAdjustments(as('admin'))).toBe(false);
    expect(canSeeAdjustments(as('employee', 'manager'))).toBe(false);
    expect(entersAdjustments(as('hr'))).toBe(true);
    expect(entersAdjustments(as('finance', 'ceo'))).toBe(false);
  });
});

describe('the month', () => {
  it('is the address’s, this month without one or with one it can’t read', () => {
    expect(readMonth({ month: '2026-11' }, TODAY)).toBe('2026-11');
    expect(readMonth({}, TODAY)).toBe('2026-10');
    expect(readMonth({ month: '2026-13' }, TODAY)).toBe('2026-10');
    expect(readMonth({ month: ['2026-01', '2026-02'] }, TODAY)).toBe('2026-10');
    expect(adjustmentsHref('2026-10', TODAY)).toBe('/payroll/adjustments');
    expect(adjustmentsHref('2026-09', TODAY)).toBe('/payroll/adjustments?month=2026-09');
  });

  it('offers a year ahead back to a year ago, newest first, and the month shown when outside', () => {
    const months = monthChoices(TODAY, '2026-10');
    expect(months).toHaveLength(25);
    expect(months[0]).toEqual({ value: '2027-10', label: 'October 2027' });
    expect(months.at(-1)).toEqual({ value: '2025-10', label: 'October 2025' });
    expect(monthChoices(TODAY, '2024-01').at(-1)?.value).toBe('2024-01');
  });
});

describe('the month’s rows', () => {
  it('groups them by person, by name, the cancelled last and out of the sums', () => {
    const other = { id: 'e2', employeeCode: 'EMP-0002', name: 'Ahmed Samir' };
    const groups = byEmployee([
      row({ amount: 1000 }),
      row({ status: 'cancelled', amount: 999 }),
      row({ kind: 'deduction', type: 'penalty', taxed: false, amount: 250 }),
      row({ employee: other, type: 'reimbursement', taxed: false, amount: 320.75 }),
    ]);
    expect(groups.map((g) => g.employee.name)).toEqual(['Ahmed Samir', 'Nour Ali']);
    expect(groups[1].rows.map((r) => r.status)).toEqual(['pending', 'pending', 'cancelled']);
    expect(groups[1].sums).toMatchObject({ additions: 1000, deductions: 250, net: 750, count: 2 });
    expect(groups[0].sums).toMatchObject({ taxedAdditions: 0, untaxedAdditions: 320.75 });
  });

  it('totals the month: the people with one counted once, the cancelled left out', () => {
    const t = monthTotals([row({ amount: 100.1 }), row({ amount: 200.2 }), row({ employee: { id: 'e3', employeeCode: 'EMP-3', name: 'X' }, status: 'cancelled' })]);
    expect(t).toMatchObject({ additions: 300.3, people: 1, count: 2 });
  });

  it('says each one in words', () => {
    expect(taxText(row())).toBe('Taxed');
    expect(taxText(row({ type: 'reimbursement', taxed: false }))).toBe('Not taxed');
    expect(taxText(row({ kind: 'deduction', taxed: false }))).toBe('After tax');
    expect(signedAmount(row({ amount: 1500 }))).toBe('+EGP 1,500.00');
    expect(signedAmount(row({ kind: 'deduction', amount: 250.5 }))).toBe('−EGP 250.50');
    expect(netText(-1000)).toBe('−EGP 1,000.00');
    expect(netText(0.001)).toBe('EGP 0.00');
    expect(netText(12.5)).toBe('+EGP 12.50');
  });

  it('lets HR change a pending one while the month isn’t locked', () => {
    expect(changeable(row(), null)).toBe(true);
    expect(changeable(row({ status: 'applied' }), null)).toBe(false);
    expect(changeable(row({ status: 'cancelled' }), null)).toBe(false);
    expect(changeable(row(), 'The October 2026 payroll is with the CEO…')).toBe(false);
  });
});

describe('the form', () => {
  it('lists each kind’s types with whether they are taxed, and asks only what the type needs', () => {
    expect(typeChoices('addition').map((t) => [t.value, t.taxed])).toEqual([
      ['bonus', true],
      ['commission', true],
      ['incentive', true],
      ['correction', true],
      ['reimbursement', false],
      ['other', null],
    ]);
    expect(typeChoices('deduction').every((t) => t.taxed === false)).toBe(true);
    expect(asksTaxed('addition', 'other')).toBe(true);
    expect(asksTaxed('deduction', 'other')).toBe(false);
    expect(linksAdvance('deduction', 'loan_installment')).toBe('loan');
    expect(linksAdvance('deduction', 'penalty')).toBeNull();
  });

  it('offers the person’s open advances or loans of the kind', () => {
    const list = [advance(), advance({ id: 'l2', kind: 'advance' }), advance({ id: 'l3', employee: { id: 'e9', employeeCode: 'X', name: 'Y' } }), advance({ id: 'l4', status: 'settled' })];
    expect(advancesFor(list, 'e1', 'loan').map((a) => a.id)).toEqual(['l1']);
    expect(advancesFor(list, 'e1', null)).toEqual([]);
    expect(advanceOption(advance())).toBe('Loan of EGP 6,000.00, given 30/09/2026 · EGP 4,000.00 left to plan');
  });

  it('sends a new one with what its type needs', () => {
    expect(adjustmentBody(form({ employeeId: 'e1', kind: 'addition', month: '2026-10', type: 'bonus', amount: '1,500.50', reason: ' Target ' }), true)).toEqual({
      body: { employeeId: 'e1', kind: 'addition', month: '2026-10', type: 'bonus', amount: 1500.5, reason: 'Target' },
      errors: [],
    });
    const other = adjustmentBody(form({ employeeId: 'e1', kind: 'addition', month: '2026-10', type: 'other', taxed: 'no', amount: '10', reason: 'x' }), true);
    expect(other.body.taxed).toBe(false);
    const loan = adjustmentBody(form({ employeeId: 'e1', kind: 'deduction', month: '2026-10', type: 'loan_installment', amount: '1000', reason: 'x', advanceId: 'l1' }), true);
    expect(loan.body.advanceId).toBe('l1');
  });

  it('says what is missing before sending', () => {
    expect(adjustmentBody(form({}), true).errors).toEqual([
      'Choose the employee.',
      'Choose addition or deduction.',
      'Choose the month.',
      'Choose the type.',
      'Enter the amount in EGP, more than 0, e.g. 1500 or 1500.50.',
      'Say what it is for.',
    ]);
    expect(adjustmentBody(form({ employeeId: 'e1', kind: 'addition', month: '2026-10', type: 'other', amount: '0', reason: 'x' }), true).errors).toEqual([
      'Say whether this other addition is taxed.',
      'Enter the amount in EGP, more than 0, e.g. 1500 or 1500.50.',
    ]);
    expect(adjustmentBody(form({ employeeId: 'e1', kind: 'deduction', month: '2026-10', type: 'advance_recovery', amount: '1.005', reason: 'x' }), true).errors).toEqual([
      'Enter the amount in EGP, more than 0, e.g. 1500 or 1500.50.',
      'Choose the advance it recovers.',
    ]);
  });

  it('sends a change with the kind it has, and no advance once the type recovers none', () => {
    const { body, errors } = adjustmentBody(form({ currentKind: 'deduction', month: '2026-11', type: 'penalty', amount: '250', reason: 'Late' }), false);
    expect(errors).toEqual([]);
    expect(body).toEqual({ month: '2026-11', type: 'penalty', amount: 250, reason: 'Late', advanceId: null });
  });
});
