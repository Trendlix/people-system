import { describe, expect, it } from 'vitest';
import { allowanceRows, allowancesFrom, allowanceTerms, sameAllowances, treatmentText } from './allowances';
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
