import {
  ACCESS_HOLD_MESSAGE,
  ACCESS_STANDING_LABELS,
  accessStandingOf,
  GRACE_DAYS,
  graceAllowed,
  graceFromOf,
  graceRefusal,
  graceUntilOf,
  neverHeldRole,
  NO_CONTRACT_DAYS,
  shortDay,
  standingBadgeText,
  type AccessStandingInput,
  type StandingContract,
  type StandingGrace,
} from '@trendlix/shared';

// Access follows the contract (owner, 23 October 2026: "No Access without active contract, Access should be on hold with
// a 7 days grace period one time granted by the hr", then "Active - Grace - Hold - No Access"; asked: on Hold
// "Check-in/out only", Grace "Once per contract gap", go-live "Hold them immediately"): where an employee's access stands
// from their contract (packages/shared employee-access.ts), and when HR may give grace.

const TODAY = '2026-10-23';

const contract = (over: Partial<StandingContract> = {}): StandingContract => ({
  id: 'c1',
  status: 'active',
  startDate: '2025-10-23',
  endDate: '2026-10-22',
  version: 1,
  ...over,
});

const grace = (over: Partial<StandingGrace> = {}): StandingGrace => ({ contractId: 'c1', until: '2026-10-30', grantedAt: '2026-10-23T08:00:00.000Z', ...over });

const input = (over: Partial<AccessStandingInput> = {}): AccessStandingInput => ({
  account: { isActive: true, roles: ['employee'] },
  employment: { contracts: [contract({ endDate: '2027-10-22' })] },
  graces: [],
  ...over,
});

const standing = (over: Partial<AccessStandingInput> = {}, today = TODAY) => accessStandingOf(input(over), today);

describe('where access stands', () => {
  it('is Active with a signed contract in force today, open-ended too', () => {
    expect(standing()).toEqual({ standing: 'active', exempt: null, gap: null, grace: null, noContract: null });
    expect(standing({ employment: { contracts: [contract({ endDate: null, startDate: '2024-01-01' })] } }).standing).toBe('active');
    // its last day still in force
    expect(standing({ employment: { contracts: [contract({ endDate: TODAY })] } }).standing).toBe('active');
  });

  it('is Hold once a fixed term ran past its end with the work going on (open-ended by Art. 88), the gap its contract', () => {
    const s = standing({ employment: { contracts: [contract()] } });
    expect(s.standing).toBe('hold');
    expect(s.gap?.id).toBe('c1');
    expect(s.grace).toBeNull();
  });

  it('is No Access for a new hire with a draft, or a signed contract starting later, and once they left', () => {
    expect(standing({ employment: { contracts: [contract({ status: 'draft', startDate: '2026-10-01', endDate: '2027-09-30' })] } }).standing).toBe('no_access');
    expect(standing({ employment: { contracts: [contract({ startDate: '2026-11-01', endDate: '2027-10-31' })] } }).standing).toBe('no_access');
    expect(standing({ employment: { contracts: [] } }).standing).toBe('no_access');
    expect(standing({ employment: null }).standing).toBe('no_access');
    // left: no current employment, one before; never "no contract entered"
    expect(standing({ employment: null, everEmployed: true })).toEqual({ standing: 'no_access', exempt: null, gap: null, grace: null, noContract: null });
  });

  it('is No Access for an account turned off, whoever it is', () => {
    expect(standing({ account: { isActive: false, roles: ['employee'] } }).standing).toBe('no_access');
    expect(standing({ account: { isActive: false, roles: ['super_admin'] } })).toEqual({ standing: 'no_access', exempt: null, gap: null, grace: null, noContract: null });
    // no contract entered either: an account off is concerned by nothing
    expect(standing({ account: { isActive: false, roles: ['employee'] }, employment: { contracts: [] }, noContractSince: '2026-10-01' }).noContract).toBeNull();
  });

  it('never holds a Super Admin or the CEO, whatever the contract; a developer or HR is held', () => {
    const ended = { employment: { contracts: [contract()] } };
    expect(standing({ ...ended, account: { isActive: true, roles: ['employee', 'super_admin'] } })).toEqual({ standing: 'active', exempt: 'super_admin', gap: null, grace: null, noContract: null });
    expect(standing({ ...ended, account: { isActive: true, roles: ['ceo'] } })).toEqual({ standing: 'active', exempt: 'ceo', gap: null, grace: null, noContract: null });
    expect(standing({ employment: { contracts: [] }, noContractSince: '2026-01-01', account: { isActive: true, roles: ['ceo'] } }).standing).toBe('active');
    expect(standing({ employment: null, account: { isActive: true, roles: ['ceo'] } }).standing).toBe('active');
    expect(standing({ ...ended, account: { isActive: true, roles: ['employee', 'developer'] } }).standing).toBe('hold');
    expect(standing({ ...ended, account: { isActive: true, roles: ['hr', 'admin'] } }).standing).toBe('hold');
    expect(neverHeldRole(['hr', 'super_admin', 'ceo'])).toBe('super_admin');
    expect(neverHeldRole(['admin', 'hr'])).toBeNull();
  });

  it('reads someone without an account by their contract alone', () => {
    expect(standing({ account: null, employment: { contracts: [contract()] } }).standing).toBe('hold');
    expect(standing({ account: null }).standing).toBe('active');
  });

  it('keeps Hold while a renewal signed to start later waits, and is Active from its first day', () => {
    const contracts = [contract({ status: 'superseded' }), contract({ id: 'c2', version: 2, startDate: '2026-10-28', endDate: '2027-10-27' })];
    const s = standing({ employment: { contracts } });
    expect(s.standing).toBe('hold');
    expect(s.gap?.id).toBe('c1');
    expect(standing({ employment: { contracts } }, '2026-10-28').standing).toBe('active');
  });

  it('stays Active when a renewal or a raise is signed ahead of its start (the version it replaced is in force until then)', () => {
    const contracts = [contract({ status: 'superseded', endDate: '2026-12-31' }), contract({ id: 'c2', version: 2, startDate: '2026-11-01', endDate: '2026-12-31' })];
    expect(standing({ employment: { contracts } }).standing).toBe('active');
  });

  it('takes the version that ended last as the gap, the later version when two end the same day (an amendment)', () => {
    const contracts = [contract({ status: 'superseded' }), contract({ id: 'a1', version: 2, startDate: '2026-06-01' })];
    expect(standing({ employment: { contracts } }).gap?.id).toBe('a1');
    const older = [contract({ id: 'c0', version: 1, startDate: '2024-10-23', endDate: '2025-10-22', status: 'superseded' }), contract({ version: 2 })];
    expect(standing({ employment: { contracts: older } }).gap?.id).toBe('c1');
  });

  it('is Grace while this gap’s grace runs, to the end of its last day, then Hold with the grace used', () => {
    const ended = { employment: { contracts: [contract()] }, graces: [grace()] };
    expect(standing(ended)).toMatchObject({ standing: 'grace', gap: { id: 'c1' }, grace: { until: '2026-10-30' } });
    expect(standing(ended, '2026-10-30').standing).toBe('grace');
    const after = standing(ended, '2026-10-31');
    expect(after.standing).toBe('hold');
    expect(after.grace?.until).toBe('2026-10-30');
  });

  it('lets a later gap have a grace of its own: one given in an earlier gap doesn’t count', () => {
    const contracts = [contract({ status: 'superseded', endDate: '2026-09-30', startDate: '2025-10-01' }), contract({ id: 'c2', version: 2, startDate: '2026-10-08', endDate: '2026-10-22' })];
    const s = standing({ employment: { contracts }, graces: [grace({ until: '2026-10-07' })] });
    expect(s).toMatchObject({ standing: 'hold', gap: { id: 'c2' }, grace: null });
    expect(graceAllowed(s)).toBe(true);
  });
});

describe('no contract entered (owner, 23 October 2026: "Hold them after 7 days")', () => {
  const draftOnly = (over: Partial<AccessStandingInput> = {}, today = TODAY) =>
    standing({ employment: { id: 'e1', contracts: [contract({ status: 'draft', startDate: '2026-10-01', endDate: '2027-09-30' })] }, ...over }, today);

  it('keeps an account switched on with no signed contract ever in force working for 7 days from the day first recorded', () => {
    expect(NO_CONTRACT_DAYS).toBe(7);
    // not recorded yet (the sweep records it within minutes): working, no day yet
    expect(draftOnly()).toEqual({ standing: 'no_access', exempt: null, gap: null, grace: null, noContract: { employmentId: 'e1', since: null, until: null, holdFrom: null } });
    // recorded on 20 October: full access to the end of the 27th, on hold from the 28th
    expect(draftOnly({ noContractSince: '2026-10-20' })).toMatchObject({ standing: 'no_access', noContract: { since: '2026-10-20', until: '2026-10-27', holdFrom: '2026-10-28' } });
    expect(draftOnly({ noContractSince: '2026-10-20' }, '2026-10-27').standing).toBe('no_access');
    expect(draftOnly({ noContractSince: '2026-10-20' }, '2026-10-28').standing).toBe('hold');
  });

  it('holds them after the 7 days, with the one grace of it (its gap the employment), Active at once with a signed contract', () => {
    const late = { noContractSince: '2026-10-10' };
    const held = draftOnly(late);
    expect(held).toMatchObject({ standing: 'hold', gap: null, grace: null, noContract: { employmentId: 'e1', holdFrom: '2026-10-18' } });
    expect(graceAllowed(held)).toBe(true);
    const graced = draftOnly({ ...late, graces: [grace({ contractId: null, employmentId: 'e1', until: '2026-10-30' })] });
    expect(graced).toMatchObject({ standing: 'grace', grace: { employmentId: 'e1' } });
    expect(graceAllowed(graced)).toBe(false);
    const used = draftOnly({ ...late, graces: [grace({ contractId: null, employmentId: 'e1', until: '2026-10-22' })] });
    expect(used.standing).toBe('hold');
    expect(graceAllowed(used)).toBe(false);
    // a grace of another gap (a contract's, another employment's) doesn't count
    expect(graceAllowed(draftOnly({ ...late, graces: [grace({ until: '2026-10-30' }), grace({ contractId: null, employmentId: 'e0', until: '2026-10-30' })] }))).toBe(true);
    // a signed contract in force: Active at once, whatever was recorded
    expect(standing({ employment: { id: 'e1', contracts: [contract({ endDate: '2027-10-22' })] }, ...late })).toMatchObject({ standing: 'active', noContract: null });
  });

  it('counts someone never employed with an account in, their gap the person; never someone without an account, nor one who left', () => {
    expect(standing({ employment: null, noContractSince: '2026-10-01' })).toMatchObject({ standing: 'hold', noContract: { employmentId: null } });
    expect(standing({ employment: null, noContractSince: '2026-10-01', graces: [grace({ contractId: null, employmentId: null })] }).standing).toBe('grace');
    expect(standing({ account: null, employment: { id: 'e1', contracts: [] }, noContractSince: '2026-10-01' }).noContract).toBeNull();
    expect(standing({ employment: null, everEmployed: true, noContractSince: '2026-10-01' }).noContract).toBeNull();
  });
});

describe('giving grace', () => {
  const hold = standing({ employment: { contracts: [contract()] } });
  const used = standing({ employment: { contracts: [contract()] }, graces: [grace({ until: '2026-10-22', grantedAt: '2026-10-15T09:00:00.000Z' })] });
  const running = standing({ employment: { contracts: [contract()] }, graces: [grace()] });

  it('is allowed on Hold with none given in this gap, and nowhere else', () => {
    expect(graceAllowed(hold)).toBe(true);
    expect(graceAllowed(used)).toBe(false);
    expect(graceAllowed(running)).toBe(false);
    expect(graceAllowed(standing())).toBe(false);
    expect(graceAllowed(standing({ employment: null }))).toBe(false);
  });

  it('says why not, in words: never for oneself, once a gap, never extended', () => {
    expect(graceRefusal(hold, { self: false })).toBeNull();
    expect(graceRefusal(hold, { self: true })).toContain('can’t give yourself grace');
    expect(graceRefusal(standing(), { self: false })).toBe('Their contract is in force: they have full access.');
    expect(graceRefusal(standing({ account: { isActive: true, roles: ['ceo'] } }), { self: false })).toBe('They are never on hold, so they need no grace.');
    expect(graceRefusal(running, { self: false })).toBe('They are on grace already, until 30/10/2026. It can’t be extended.');
    expect(graceRefusal(standing({ employment: null, everEmployed: true }), { self: false })).toContain('Grace is for someone on hold');
    expect(graceRefusal(standing({ employment: { id: 'e1', contracts: [] }, noContractSince: '2026-10-20' }), { self: false })).toBe(
      'They aren’t on hold yet: no contract entered, their access is on hold from 28/10/2026 unless a signed contract is entered.',
    );
    expect(graceRefusal(standing({ employment: { id: 'e1', contracts: [] } }), { self: false })).toBe('They aren’t on hold yet: no contract entered.');
    expect(graceRefusal(used, { self: false })).toBe('Grace was used already in this gap (15/10/2026 to 22/10/2026). It’s given once a gap and can’t be extended.');
  });

  it('runs to the end of the 7th day after the day it is given (given on 23 October: until 30 October)', () => {
    expect(GRACE_DAYS).toBe(7);
    expect(graceUntilOf('2026-10-23')).toBe('2026-10-30');
    expect(graceUntilOf('2026-12-28')).toBe('2027-01-04');
    // the day it was given is Cairo's: late in the evening UTC is the next day there
    expect(graceFromOf({ grantedAt: '2026-10-22T22:30:00.000Z' })).toBe('2026-10-23');
  });

  it('shows the standing as its badge: "Grace until 30 Oct"', () => {
    expect(standingBadgeText('grace', '2026-10-30', TODAY)).toBe('Grace until 30 Oct');
    expect(standingBadgeText('grace', '2027-01-04', '2026-12-30')).toBe('Grace until 4 Jan 2027');
    expect(standingBadgeText('hold', null, TODAY)).toBe('Hold');
    expect(Object.values(ACCESS_STANDING_LABELS)).toEqual(['Active', 'Grace', 'Hold', 'No access']);
    expect(shortDay('2026-10-05', TODAY)).toBe('5 Oct');
    expect(ACCESS_HOLD_MESSAGE).toBe('Your access is on hold until your contract is renewed. You can still check in and out.');
  });
});
