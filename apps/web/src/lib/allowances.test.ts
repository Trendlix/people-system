import { describe, expect, it } from 'vitest';
import { allowanceAmountText, allowanceRows, allowancesFrom, allowanceTerms, PER_ACCOUNT_MARK, sameAllowances, treatmentText } from './allowances';
import type { AllowanceType } from './types';

const kind = (id: string, taxable: boolean, insured: boolean): AllowanceType => ({
  id,
  nameEn: id,
  nameAr: id,
  taxable,
  insured,
  active: true,
  sortOrder: 0,
  inUse: false,
});

/** A form with the rows as AllowanceRows sends them: one kind and one amount per row, in order. */
function form(rows: [string, string][]): FormData {
  const fd = new FormData();
  for (const [id, amount] of rows) {
    fd.append('allowanceTypeId', id);
    fd.append('allowanceAmount', amount);
  }
  return fd;
}

describe('allowances on a form', () => {
  it('reads the rows for the API, leaving out empty ones', () => {
    const errors: string[] = [];
    expect(
      allowancesFrom(
        form([
          ['t', '1,000'],
          ['', ''],
          ['m', '٥٠٠.٥'],
        ]),
        errors,
      ),
    ).toEqual([
      { allowanceTypeId: 't', amount: 1000 },
      { allowanceTypeId: 'm', amount: 500.5 },
    ]);
    expect(errors).toEqual([]);
    expect(allowancesFrom(new FormData(), errors)).toEqual([]);
  });

  it('refuses a row without a kind, an amount that is not above 0, and a kind twice', () => {
    const missingKind: string[] = [];
    allowancesFrom(form([['', '300']]), missingKind);
    expect(missingKind).toEqual(['Choose the kind of each allowance, or remove the row.']);
    const badAmount: string[] = [];
    allowancesFrom(form([['t', '0'], ['m', 'abc']]), badAmount);
    expect(badAmount).toHaveLength(2);
    const twice: string[] = [];
    allowancesFrom(form([['t', '100'], ['t', '200']]), twice);
    expect(twice).toEqual(['Each kind of allowance can be added once.']);
  });

  it('refills the rows as typed after a refused save, else as saved', () => {
    expect(allowanceRows({ values: { allowanceTypeId: ['t', 'm'], allowanceAmount: ['1000', ''] } }, [{ allowanceTypeId: 'x', amount: 5 }])).toEqual([
      { allowanceTypeId: 't', amount: '1000' },
      { allowanceTypeId: 'm', amount: '' },
    ]);
    expect(allowanceRows({ values: { allowanceTypeId: 't', allowanceAmount: '750' } })).toEqual([{ allowanceTypeId: 't', amount: '750' }]);
    expect(allowanceRows({}, [{ allowanceTypeId: 'x', amount: 1500.5 }])).toEqual([{ allowanceTypeId: 'x', amount: '1500.5' }]);
    // a refused save of a form without allowances keeps the saved ones
    expect(allowanceRows({ values: { note: '' } }, [{ allowanceTypeId: 'x', amount: 5 }])).toEqual([{ allowanceTypeId: 'x', amount: '5' }]);
  });

  it('gives the rows ready to work out, with their kinds’ treatment', () => {
    const types = [kind('t', true, false), kind('h', true, true)];
    expect(
      allowanceTerms(
        [
          { allowanceTypeId: 't', amount: '1,000' },
          { allowanceTypeId: 'h', amount: '' },
          { allowanceTypeId: 'gone', amount: '200' },
          { allowanceTypeId: 'h', amount: '2000' },
        ],
        types,
      ),
    ).toEqual([
      { amount: 1000, taxable: true, insured: false },
      { amount: 2000, taxable: true, insured: true },
    ]);
  });

  it('tells whether the rows are the saved allowances, in any order', () => {
    const saved = [
      { allowanceTypeId: 't', amount: 1000 },
      { allowanceTypeId: 'm', amount: 500 },
    ];
    expect(
      sameAllowances(
        [
          { allowanceTypeId: 'm', amount: '500' },
          { allowanceTypeId: 't', amount: '1,000' },
        ],
        saved,
      ),
    ).toBe(true);
    expect(sameAllowances([{ allowanceTypeId: 't', amount: '1000' }], saved)).toBe(false);
    expect(
      sameAllowances(
        [
          { allowanceTypeId: 't', amount: '1000' },
          { allowanceTypeId: 'm', amount: '600' },
        ],
        saved,
      ),
    ).toBe(false);
    expect(sameAllowances([], [])).toBe(true);
  });

  it('words a kind’s treatment', () => {
    expect(treatmentText({ taxable: true, insured: false })).toBe('Taxed, not insured');
    expect(treatmentText({ taxable: false, insured: true })).toBe('Not taxed, insured');
  });
});

describe('an allowance paid per client account (owner, 25 October 2026: "if an employee has an allowance per account")', () => {
  const accounts: AllowanceType = { ...kind('acc', true, false), basis: 'per_account' };

  it('sends the kind alone, no amount, and still refuses a fixed row without one', () => {
    const errors: string[] = [];
    expect(
      allowancesFrom(
        form([
          ['t', '1,000'],
          ['acc', PER_ACCOUNT_MARK],
        ]),
        errors,
      ),
    ).toEqual([{ allowanceTypeId: 't', amount: 1000 }, { allowanceTypeId: 'acc' }]);
    expect(errors).toEqual([]);
    const missing: string[] = [];
    allowancesFrom(form([['t', '']]), missing);
    expect(missing).toHaveLength(1);
    // a row with no kind and only the mark is an empty row
    expect(allowancesFrom(form([['', PER_ACCOUNT_MARK]]), missing)).toEqual([]);
  });

  it('refills it with no amount, as sent or as saved (0), and it matches the saved one', () => {
    expect(allowanceRows({ values: { allowanceTypeId: ['acc'], allowanceAmount: [PER_ACCOUNT_MARK] } })).toEqual([{ allowanceTypeId: 'acc', amount: '' }]);
    expect(allowanceRows({}, [{ allowanceTypeId: 'acc', amount: 0 }, { allowanceTypeId: 't', amount: 500 }])).toEqual([
      { allowanceTypeId: 'acc', amount: '' },
      { allowanceTypeId: 't', amount: '500' },
    ]);
    expect(sameAllowances([{ allowanceTypeId: 'acc', amount: '' }], [{ allowanceTypeId: 'acc', amount: 0 }])).toBe(true);
  });

  it('adds nothing to the net worked out, and reads "Per client account assigned"', () => {
    expect(allowanceTerms([{ allowanceTypeId: 'acc', amount: '' }, { allowanceTypeId: 't', amount: '500' }], [accounts, kind('t', false, false)])).toEqual([
      { amount: 500, taxable: false, insured: false },
    ]);
    const money = (n: number) => `EGP ${n}`;
    expect(allowanceAmountText({ amount: 0, basis: 'per_account' }, money)).toBe('Per client account assigned');
    expect(allowanceAmountText({ amount: 500, basis: 'fixed' }, money)).toBe('EGP 500');
    expect(allowanceAmountText({ amount: 500 }, money)).toBe('EGP 500');
  });
});
