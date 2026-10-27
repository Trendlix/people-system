import {
  accountsAllowance,
  accountsAllowanceLabel,
  accountsAllowanceLine,
  accountsAllowanceLabelAr,
  accountShareText,
  calendarDaysInMonth,
  changedDays,
  daysHeldIn,
  isPerAccount,
  lockedAmong,
  lockedMonthRefusal,
  OVERLAP_REFUSAL,
  periodsOverlap,
  perAccountText,
  ZERO_SALARY_MESSAGE,
  zeroSalaryProblem,
} from '@trendlix/shared';

// Client accounts and the accounts allowance (owner, 25 October 2026: "if an employee has an allowance per account, how
// can we deal with it?"; asked, a "Client accounts list", the rate "variable", a part month "By days"). Everyone and
// every account here is invented.

const acme = (over: Partial<{ from: string; to: string | null; amount: number }> = {}) => ({ accountId: 'a1', name: 'Acme Foods', from: '2026-01-01', to: null, amount: 1500, ...over });
const beta = (over: Partial<{ from: string; to: string | null; amount: number }> = {}) => ({ accountId: 'a2', name: 'Beta Labs', from: '2026-01-01', to: null, amount: 900, ...over });

describe('the days held in a month', () => {
  it('counts calendar days: 28 to 31 a month', () => {
    expect(['2026-02', '2028-02', '2026-04', '2026-10'].map(calendarDaysInMonth)).toEqual([28, 29, 30, 31]);
    expect(() => calendarDaysInMonth('2026-13')).toThrow(RangeError);
  });

  it('a whole month, a start and an end in it, and none', () => {
    expect(daysHeldIn('2026-10', { from: '2026-01-01', to: null })).toEqual({ days: 31, from: '2026-10-01', to: '2026-10-31' });
    expect(daysHeldIn('2026-10', { from: '2026-10-15', to: null })).toEqual({ days: 17, from: '2026-10-15', to: '2026-10-31' });
    expect(daysHeldIn('2026-10', { from: '2026-09-01', to: '2026-10-10' })).toEqual({ days: 10, from: '2026-10-01', to: '2026-10-10' });
    expect(daysHeldIn('2026-10', { from: '2026-10-05', to: '2026-10-05' }).days).toBe(1);
    expect(daysHeldIn('2026-10', { from: '2026-11-01', to: null })).toEqual({ days: 0, from: null, to: null });
    expect(daysHeldIn('2026-10', { from: '2026-01-01', to: '2026-09-30' }).days).toBe(0);
  });

  it('only within the parts given (the days under a contract with the per-account allowance)', () => {
    const within = [{ from: '2026-10-01', to: '2026-10-14' }];
    expect(daysHeldIn('2026-10', { from: '2026-10-10', to: null }, within)).toEqual({ days: 5, from: '2026-10-10', to: '2026-10-14' });
    expect(daysHeldIn('2026-10', { from: '2026-10-15', to: null }, within).days).toBe(0);
  });
});

describe('the month’s accounts allowance, by days', () => {
  it('a whole month pays the amount a month', () => {
    expect(accountsAllowance('2026-10', [acme()])).toEqual({
      amount: 1500,
      accounts: [{ accountId: 'a1', name: 'Acme Foods', from: '2026-10-01', to: '2026-10-31', days: 31, monthDays: 31, monthly: 1500, amount: 1500 }],
    });
  });

  it('a start mid-month: the days held ÷ the month’s days', () => {
    // 17 of 31 days of 1,500: 822.58
    expect(accountsAllowance('2026-10', [acme({ from: '2026-10-15' })]).amount).toBe(822.58);
  });

  it('an end mid-month', () => {
    // 10 of 30 days of 1,500
    expect(accountsAllowance('2026-09', [acme({ to: '2026-09-10' })]).accounts[0]).toMatchObject({ days: 10, monthDays: 30, amount: 500 });
  });

  it('two accounts: their sum, each to the piaster, by the accounts’ names', () => {
    const r = accountsAllowance('2026-10', [beta({ from: '2026-10-24' }), acme()]);
    // Beta 8 of 31 days of 900 = 232.258… → 232.26
    expect(r.accounts.map((a) => [a.name, a.days, a.amount])).toEqual([
      ['Acme Foods', 31, 1500],
      ['Beta Labs', 8, 232.26],
    ]);
    expect(r.amount).toBe(1732.26);
  });

  it('February has 28 days (29 in a leap year)', () => {
    expect(accountsAllowance('2027-02', [acme({ from: '2027-02-15' })]).accounts[0]).toMatchObject({ days: 14, monthDays: 28, amount: 750 });
    expect(accountsAllowance('2028-02', [acme({ from: '2028-02-15' })]).accounts[0]).toMatchObject({ days: 15, monthDays: 29, amount: 775.86 });
  });

  it('31-day months divide by 31, not the payroll’s 30', () => {
    // a single day of a 31-day month: 1,550 ÷ 31
    expect(accountsAllowance('2026-12', [acme({ amount: 1550, from: '2026-12-31' })]).amount).toBe(50);
    expect(accountsAllowance('2026-11', [acme({ amount: 1500, from: '2026-11-30' })]).amount).toBe(50);
  });

  it('rounds each account to the piaster, and the sum is theirs', () => {
    // 1/3 of 100 three times: 33.33 each, 99.99 in all (not 100)
    const thirds = ['a', 'b', 'c'].map((id) => ({ accountId: id, name: id, from: '2026-09-21', to: null, amount: 300 }));
    const r = accountsAllowance('2026-09', thirds);
    expect(r.accounts.map((a) => a.amount)).toEqual([100, 100, 100]);
    const odd = ['a', 'b', 'c'].map((id) => ({ accountId: id, name: id, from: '2026-09-30', to: null, amount: 1000 }));
    // a day of 30 of 1,000 = 33.333… → 33.33 each
    expect(accountsAllowance('2026-09', odd)).toMatchObject({ amount: 99.99 });
  });

  it('leaves out an account not held in the month', () => {
    expect(accountsAllowance('2026-10', [acme({ from: '2026-11-01' }), beta({ to: '2026-09-30' })])).toEqual({ amount: 0, accounts: [] });
  });
});

describe('the rules of an assignment', () => {
  it('two periods overlap when they share a day; an open end runs on', () => {
    expect(periodsOverlap({ from: '2026-01-01', to: '2026-03-31' }, { from: '2026-03-31', to: null })).toBe(true);
    expect(periodsOverlap({ from: '2026-01-01', to: '2026-03-30' }, { from: '2026-03-31', to: null })).toBe(false);
    expect(periodsOverlap({ from: '2026-05-01', to: null }, { from: '2026-01-01', to: null })).toBe(true);
    expect(periodsOverlap({ from: '2026-05-01', to: null }, { from: '2026-01-01', to: '2026-04-30' })).toBe(false);
    expect(OVERLAP_REFUSAL('Mona Invented', 'Acme Foods', { from: '2026-10-01', to: null })).toBe(
      'Mona Invented is already on Acme Foods from 01/10/2026: change that assignment, or date this one outside it.',
    );
  });

  it('the days a change changes: new, amount, start moved, end moved', () => {
    const was = { from: '2026-09-01', to: null, amount: 1000 };
    expect(changedDays(null, was)).toEqual([{ from: '2026-09-01', to: '9999-12-31' }]);
    expect(changedDays(was, null)).toEqual([{ from: '2026-09-01', to: '9999-12-31' }]);
    expect(changedDays(was, { ...was, amount: 1200 })).toHaveLength(2);
    expect(changedDays(was, { ...was, from: '2026-10-01' })).toEqual([{ from: '2026-09-01', to: '2026-09-30' }]);
    expect(changedDays(was, { ...was, to: '2026-10-15' })).toEqual([{ from: '2026-10-16', to: '9999-12-31' }]);
    expect(changedDays({ ...was, to: '2026-10-15' }, { ...was, to: '2026-11-20' })).toEqual([{ from: '2026-10-16', to: '2026-11-20' }]);
    expect(changedDays(was, { ...was })).toEqual([]);
  });

  it('the latest locked month among the days, and the refusal’s words', () => {
    const locked = [
      { month: '2026-08', status: 'paid' as const },
      { month: '2026-09', status: 'approved' as const },
    ];
    expect(lockedAmong([{ from: '2026-08-15', to: '9999-12-31' }], locked)).toEqual({ month: '2026-09', status: 'approved' });
    expect(lockedAmong([{ from: '2026-10-01', to: '9999-12-31' }], locked)).toBeNull();
    expect(lockedMonthRefusal('2026-09', 'approved', 'start')).toBe("September 2026's payroll is approved: date it from October, or add the difference in Additions.");
    expect(lockedMonthRefusal('2026-12', 'paid', 'start')).toBe("December 2026's payroll is paid: date it from January, or add the difference in Additions.");
    expect(lockedMonthRefusal('2026-09', 'pending_ceo', 'end')).toBe("September 2026's payroll is with the CEO: end it on 30/09/2026 or later, or deduct the difference in Additions / Deductions.");
    expect(lockedMonthRefusal('2026-09', 'approved', 'amount')).toContain('end this assignment on 30/09/2026 and add one from October at the new amount');
  });
});

describe('in words', () => {
  it('the count, in English and Arabic, and an account’s share', () => {
    expect(accountsAllowanceLabel('Accounts allowance', 1)).toBe('Accounts allowance (1 account)');
    expect(accountsAllowanceLabel('Accounts allowance', 3)).toBe('Accounts allowance (3 accounts)');
    expect([1, 2, 3, 11].map((n) => accountsAllowanceLabelAr('بدل حسابات', n))).toEqual(['بدل حسابات (حساب واحد)', 'بدل حسابات (حسابان)', 'بدل حسابات (3 حسابات)', 'بدل حسابات (11 حسابًا)']);
    expect(accountShareText({ name: 'Acme Foods', days: 31, monthDays: 31 }, '1,500.00')).toBe('Acme Foods 1,500.00');
    expect(accountShareText({ name: 'Beta Labs', days: 8, monthDays: 31 }, '232.26')).toBe('Beta Labs 232.26 (8 of 31 days)');
    expect([isPerAccount({ basis: 'per_account' }), isPerAccount({ basis: 'fixed' }), isPerAccount({})]).toEqual([true, false, false]);
  });
});

// The contract's own amount per account (owner, 27 October 2026, of someone "paid per account only" at 3,000 an account:
// "why cant i add rate per account?"; he chose "On the contract"), and a salary of 0 with it.
describe('the contract’s amount per account', () => {
  const month = { from: '2026-10-01', to: '2026-10-31' };

  it('stands for each assignment’s amount on the days under that contract', () => {
    const r = accountsAllowance('2026-10', [acme(), beta()], [{ ...month, rate: 3000 }]);
    expect(r.amount).toBe(6000);
    expect(r.accounts.map((a) => [a.name, a.monthly, a.amount])).toEqual([
      ['Acme Foods', 3000, 3000],
      ['Beta Labs', 3000, 3000],
    ]);
  });

  it('none set: each assignment’s amount, as before', () => {
    expect(accountsAllowance('2026-10', [acme()], [{ ...month, rate: null }]).amount).toBe(1500);
    expect(accountsAllowance('2026-10', [acme()], [month]).amount).toBe(1500);
  });

  it('a raise mid-month: each part at its own amount, by the days held in it', () => {
    // 14 days at the assignment's 1,500, then 17 at the contract's 3,000: 677.42 + 1,645.16
    const r = accountsAllowance('2026-10', [acme()], [
      { from: '2026-10-01', to: '2026-10-14', rate: null },
      { from: '2026-10-15', to: '2026-10-31', rate: 3000 },
    ]);
    expect(r.accounts[0]).toMatchObject({ days: 31, monthly: 3000, amount: 2322.58 });
  });

  it('a part held: by the days held, at the contract’s amount', () => {
    // 8 of 31 days of 3,000
    expect(accountsAllowance('2026-10', [beta({ from: '2026-10-24' })], [{ ...month, rate: 3000 }]).amount).toBe(774.19);
  });

  it('in words: the contract and its line', () => {
    const money = (n: number) => `EGP ${n.toFixed(2)}`;
    expect(perAccountText(3000, money)).toBe('EGP 3000.00 per client account assigned');
    expect(perAccountText(null, money)).toBe('Per client account assigned');
    expect(perAccountText(3000, money, 'ar')).toBe('EGP 3000.00 عن كل حساب عميل يُسند إليه');
    expect(accountsAllowanceLine(3000, money)).toBe('An accounts allowance of EGP 3000.00 for each client account assigned');
    expect(accountsAllowanceLine(undefined, money)).toBe('An accounts allowance for each client account assigned, at the amount set for that account');
  });

  it('a salary of 0 only with a per-account allowance', () => {
    expect(zeroSalaryProblem(0, [{ basis: 'per_account' }])).toBeNull();
    expect(zeroSalaryProblem(0, [{ basis: 'fixed' }])).toBe(ZERO_SALARY_MESSAGE);
    expect(zeroSalaryProblem(0, [])).toBe(ZERO_SALARY_MESSAGE);
    expect(zeroSalaryProblem(0.001, [])).toBe(ZERO_SALARY_MESSAGE);
    expect(zeroSalaryProblem(5000, [])).toBeNull();
  });
});
