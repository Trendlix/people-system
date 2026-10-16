import {
  firstJanuaryFrom,
  form2Problem,
  insuredWageDate,
  insuredWageVersion,
  isFirstOfMonth,
  nextFirstOfMonth,
  payChangeOf,
  payDifference,
  payStage,
  raiseEffectiveProblem,
  samePay,
  type PayTerms,
} from '@trendlix/shared';

// The rules of a raise during a contract (owner's decisions, 16 October 2026; packages/shared raises.ts): the effective
// date on the 1st of a month within the term, the insured wage from the next January unless amended in Form 2, and
// where a version stands.

describe('the effective date', () => {
  const term = { startDate: '2026-03-01', endDate: '2027-02-28' };

  it('is the 1st of a month, so each payroll month has one salary', () => {
    expect(isFirstOfMonth('2026-11-01')).toBe(true);
    expect(isFirstOfMonth('2026-11-15')).toBe(false);
    expect(raiseEffectiveProblem('2026-11-15', term)).toMatch(/1st of a month/);
    expect(raiseEffectiveProblem('2026-11-01', term)).toBeNull();
    expect(nextFirstOfMonth('2026-10-16')).toBe('2026-11-01');
    expect(nextFirstOfMonth('2026-12-31')).toBe('2027-01-01');
  });

  it('is after the contract in force started, and not after it ends (then it is a renewal)', () => {
    expect(raiseEffectiveProblem('2026-03-01', term)).toBe('The contract in force started on 01/03/2026: a raise takes effect on a later 1st of a month.');
    expect(raiseEffectiveProblem('2026-02-01', term)).toMatch(/started on 01\/03\/2026/);
    expect(raiseEffectiveProblem('2027-02-01', term)).toBeNull();
    expect(raiseEffectiveProblem('2027-03-01', term)).toBe(
      'The contract in force ends on 28/02/2027: a raise from after then is a renewal with the new pay. Renew the contract instead.',
    );
    // a contract with no end (from before every contract was fixed-term) takes any later 1st
    expect(raiseEffectiveProblem('2030-01-01', { startDate: '2026-03-01', endDate: null })).toBeNull();
  });
});

describe('the insured wage after a raise', () => {
  it('follows the new pay from the next 1 January (Law 148/2019 sets it each year), at once for a raise from 1 January', () => {
    expect(firstJanuaryFrom('2026-11-01')).toBe('2027-01-01');
    expect(firstJanuaryFrom('2026-02-01')).toBe('2027-01-01');
    expect(firstJanuaryFrom('2027-01-01')).toBe('2027-01-01');
    expect(insuredWageDate('2026-11-01', null)).toBe('2027-01-01');
  });

  it('or from the date given with the Form 2 filed', () => {
    expect(insuredWageDate('2026-11-01', '2026-12-01')).toBe('2026-12-01');
    expect(form2Problem('2026-12-01', '2026-11-01')).toBeNull();
    expect(form2Problem('2026-11-01', '2026-11-01')).toBeNull();
    expect(form2Problem('2027-01-01', '2026-11-01')).toBeNull();
  });

  it('Form 2: the 1st of a month, from the effective date, not after the next January', () => {
    expect(form2Problem('2026-12-15', '2026-11-01')).toMatch(/1st of a month/);
    expect(form2Problem('2026-10-01', '2026-11-01')).toBe("Form 2 can't change the insured wage before the raise takes effect, on 01/11/2026.");
    expect(form2Problem('2027-02-01', '2026-11-01')).toBe('From 01/01/2027 the insured wage follows the new pay anyway (it is set each January): choose a date up to then.');
  });

  it("a month stands on the version before a raise until the raise's insured-wage date, back through raises in a row", () => {
    const v1 = { version: 1, insuredWageFrom: null, gross: 10000 };
    const v2 = { version: 2, insuredWageFrom: '2027-01-01', gross: 12000 };
    const v3 = { version: 3, insuredWageFrom: '2027-01-01', gross: 13000 };
    const all = [v1, v2, v3];
    expect(insuredWageVersion(v2, all, '2026-11-01')).toBe(v1);
    expect(insuredWageVersion(v2, all, '2027-01-01')).toBe(v2);
    expect(insuredWageVersion(v3, all, '2026-12-01')).toBe(v1);
    expect(insuredWageVersion(v3, all, '2027-02-01')).toBe(v3);
    // Form 2 filed for the second raise: from its date
    const v2Filed = { ...v2, insuredWageFrom: '2026-12-01' };
    expect(insuredWageVersion(v3, [v1, v2Filed, v3], '2026-12-01')).toBe(v2Filed);
    expect(insuredWageVersion(v3, [v1, v2Filed, v3], '2026-11-01')).toBe(v1);
    // not a raise, or the one before it not there: as it is
    expect(insuredWageVersion(v1, all, '2026-01-01')).toBe(v1);
    expect(insuredWageVersion(v2, [v2], '2026-11-01')).toBe(v2);
  });
});

describe('the pay', () => {
  const pay: PayTerms = { payBasis: 'monthly', grossSalary: 12000, hourlyRate: null, hoursPerWeek: null, basicPercent: 80, allowances: [{ allowanceTypeId: 't', amount: 500 }] };

  it('is the same with the same basis, gross, basic share and allowances, in any order', () => {
    expect(samePay(pay, { ...pay, allowances: [{ allowanceTypeId: 't', amount: 500.0 }] })).toBe(true);
    expect(samePay(pay, { ...pay, grossSalary: 12000.01 })).toBe(false);
    expect(samePay(pay, { ...pay, basicPercent: 70 })).toBe(false);
    expect(samePay(pay, { ...pay, allowances: [] })).toBe(false);
    expect(samePay(pay, { ...pay, allowances: [{ allowanceTypeId: 't', amount: 600 }] })).toBe(false);
    const two = { ...pay, allowances: [{ allowanceTypeId: 'a', amount: 1 }, { allowanceTypeId: 'b', amount: 2 }] };
    expect(samePay(two, { ...two, allowances: [...two.allowances].reverse() })).toBe(true);
    expect(samePay({ ...pay, payBasis: 'hourly', hourlyRate: 100, hoursPerWeek: 20 }, { ...pay, payBasis: 'hourly', hourlyRate: 110, hoursPerWeek: 20 })).toBe(false);
  });

  it('changes by an amount and a percent of what it was', () => {
    expect(payDifference(12000, 13500)).toEqual({ amount: 1500, percent: 12.5 });
    expect(payDifference(9000, 9999.99)).toEqual({ amount: 999.99, percent: 11.1 });
    expect(payDifference(12000, 11000)).toEqual({ amount: -1000, percent: -8.3 });
    expect(payDifference(0, 100)).toEqual({ amount: 100, percent: null });
  });
});

describe('where a version stands', () => {
  it('signed, replaced or ended once signed; before, the CEO’s step', () => {
    expect(payStage({ status: 'active', approval: 'approved' })).toBe('signed');
    expect(payStage({ status: 'superseded', approval: null })).toBe('replaced');
    expect(payStage({ status: 'ended', approval: null })).toBe('ended');
    expect(payStage({ status: 'draft', approval: 'pending_ceo' })).toBe('pending_ceo');
    expect(payStage({ status: 'draft', approval: 'approved' })).toBe('approved');
    expect(payStage({ status: 'draft', approval: 'draft', returnedReason: 'Too high for the band' })).toBe('returned');
    expect(payStage({ status: 'draft', approval: 'draft', returnedReason: null })).toBe('draft');
    expect(payStage({ status: 'draft', approval: null })).toBe('draft');
  });

  it('is the hire, an amendment, a new contract within the term, or a renewal after it', () => {
    expect(payChangeOf({ kind: 'contract', startDate: '2026-03-01' }, null)).toBe('hired');
    expect(payChangeOf({ kind: 'amendment', startDate: '2026-11-01' }, { endDate: '2027-02-28' })).toBe('amendment');
    expect(payChangeOf({ kind: 'contract', startDate: '2026-11-01' }, { endDate: '2027-02-28' })).toBe('new_contract');
    expect(payChangeOf({ kind: 'contract', startDate: '2027-03-01' }, { endDate: '2027-02-28' })).toBe('renewal');
    expect(payChangeOf({ kind: 'contract', startDate: '2027-03-01' }, { endDate: null })).toBe('new_contract');
  });
});
