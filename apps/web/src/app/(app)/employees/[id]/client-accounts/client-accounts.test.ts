import { describe, expect, it } from 'vitest';
import { accountHref, clientAccountsNote, periodText, showsClientAccounts, type EmployeeClientAccount } from './client-accounts';

// A person's client accounts on their profile (owner, 25 October 2026). Every account here is invented.

const account = (over: Partial<EmployeeClientAccount> = {}): EmployeeClientAccount => ({
  id: 'x',
  accountId: 'acme',
  fromDate: '2026-10-01',
  toDate: null,
  amount: 1500,
  note: null,
  standing: 'current',
  account: { id: 'acme', nameEn: 'Acme Foods', nameAr: null, code: 'ACME-01', status: 'active' },
  ...over,
});

describe('client accounts on a profile', () => {
  it('words the dates held', () => {
    expect(periodText(account())).toBe('From 01/10/2026');
    expect(periodText(account({ toDate: '2026-12-31' }))).toBe('01/10/2026 to 31/12/2026');
  });

  it('shows for those who see everything, else only with accounts', () => {
    expect(showsClientAccounts({ assignments: [], seesAmounts: true, full: true })).toBe(true);
    expect(showsClientAccounts({ assignments: [], seesAmounts: false, full: false })).toBe(false);
    expect(showsClientAccounts({ assignments: [account()], seesAmounts: false, full: false })).toBe(true);
  });

  it('counts them by where they stand, and links an account', () => {
    expect(clientAccountsNote({ assignments: [account(), account({ standing: 'past' }), account({ standing: 'current' })] })).toBe('2 current, 1 ended');
    expect(clientAccountsNote({ assignments: [account({ standing: 'upcoming' })] })).toBe('1 to come');
    expect(clientAccountsNote({ assignments: [] })).toBeUndefined();
    expect(accountHref('acme')).toBe('/clients/accounts?account=acme');
  });
});
