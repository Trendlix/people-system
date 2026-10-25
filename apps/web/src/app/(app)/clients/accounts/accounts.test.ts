import { describe, expect, it } from 'vitest';
import {
  accountBody,
  accountFacts,
  amountField,
  amountText,
  assignable,
  assignmentBody,
  endAccountBody,
  endAssignmentBody,
  focusedAccount,
  hiddenText,
  peopleCount,
  peopleOf,
  periodText,
  seesClientAccounts,
  sortedAccounts,
  standingBadge,
  statusBadge,
  tierBody,
  tierDefault,
  type PersonRow,
} from './accounts';
import type { AssignmentView, ClientAccountView } from './types';

// Clients → Client Accounts (owner, 25 October 2026: "if an employee has an allowance per account, how can we deal with
// it?"): who sees the page, the forms as the API takes them, and what the rows say. Everyone and every account here is
// invented.

const form = (fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return fd;
};

const assignment = (over: Partial<AssignmentView> = {}): AssignmentView => ({
  id: 'as1',
  accountId: 'ac1',
  employee: { id: 'e1', employeeCode: 'EMP-0012', fullNameEn: 'Lina Invented' },
  employmentId: 'em1',
  fromDate: '2026-10-01',
  toDate: null,
  amount: 1500,
  note: null,
  standing: 'current',
  ...over,
});

const account = (over: Partial<ClientAccountView> = {}): ClientAccountView => ({
  id: 'ac1',
  nameEn: 'Acme Foods',
  nameAr: null,
  code: 'ACME-01',
  status: 'active',
  endedOn: null,
  notes: null,
  tier: { id: 't1', nameEn: 'Medium' },
  department: { id: 'd1', name: 'Marketing › Content Team' },
  defaultAmount: 1500,
  assignments: [],
  hidden: 0,
  ...over,
});

describe('who sees the page', () => {
  it('is HR, the CEO, Finance and a Super Admin; not an Admin or an employee', () => {
    for (const roles of [['hr'], ['ceo'], ['finance'], ['super_admin']] as const) expect(seesClientAccounts({ roles: [...roles] })).toBe(true);
    for (const roles of [['admin'], ['employee'], ['employee', 'manager']] as const) expect(seesClientAccounts({ roles: [...roles] })).toBe(false);
  });
});

describe('what the rows say', () => {
  it('the accounts, active first, by name', () => {
    const list = sortedAccounts([account({ nameEn: 'Zed', status: 'ended' }), account({ nameEn: 'Beta' }), account({ nameEn: 'Acme' })]);
    expect(list.map((a) => a.nameEn)).toEqual(['Acme', 'Beta', 'Zed']);
  });

  it('an account’s status, facts and people count, a C-level person’s counted', () => {
    expect(statusBadge({ status: 'active', endedOn: null }).label).toBe('Active');
    expect(statusBadge({ status: 'ended', endedOn: '2026-12-31' }).label).toBe('Ended 31/12/2026');
    expect(accountFacts(account())).toBe('ACME-01 · Medium size · Marketing › Content Team');
    expect(accountFacts(account({ code: null, tier: null, department: null }))).toBe('');
    expect(peopleCount([assignment(), assignment({ id: 'as2', standing: 'past' })], 0)).toBe('1 person now');
    expect(peopleCount([], 2)).toBe('No one now, and C-level (2 people) — hidden');
    expect(hiddenText(1)).toBe('C-level (1 person) — hidden');
    expect(hiddenText(0)).toBeNull();
  });

  it('its people by where they stand, with their dates and amounts', () => {
    const groups = peopleOf([assignment(), assignment({ id: 'as2', standing: 'upcoming' }), assignment({ id: 'as3', standing: 'past' })]);
    expect([groups.current.length, groups.upcoming.length, groups.past.length]).toEqual([1, 1, 1]);
    expect(periodText(assignment())).toBe('From 01/10/2026');
    expect(periodText(assignment({ toDate: '2026-12-31' }))).toBe('01/10/2026 to 31/12/2026');
    expect(amountText(1500)).toBe('EGP 1,500.00 a month');
    expect(amountText(null)).toBeNull();
    expect(standingBadge('upcoming').label).toBe('From a day to come');
  });

  it('the account the address names, and a size’s default for the field', () => {
    expect(focusedAccount({ account: '3f1c2a9e-5b7d-4e1f-9a2b-6c8d0e4f1a2b' })).toBe('3f1c2a9e-5b7d-4e1f-9a2b-6c8d0e4f1a2b');
    expect(focusedAccount({ account: 'nope' })).toBeNull();
    expect(focusedAccount({})).toBeNull();
    expect(tierDefault([{ id: 't1', defaultAmount: 2000 }], 't1')).toBe('2000.00');
    expect(tierDefault([{ id: 't1', defaultAmount: null }], 't1')).toBe('');
    expect(amountField(750.5)).toBe('750.50');
  });
});

describe('the account form, as the API takes it', () => {
  it('a new one sends only what is filled in; its default may come from its size', () => {
    expect(accountBody(form({ nameEn: ' Acme Foods ', nameAr: '', code: 'ACME-01', tierId: 't1', defaultAmount: '', departmentId: '', notes: '' }), false)).toEqual({
      body: { nameEn: 'Acme Foods', code: 'ACME-01', tierId: 't1' },
      problems: [],
    });
    expect(accountBody(form({ nameEn: 'Acme', defaultAmount: '1,500.50' }), false).body).toEqual({ nameEn: 'Acme', defaultAmount: 1500.5 });
  });

  it('a change sends every field, an empty one clearing it', () => {
    expect(accountBody(form({ nameEn: 'Acme', nameAr: '', code: '', tierId: '', defaultAmount: '1500', departmentId: '', notes: '' }), true).body).toEqual({
      nameEn: 'Acme',
      nameAr: '',
      code: '',
      tierId: null,
      defaultAmount: 1500,
      departmentId: null,
      notes: '',
    });
  });

  it('needs a name, a default (or a size, when new) and a code of letters, digits and dashes', () => {
    expect(accountBody(form({ nameEn: '', defaultAmount: '1500' }), false).problems).toEqual(['Enter the account’s name in English (up to 150 characters), e.g. Acme Foods.']);
    expect(accountBody(form({ nameEn: 'Acme' }), false).problems).toEqual(['Enter the default amount in EGP a month, e.g. 1500 or 1500.50.']);
    expect(accountBody(form({ nameEn: 'Acme', defaultAmount: '0' }), false).problems).toEqual(['Enter the default amount in EGP a month, more than 0, e.g. 1500 or 1500.50.']);
    expect(accountBody(form({ nameEn: 'Acme', defaultAmount: '100', code: 'AC ME' }), false).problems).toEqual([
      'Enter the code in up to 30 letters, digits and dashes, e.g. ACME-01, or leave it empty.',
    ]);
    expect(accountBody(form({ nameEn: 'Acme', tierId: 't1' }), true).problems).toEqual(['Enter the default amount in EGP a month, e.g. 1500 or 1500.50.']);
  });

  it('ending one needs its day', () => {
    expect(endAccountBody(form({ endedOn: '31/12/2026' }))).toEqual({ body: { endedOn: '2026-12-31' }, problems: [] });
    expect(endAccountBody(form({ endedOn: '' })).problems).toEqual(['Enter the day it ends as DD/MM/YYYY, e.g. 01/11/2026.']);
  });
});

describe('the assignment form, as the API takes it', () => {
  it('a new one: the person, the first day, the last (empty: still held), the amount (empty: the account’s default)', () => {
    expect(assignmentBody(form({ employeeId: 'e1', fromDate: '01/11/2026', toDate: '', amount: '1500.00', note: '' }), false)).toEqual({
      body: { employeeId: 'e1', fromDate: '2026-11-01', amount: 1500 },
      problems: [],
    });
    // no amount field (the caller doesn't see amounts): the account's default
    expect(assignmentBody(form({ employeeId: 'e1', fromDate: '01/11/2026', toDate: '30/11/2026', note: 'Lead' }), false).body).toEqual({
      employeeId: 'e1',
      fromDate: '2026-11-01',
      toDate: '2026-11-30',
      note: 'Lead',
    });
  });

  it('a change: an empty last day opens it again, an empty note clears it', () => {
    expect(assignmentBody(form({ fromDate: '01/11/2026', toDate: '', amount: '900', note: '' }), true).body).toEqual({ fromDate: '2026-11-01', toDate: null, amount: 900, note: '' });
  });

  it('needs a person, real days in order and an amount more than 0', () => {
    expect(assignmentBody(form({ fromDate: '01/11/2026' }), false).problems).toEqual(['Choose the person to assign.']);
    expect(assignmentBody(form({ employeeId: 'e1', fromDate: '' }), false).problems).toEqual(['Enter the first day as DD/MM/YYYY, e.g. 01/11/2026.']);
    expect(assignmentBody(form({ employeeId: 'e1', fromDate: '10/11/2026', toDate: '01/11/2026' }), false).problems).toEqual(['The last day must be on or after the first.']);
    expect(assignmentBody(form({ employeeId: 'e1', fromDate: '01/11/2026', amount: '-5' }), false).problems).toEqual(['Enter the amount in EGP a month, more than 0, e.g. 1500 or 1500.50.']);
    expect(assignmentBody(form({ fromDate: '01/11/2026', amount: '' }), true).problems).toEqual(['Enter the amount in EGP a month, e.g. 1500 or 1500.50.']);
  });

  it('ending one needs its last day', () => {
    expect(endAssignmentBody(form({ toDate: '15/11/2026' }))).toEqual({ body: { toDate: '2026-11-15' }, problems: [] });
    expect(endAssignmentBody(form({ toDate: '31/02/2026' })).problems).toEqual(['Enter the last day as DD/MM/YYYY, e.g. 01/11/2026.']);
  });
});

describe('the sizes, and who can be assigned', () => {
  it('a size needs its name and default amount', () => {
    expect(tierBody(form({ nameEn: ' Small ', defaultAmount: '750' }))).toEqual({ body: { nameEn: 'Small', defaultAmount: 750 }, problems: [] });
    expect(tierBody(form({ nameEn: '', defaultAmount: '' })).problems).toEqual([
      'Enter the size’s name (up to 50 characters), e.g. Small.',
      'Enter the default amount in EGP a month, e.g. 1500 or 1500.50.',
    ]);
  });

  it('offers those with a current employment, never a C-level card, nor someone on the account now or to come', () => {
    const person = (id: string, over: Partial<PersonRow> = {}): PersonRow => ({
      id,
      fullNameEn: `Person ${id}`,
      employeeCode: `EMP-${id}`,
      employment: { department: { nameEn: 'Content Team', parent: { nameEn: 'Marketing' } } },
      ...over,
    });
    const people = [person('3'), person('1'), person('2', { employment: null }), person('4', { restricted: true }), person('5'), person('6')];
    const on = account({
      assignments: [
        assignment({ employee: { id: '5', employeeCode: 'EMP-5', fullNameEn: 'Person 5' } }),
        assignment({ id: 'x', standing: 'past', employee: { id: '6', employeeCode: 'EMP-6', fullNameEn: 'Person 6' } }),
      ],
    });
    expect(assignable(people, on)).toEqual([
      { value: '1', label: 'Person 1 · EMP-1 · Marketing › Content Team' },
      { value: '3', label: 'Person 3 · EMP-3 · Marketing › Content Team' },
      // on it before: may be on it again
      { value: '6', label: 'Person 6 · EMP-6 · Marketing › Content Team' },
    ]);
  });
});
