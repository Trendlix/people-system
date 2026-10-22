import { ACCESS_STATES, type EmployeeAccessView } from '@trendlix/shared';
import { describe, expect, it } from 'vitest';
import {
  ACCESS_FILTERS,
  accessBadgeClass,
  accessLabel,
  accessStatusLine,
  invitableIds,
  inviteQuestion,
  matchesAccess,
  newPasswordProblem,
  readAccessFilter,
  tokenFromHash,
  WITHOUT_CONTRACT_LABEL,
} from './access';

// Every active employee's access as the screens show it (owner, 22 October 2026: "any active employee with active
// contract should have access").

const date = (iso: string) => iso.slice(0, 10);

const view = (over: Partial<EmployeeAccessView>): EmployeeAccessView => ({
  employeeId: 'e1',
  state: 'not_invited',
  signInEmail: { choice: null, work: 'mona@trendlix.com', personal: null, email: 'mona@trendlix.com' },
  eligible: true,
  notEligibleReason: null,
  account: { id: 'u1', email: 'mona@trendlix.com', isActive: true, passwordSet: false, createdAt: '2026-10-22T08:00:00Z', lastSignInAt: null, roles: ['employee'], assetsAccess: 'none' },
  closedReason: null,
  link: null,
  clash: null,
  withoutContract: false,
  emailReady: true,
  can: { invite: true, manageAccount: false },
  ...over,
});

describe('the access states on screen', () => {
  it('has a label and a badge for every state', () => {
    for (const s of ACCESS_STATES) {
      expect(accessLabel(s)).toMatch(/^[A-Z]/);
      expect(accessBadgeClass(s)).toMatch(/^badge /);
    }
    expect(accessLabel('not_invited')).toBe('Not invited');
    expect(accessLabel('no_email')).toBe('No email');
  });

  it('says what each state means now', () => {
    expect(accessStatusLine(view({}), date)).toBe('Account made 2026-10-22. No invitation sent yet.');
    expect(
      accessStatusLine(view({ state: 'invited', link: { purpose: 'invite', createdAt: '2026-10-22T09:00:00Z', expiresAt: '2026-10-29T09:00:00Z', emailed: true } }), date),
    ).toBe('Invitation emailed 2026-10-22. It works until 2026-10-29.');
    expect(
      accessStatusLine(view({ state: 'invited', link: { purpose: 'invite', createdAt: '2026-10-22T09:00:00Z', expiresAt: '2026-10-29T09:00:00Z', emailed: false } }), date),
    ).toBe('Invitation link copied 2026-10-22. It works until 2026-10-29.');
    const active = view({ state: 'active' });
    expect(accessStatusLine(active, date)).toBe('Password set. They haven’t signed in yet.');
    expect(accessStatusLine({ ...active, account: { ...active.account!, lastSignInAt: '2026-10-23T07:00:00Z' } }, date)).toBe('Password set. Last signed in 2026-10-23.');
    expect(accessStatusLine(view({ state: 'closed', closedReason: 'Their employment ended on 2026-10-21.' }), date)).toBe('Their employment ended on 2026-10-21.');
    expect(accessStatusLine(view({ state: 'no_email', account: null }), date)).toBe('Add an email to give access: a work or personal email on Basic Data.');
    expect(accessStatusLine(view({ state: 'not_eligible', account: null, notEligibleReason: 'Their contract isn’t signed yet.' }), date)).toBe('Their contract isn’t signed yet.');
    expect(accessStatusLine(view({ state: 'clash', account: null, clash: { email: 'x@y.com', otherEmployee: null } }), date)).toContain('Another account already signs in with x@y.com.');
    expect(accessStatusLine(view({ state: 'pending', account: null }), date)).toContain('Give access now');
  });
});

describe('the Employees list’s Access column', () => {
  const rows = [
    { id: 'a', access: { state: 'not_invited' as const, withoutContract: false } },
    { id: 'b', access: { state: 'active' as const, withoutContract: true } },
    { id: 'c', access: { state: 'invited' as const, withoutContract: false } },
    { id: 'd', access: null },
    { id: 'e' },
  ];

  it('filters by a state, or by access without an active contract', () => {
    expect(rows.filter((r) => matchesAccess(r.access, 'not_invited')).map((r) => r.id)).toEqual(['a']);
    expect(rows.filter((r) => matchesAccess(r.access, 'without_contract')).map((r) => r.id)).toEqual(['b']);
    expect(rows.filter((r) => matchesAccess(r.access, '')).map((r) => r.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('reads only the filters it knows', () => {
    expect(readAccessFilter('invited')).toBe('invited');
    expect(readAccessFilter('without_contract')).toBe('without_contract');
    expect(readAccessFilter('everyone')).toBe('');
    expect(readAccessFilter('toString')).toBe('');
    expect(ACCESS_FILTERS.at(-1)).toEqual({ value: 'without_contract', label: WITHOUT_CONTRACT_LABEL });
  });

  it('invites those with an account and no invitation, and asks first how many', () => {
    expect(invitableIds(rows)).toEqual(['a']);
    expect(inviteQuestion(1)).toBe('Email a set-password invitation to 1 person? The link works for 7 days.');
    expect(inviteQuestion(12)).toBe('Email a set-password invitation to 12 people? Each link works for 7 days.');
  });
});

describe('the set-password page', () => {
  const token = 'Abc_def-123456789012345678901234567890123ab';

  it('reads the token after the #, and nothing else', () => {
    expect(token).toHaveLength(43);
    expect(tokenFromHash(`#${token}`)).toBe(token);
    expect(tokenFromHash(token)).toBe(token);
    expect(tokenFromHash('')).toBeNull();
    expect(tokenFromHash('#short')).toBeNull();
    expect(tokenFromHash(`#${token}&x=1`)).toBeNull();
  });

  it('asks for 10 characters or more, typed twice the same', () => {
    expect(newPasswordProblem('short', 'short')).toBe('Choose a password of at least 10 characters.');
    expect(newPasswordProblem('a'.repeat(201), 'a'.repeat(201))).toBe('Choose a password of at most 200 characters.');
    expect(newPasswordProblem('long-enough-1', 'long-enough-2')).toBe('The two passwords aren’t the same.');
    expect(newPasswordProblem('long-enough-1', 'long-enough-1')).toBeNull();
  });
});
