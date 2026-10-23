import { ACCESS_STANDINGS, ACCESS_STATES, type AccessStandingView, type EmployeeAccessView } from '@trendlix/shared';
import { describe, expect, it } from 'vitest';
import {
  ACCESS_FILTER_GROUPS,
  ACCESS_FILTERS,
  accessBadgeClass,
  accessLabel,
  accessStatusLine,
  exemptLine,
  graceQuestion,
  invitableIds,
  inviteQuestion,
  matchesAccess,
  newPasswordProblem,
  NO_CONTRACT_FILTER_LABEL,
  noContractCount,
  noContractLine,
  offersGrace,
  readAccessFilter,
  rowNoContractLine,
  setupLabel,
  standingBadge,
  standingBadgeClass,
  standingLine,
  STILL_SIGNS_IN_NOTE,
  stillSignsIn,
  tokenFromHash,
  usedGraceLine,
} from './access';

// Every active employee's access as the screens show it (owner, 22 October 2026: "any active employee with active
// contract should have access").

const date = (iso: string) => iso.slice(0, 10);

const standing = (over: Partial<AccessStandingView> = {}): AccessStandingView => ({ standing: 'active', exempt: null, gap: null, grace: null, canGiveGrace: false, noContract: null, ...over });

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
  standing: standing(),
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

describe('the standing on screen (23 October 2026: "Active - Grace - Hold - No Access")', () => {
  it('has a badge for every standing: Active green, Grace amber with its last day, Hold red, No access grey', () => {
    expect(ACCESS_STANDINGS.map(standingBadgeClass)).toEqual([
      'badge bg-ok-soft text-ok',
      'badge bg-warn-soft text-warn',
      'badge bg-danger-soft text-danger',
      'badge bg-line-soft text-muted',
    ]);
    expect(standingBadge('active', null, '2026-10-23')).toBe('Active');
    expect(standingBadge('grace', '2026-10-30', '2026-10-23')).toBe('Grace until 30 Oct');
    expect(standingBadge('grace', '2027-01-02', '2026-12-28')).toBe('Grace until 2 Jan 2027');
    expect(standingBadge('hold', null, '2026-10-23')).toBe('Hold');
    expect(standingBadge('no_access', null, '2026-10-23')).toBe('No access');
  });

  it('keeps the account’s setting up as the line under it, the old No active contract and Closed read into the four', () => {
    expect(setupLabel('not_invited')).toBe('Not invited');
    expect(setupLabel('invited')).toBe('Invited');
    expect(setupLabel('pending')).toBe('Being set up');
    expect(setupLabel('clash')).toBe('Email in use');
    expect(setupLabel('no_email')).toBe('No email');
    expect(setupLabel('active')).toBeNull();
    expect(setupLabel('not_eligible')).toBeNull();
    expect(setupLabel('closed')).toBeNull();
  });

  it('says what Hold and Grace mean, and when a grace of this gap was used', () => {
    const gap = { contractId: 'c1', number: 'CON-2025-0007', endDate: '2026-10-20' };
    expect(standingLine(standing({ standing: 'hold', gap }), date)).toBe('Their contract CON-2025-0007 ended on 2026-10-20: only check-in and check-out work until it’s renewed.');
    const grace = { from: '2026-10-23', until: '2026-10-30', grantedAt: '2026-10-23T08:00:00Z', grantedBy: { id: 'u9', name: 'Hana HR' }, running: true };
    expect(standingLine(standing({ standing: 'grace', gap, grace }), date)).toBe('Grace until 2026-10-30, given by Hana HR on 2026-10-23. Full access until the end of that day.');
    expect(usedGraceLine(standing({ standing: 'grace', gap, grace }), date)).toBeNull();
    expect(usedGraceLine(standing({ standing: 'hold', gap, grace: { ...grace, running: false } }), date)).toBe('Grace already used in this gap (2026-10-23 to 2026-10-30).');
    expect(standingLine(standing(), date)).toBeNull();
    expect(exemptLine(standing({ exempt: 'super_admin' }))).toBe('Never on hold: Super Admin.');
    expect(exemptLine(standing({ exempt: 'ceo' }))).toBe('Never on hold: CEO.');
    expect(exemptLine(standing())).toBeNull();
  });

  it('offers Give 7 days’ grace only as the API says, and asks first', () => {
    expect(offersGrace(view({ standing: standing({ standing: 'hold', canGiveGrace: true }) }))).toBe(true);
    expect(offersGrace(view({ standing: standing({ standing: 'hold', canGiveGrace: false }) }))).toBe(false);
    expect(offersGrace(view({}))).toBe(false);
    expect(graceQuestion('2026-10-30', date)).toBe('Give 7 days’ grace, until 2026-10-30? Once in this gap; it can’t be extended.');
  });

  it('flags an account that still signs in though they left', () => {
    const none = standing({ standing: 'no_access' });
    expect(stillSignsIn(view({ state: 'active', standing: none }))).toBe(true);
    expect(stillSignsIn(view({ state: 'closed', standing: none, account: { ...view({}).account!, isActive: false } }))).toBe(false);
    expect(stillSignsIn(view({ state: 'not_eligible', standing: none, account: null }))).toBe(false);
    expect(stillSignsIn(view({ state: 'active', standing: standing({ standing: 'hold' }) }))).toBe(false);
    // no contract entered is said apart
    expect(stillSignsIn(view({ state: 'active', standing: standing({ standing: 'no_access', noContract: { since: '2026-10-23', holdFrom: '2026-10-31' } }) }))).toBe(false);
    expect(STILL_SIGNS_IN_NOTE).toContain('employment has ended');
  });

  it('warns of no contract entered: on hold from a day unless HR enters a signed contract, then held (23 October 2026)', () => {
    const counting = standing({ standing: 'no_access', noContract: { since: '2026-10-23', holdFrom: '2026-10-31' } });
    expect(noContractLine(counting, date)).toBe('No contract entered: on hold from 2026-10-31 unless HR enters a signed contract.');
    expect(noContractLine(standing({ standing: 'no_access', noContract: { since: null, holdFrom: null } }), date)).toBe(
      'No contract entered: on hold 7 days from now unless HR enters a signed contract.',
    );
    expect(noContractLine(standing({ standing: 'no_access' }), date)).toBeNull();
    const held = standing({ standing: 'hold', noContract: { since: '2026-10-10', holdFrom: '2026-10-18' }, canGiveGrace: true });
    expect(noContractLine(held, date)).toBeNull();
    expect(standingLine(held, date)).toBe('No contract entered: only check-in and check-out work until a signed contract is entered.');
    expect(offersGrace(view({ standing: held }))).toBe(true);
  });
});

describe('the Employees list’s Access column', () => {
  const rows = [
    { id: 'a', access: { state: 'not_invited' as const, standing: 'active' as const, graceUntil: null } },
    { id: 'b', access: { state: 'active' as const, standing: 'hold' as const, graceUntil: null } },
    { id: 'c', access: { state: 'invited' as const, standing: 'grace' as const, graceUntil: '2026-10-30' } },
    { id: 'd', access: null },
    { id: 'e' },
    // an API from before the standings
    { id: 'f', access: { state: 'active' as const } },
    // no contract entered: still working, and held after its 7 days
    { id: 'g', access: { state: 'active' as const, standing: 'no_access' as const, graceUntil: null, noContract: { since: '2026-10-23', holdFrom: '2026-10-31' } } },
    { id: 'h', access: { state: 'active' as const, standing: 'hold' as const, graceUntil: null, noContract: { since: '2026-10-10', holdFrom: '2026-10-18' } } },
  ];

  it('filters by a standing, or by the account’s state', () => {
    expect(rows.filter((r) => matchesAccess(r.access, 'hold')).map((r) => r.id)).toEqual(['b', 'h']);
    expect(rows.filter((r) => matchesAccess(r.access, 'no_contract')).map((r) => r.id)).toEqual(['g', 'h']);
    expect(noContractCount(rows)).toBe(2);
    expect(rowNoContractLine(rows[6].access, date)).toBe('No contract entered · on hold from 2026-10-31');
    expect(rowNoContractLine(rows[7].access, date)).toBe('No contract entered');
    expect(rowNoContractLine(rows[0].access, date)).toBeNull();
    expect(rows.filter((r) => matchesAccess(r.access, 'grace')).map((r) => r.id)).toEqual(['c']);
    expect(rows.filter((r) => matchesAccess(r.access, 'active')).map((r) => r.id)).toEqual(['a']);
    expect(rows.filter((r) => matchesAccess(r.access, 'setup:not_invited')).map((r) => r.id)).toEqual(['a']);
    expect(rows.filter((r) => matchesAccess(r.access, 'setup:active')).map((r) => r.id)).toEqual(['b', 'f', 'g', 'h']);
    expect(rows.filter((r) => matchesAccess(r.access, '')).map((r) => r.id)).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
  });

  it('reads only the filters it knows, links from before the standings too', () => {
    expect(readAccessFilter('hold')).toBe('hold');
    expect(readAccessFilter('no_access')).toBe('no_access');
    expect(readAccessFilter('no_contract')).toBe('no_contract');
    expect(readAccessFilter('setup:invited')).toBe('setup:invited');
    expect(readAccessFilter('invited')).toBe('setup:invited');
    expect(readAccessFilter('without_contract')).toBe('hold');
    expect(readAccessFilter('not_eligible')).toBe('no_access');
    expect(readAccessFilter('closed')).toBe('no_access');
    expect(readAccessFilter('setup:closed')).toBe('');
    expect(readAccessFilter('everyone')).toBe('');
    expect(readAccessFilter('toString')).toBe('');
    expect(ACCESS_FILTER_GROUPS.map((g) => g.label)).toEqual(['Standing', 'Account']);
    expect(ACCESS_FILTERS.slice(0, 5).map((f) => f.label)).toEqual(['Active', 'Grace', 'Hold', 'No access', NO_CONTRACT_FILTER_LABEL]);
    expect(NO_CONTRACT_FILTER_LABEL).toBe('No contract entered');
    expect(ACCESS_FILTERS.map((f) => f.label)).not.toContain('Has access without an active contract');
    for (const f of ACCESS_FILTERS) expect(readAccessFilter(f.value)).toBe(f.value);
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
