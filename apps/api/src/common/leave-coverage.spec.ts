import {
  breaksStaffingLimit,
  COVER_REQUIRED_OVER_DAYS,
  coverageDayList,
  coverageDays,
  coverProblems,
  coverRequired,
  defaultStandIn,
  fewestAtWork,
  isStaffingLimited,
  movesToStandIn,
  sortedCandidates,
  staffingLimitProblems,
  staffingLimitText,
  standInInForce,
  standInProblems,
  type CoverageInput,
  type StandInFacts,
} from '@trendlix/shared';

// Leave coverage (owner, 25 October 2026: "if there are leaves applied by an employee and another employee in the same
// department is on a leave, how can we manage it without affecting the workflow?"; asked, "Warn and need HR", "Required
// over 2 days", "To a stand-in", "Names, no leave types"; packages/shared leave-coverage.ts): who else is off and "N of
// M at work", the staffing limit by count and by share on each day, who may cover, and who stands in.

const member = (id: string, fullNameEn: string, from = '2024-01-01', to: string | null = null) => ({ id, fullNameEn, from, to });
const TEAM = [member('me', 'Mona'), member('omar', 'Omar'), member('sara', 'Sara'), member('ali', 'Ali')];
const annual = (employeeId: string, startDate: string, endDate = startDate, waiting = false) => ({ employeeId, startDate, endDate, halfDay: false, waiting, limited: true, typeName: null });

const input = (more: Partial<CoverageInput>): CoverageInput => ({
  days: ['2026-11-12'],
  members: TEAM,
  leave: [],
  elsewhere: [],
  requesterId: 'me',
  request: { startDate: '2026-11-12', endDate: '2026-11-12', limited: true },
  limit: null,
  ...more,
});

describe('what is limited', () => {
  it('annual and unpaid leave only: never sick or casual leave, which can’t be refused, nor the other rights', () => {
    expect(isStaffingLimited('annual')).toBe(true);
    expect(isStaffingLimited('unpaid')).toBe(true);
    for (const kind of ['sick', 'casual', 'birth', 'exam', 'hajj', 'maternity', 'childcare', 'custom', null, undefined]) expect(isStaffingLimited(kind)).toBe(false);
  });

  it('a cover is required for annual (and unpaid) leave of more than 2 working days', () => {
    expect(COVER_REQUIRED_OVER_DAYS).toBe(2);
    expect(coverRequired('annual', 3)).toBe(true);
    expect(coverRequired('annual', 2.5)).toBe(true);
    expect(coverRequired('annual', 2)).toBe(false);
    expect(coverRequired('unpaid', 5)).toBe(true);
    expect(coverRequired('sick', 10)).toBe(false);
    expect(coverRequired('casual', 3)).toBe(false);
  });
});

describe('the days worked out', () => {
  it('the shift’s working days less the holidays; every day for a type counted in calendar days', () => {
    // Thursday 12 to Monday 16 November 2026, Sunday to Thursday worked, the 15th a holiday
    const count = { workingDays: [0, 1, 2, 3, 4], holidays: ['2026-11-15'], calendarDays: false };
    expect(coverageDayList('2026-11-12', '2026-11-16', count)).toEqual(['2026-11-12', '2026-11-16']);
    expect(coverageDayList('2026-11-12', '2026-11-14', { ...count, calendarDays: true })).toEqual(['2026-11-12', '2026-11-13', '2026-11-14']);
    expect(coverageDayList('2026-11-14', '2026-11-12', count)).toEqual([]);
    expect(coverageDayList('2026-01-01', '2027-12-31', { ...count, calendarDays: true })).toHaveLength(366);
  });
});

describe('coverage: who else is off', () => {
  it('counts approved and waiting leave as off, by name, one entry a person; the requester apart', () => {
    const [day] = coverageDays(input({ leave: [annual('omar', '2026-11-10', '2026-11-14'), annual('sara', '2026-11-12', '2026-11-12', true)] }));
    expect(day).toMatchObject({ date: '2026-11-12', members: 4, atWork: 1, self: true, limitedOff: 3, fewestAtWork: null, over: false });
    expect(day.off).toEqual([
      { id: 'omar', fullNameEn: 'Omar', waiting: false, halfDay: false, type: null },
      { id: 'sara', fullNameEn: 'Sara', waiting: true, halfDay: false, type: null },
    ]);
  });

  it('working from home and official duty are at work, shown apart, never off', () => {
    const [day] = coverageDays(
      input({
        elsewhere: [
          { employeeId: 'omar', startDate: '2026-11-12', endDate: '2026-11-12', kind: 'wfh', waiting: false },
          { employeeId: 'sara', startDate: '2026-11-11', endDate: '2026-11-13', kind: 'od', waiting: true },
        ],
      }),
    );
    expect(day.off).toEqual([]);
    expect(day.remote).toEqual([{ id: 'omar', fullNameEn: 'Omar', waiting: false }]);
    expect(day.onDuty).toEqual([{ id: 'sara', fullNameEn: 'Sara', waiting: true }]);
    expect(day.atWork).toBe(3);
  });

  it('an approved leave over one being decided; someone not employed that day isn’t counted; types only when sent', () => {
    const [day] = coverageDays(
      input({
        members: [...TEAM, member('new', 'Nadia', '2026-12-01')],
        leave: [annual('omar', '2026-11-12', '2026-11-12', true), { ...annual('omar', '2026-11-12'), typeName: 'Annual leave' }, annual('new', '2026-11-12')],
      }),
    );
    expect(day.members).toBe(4);
    expect(day.off).toEqual([{ id: 'omar', fullNameEn: 'Omar', waiting: false, halfDay: false, type: 'Annual leave' }]);
  });

  it('a request of a kind not limited is never over, whatever the limit', () => {
    const days = coverageDays(input({ request: { startDate: '2026-11-12', endDate: '2026-11-12', limited: false }, leave: [annual('omar', '2026-11-12')], limit: { maxOff: 0, minAtWorkPercent: null } }));
    expect(days[0]).toMatchObject({ limitedOff: 1, over: false });
  });
});

describe('the staffing limit', () => {
  it('"At most N on annual leave at once", each day of the request', () => {
    const days = coverageDays(
      input({
        days: ['2026-11-12', '2026-11-16'],
        request: { startDate: '2026-11-12', endDate: '2026-11-16', limited: true },
        leave: [annual('omar', '2026-11-16'), annual('sara', '2026-11-16', '2026-11-16', true)],
        limit: { maxOff: 2, minAtWorkPercent: null },
      }),
    );
    expect(days.map((d) => [d.limitedOff, d.fewestAtWork, d.over])).toEqual([
      [1, 2, false],
      [3, 2, true],
    ]);
    expect(breaksStaffingLimit(days)).toBe(true);
  });

  it('"At least P% at work", rounded up; sick leave off but never counted against it', () => {
    const sick = { ...annual('ali', '2026-11-12'), limited: false };
    // 50% of 4: at least 2 at work; Omar on annual leave and Mona asking: 2 at work by the limit's count
    const ok = coverageDays(input({ leave: [annual('omar', '2026-11-12'), sick], limit: { maxOff: null, minAtWorkPercent: 50 } }))[0];
    expect(ok).toMatchObject({ atWork: 1, limitedOff: 2, fewestAtWork: 2, over: false });
    const over = coverageDays(input({ leave: [annual('omar', '2026-11-12'), annual('sara', '2026-11-12')], limit: { maxOff: null, minAtWorkPercent: 50 } }))[0];
    expect(over).toMatchObject({ atWork: 1, limitedOff: 3, fewestAtWork: 2, over: true });
  });

  it('the fewest at work: all but N, at least P% (rounded up), whichever is more; both together', () => {
    expect(fewestAtWork({ maxOff: 1, minAtWorkPercent: null }, 4)).toBe(3);
    expect(fewestAtWork({ maxOff: null, minAtWorkPercent: 50 }, 3)).toBe(2);
    expect(fewestAtWork({ maxOff: 3, minAtWorkPercent: 75 }, 4)).toBe(3);
    expect(fewestAtWork({ maxOff: 10, minAtWorkPercent: null }, 4)).toBe(0);
    expect(fewestAtWork({ maxOff: null, minAtWorkPercent: null }, 4)).toBeNull();
    expect(fewestAtWork({ maxOff: 1, minAtWorkPercent: null }, 0)).toBeNull();
    expect(fewestAtWork(null, 4)).toBeNull();
  });

  it('in words, and its checks', () => {
    expect(staffingLimitText({ maxOff: 2, minAtWorkPercent: 50 })).toBe('At most 2 people on annual leave at once · At least 50% at work');
    expect(staffingLimitText({ maxOff: 1, minAtWorkPercent: null })).toBe('At most 1 person on annual leave at once');
    expect(staffingLimitText(null)).toBe('No limit');
    expect(staffingLimitProblems({ maxOff: 2, minAtWorkPercent: 50 })).toEqual([]);
    expect(staffingLimitProblems({ maxOff: null, minAtWorkPercent: null })).toEqual([]);
    expect(staffingLimitProblems({ maxOff: -1, minAtWorkPercent: 0 })).toHaveLength(2);
    expect(staffingLimitProblems({ maxOff: 1.5 })[0]).toMatch(/whole number from 0 to 500/);
    expect(staffingLimitProblems({ minAtWorkPercent: 101 })[0]).toMatch(/1 to 100/);
  });
});

describe('who may cover', () => {
  const ok = { requesterId: 'me', coverId: 'sara', cover: { fullNameEn: 'Sara', current: true }, offOnDays: false };

  it('a colleague employed now, not the requester, not off on those days', () => {
    expect(coverProblems(ok)).toEqual([]);
    expect(coverProblems({ ...ok, coverId: 'me' })).toEqual(['You can’t cover your own leave: choose a colleague.']);
    expect(coverProblems({ ...ok, cover: null })).toEqual(['Choose the colleague who covers from the list.']);
    expect(coverProblems({ ...ok, cover: { fullNameEn: 'Sara', current: false } })).toEqual(['Choose the colleague who covers from the list.']);
    expect(coverProblems({ ...ok, offOnDays: true })).toEqual(['Sara is off on some of these days, so they can’t cover them: choose another colleague.']);
  });

  it('the requester’s team first, then by name', () => {
    const list = sortedCandidates([
      { id: 'a', fullNameEn: 'Zeina', sameTeam: false },
      { id: 'b', fullNameEn: 'Yara', sameTeam: true },
      { id: 'c', fullNameEn: 'Adam', sameTeam: false },
      { id: 'd', fullNameEn: 'Basma', sameTeam: true },
    ]);
    expect(list.map((c) => c.fullNameEn)).toEqual(['Basma', 'Yara', 'Adam', 'Zeina']);
  });
});

describe('the stand-in', () => {
  const facts = (more: Partial<StandInFacts> = {}): StandInFacts => ({
    requesterId: 'lead',
    cLevel: false,
    departmentHeadId: 'head',
    managerId: 'boss',
    ceoIds: ['ceo'],
    superAdminIds: ['admin'],
    unavailable: new Set(),
    ...more,
  });

  it('the department’s head by default; the head’s head when they are the head; else HR', () => {
    expect(defaultStandIn(facts())).toEqual({ employeeId: 'head', hr: false });
    expect(defaultStandIn(facts({ requesterId: 'head' }))).toEqual({ employeeId: 'boss', hr: false });
    expect(defaultStandIn(facts({ requesterId: 'head', managerId: null }))).toEqual({ employeeId: null, hr: true });
    expect(defaultStandIn(facts({ departmentHeadId: null }))).toEqual({ employeeId: null, hr: true });
    // off on those days: HR
    expect(defaultStandIn(facts({ unavailable: new Set(['head']) }))).toEqual({ employeeId: null, hr: true });
  });

  it('a C-level approver’s: the CEO, else a Super Admin, never HR; none when nobody can', () => {
    expect(defaultStandIn(facts({ cLevel: true }))).toEqual({ employeeId: 'ceo', hr: false });
    expect(defaultStandIn(facts({ cLevel: true, requesterId: 'ceo' }))).toEqual({ employeeId: 'admin', hr: false });
    expect(defaultStandIn(facts({ cLevel: true, unavailable: new Set(['ceo', 'admin']) }))).toBeNull();
  });

  it('a stand-in chosen: HR (not for C-level), or someone employed now with an account, not off, never themself', () => {
    const person = { fullNameEn: 'Sara', current: true, account: true };
    expect(standInProblems({ employeeId: null, hr: true }, { ...facts(), person: null })).toEqual([]);
    expect(standInProblems({ employeeId: null, hr: true }, { ...facts({ cLevel: true }), person: null })[0]).toMatch(/CEO or a Super Admin, not HR/);
    expect(standInProblems({ employeeId: 'sara', hr: false }, { ...facts(), person })).toEqual([]);
    expect(standInProblems({ employeeId: 'lead', hr: false }, { ...facts(), person })[0]).toMatch(/can’t stand in for yourself/);
    expect(standInProblems({ employeeId: 'sara', hr: false }, { ...facts(), person: { ...person, account: false } })[0]).toMatch(/no sign-in account/);
    expect(standInProblems({ employeeId: 'sara', hr: false }, { ...facts({ unavailable: new Set(['sara']) }), person })[0]).toMatch(/off on some of these days/);
    expect(standInProblems({ employeeId: 'sara', hr: false }, { ...facts(), person: null })).toEqual(['Choose your stand-in from the list.']);
    expect(standInProblems({ employeeId: 'sara', hr: false }, { ...facts({ cLevel: true }), person })[0]).toMatch(/CEO or a Super Admin/);
    expect(standInProblems({ employeeId: 'admin', hr: false }, { ...facts({ cLevel: true }), person })).toEqual([]);
  });

  it('what moves to the stand-in: never their own, never a C-level person’s to one who doesn’t see C-level people', () => {
    const cLevel = new Set(['cto']);
    const sara = { employeeId: 'sara', seesConfidential: false };
    expect(movesToStandIn({ employeeId: 'omar' }, sara, cLevel)).toBe(true);
    expect(movesToStandIn({ employeeId: 'sara' }, sara, cLevel)).toBe(false);
    expect(movesToStandIn({ employeeId: 'cto' }, sara, cLevel)).toBe(false);
    expect(movesToStandIn({ employeeId: 'cto' }, { employeeId: 'ceo', seesConfidential: true }, cLevel)).toBe(true);
    // HR never sees C-level people
    expect(movesToStandIn({ employeeId: 'cto' }, { employeeId: null, seesConfidential: false }, cLevel)).toBe(false);
    expect(movesToStandIn({ employeeId: 'omar' }, { employeeId: null, seesConfidential: false }, cLevel)).toBe(true);
  });

  it('in force during the approved leave’s days only', () => {
    const leave = { status: 'approved', startDate: '2026-11-12', endDate: '2026-11-14' };
    expect(standInInForce(leave, '2026-11-11')).toBe(false);
    expect(standInInForce(leave, '2026-11-12')).toBe(true);
    expect(standInInForce(leave, '2026-11-14')).toBe(true);
    expect(standInInForce(leave, '2026-11-15')).toBe(false);
    expect(standInInForce({ ...leave, status: 'with_hr' }, '2026-11-13')).toBe(false);
  });
});
