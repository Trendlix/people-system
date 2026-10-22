import {
  clearanceChecklistProblems,
  clearanceComplete,
  clearanceItemProblems,
  clearanceProgress,
  END_REASONS,
  END_REASON_KINDS,
  exitInterviewProblems,
  exitRatingAverage,
  headcountOn,
  leaverKindOf,
  rehireProblems,
  tenureBandOf,
  tenureMonths,
  tenureText,
  turnoverOf,
  turnoverRate,
  type TurnoverEmployment,
} from '@trendlix/shared';
import { holdsOwner, managesOffboarding, marksItem, offboardingCaller } from '../offboarding/offboarding-access.js';

// Offboarding's rules (owner, 22 October 2026: the full module: "Former Employees tab, clearance checklist (assets
// returned, laptop, access), exit interview, rehire eligibility, turnover numbers"; packages/shared offboarding.ts).

describe('the clearance checklist', () => {
  it('wants a name and an owner for each item', () => {
    expect(clearanceItemProblems({ label: 'Laptop returned', owner: 'admin' })).toEqual([]);
    expect(clearanceItemProblems({ label: '  ', owner: 'admin' })).toEqual(['The item: give it a name.']);
    expect(clearanceItemProblems({ label: 'x'.repeat(121), owner: 'admin' })).toEqual(['The item: its name can be at most 120 characters.']);
    expect(clearanceItemProblems({ label: 'Keys', owner: 'it' })).toEqual(['The item: choose who clears it.']);
  });

  it('keeps the default list between 1 and 20 items, the names different', () => {
    expect(clearanceChecklistProblems([])).toEqual(['Keep at least one item on the checklist.']);
    expect(clearanceChecklistProblems([{ label: 'Keys', owner: 'admin' }, { label: 'keys', owner: 'hr' }])).toEqual(['Item 2: item 1 has the same name.']);
    expect(clearanceChecklistProblems(Array.from({ length: 21 }, (_, i) => ({ label: `Item ${i}`, owner: 'hr' })))).toContain('The checklist takes at most 20 items.');
  });

  it('is complete when every item is done or not applicable', () => {
    expect(clearanceComplete([{ status: 'done' }, { status: 'not_applicable' }])).toBe(true);
    expect(clearanceComplete([{ status: 'done' }, { status: 'pending' }])).toBe(false);
    expect(clearanceProgress([{ status: 'done' }, { status: 'pending' }, { status: 'not_applicable' }])).toEqual({ cleared: 2, total: 3 });
  });
});

describe('the exit interview', () => {
  const good = { reason: 'better_offer', ratings: { role: 4, manager: 5, pay: 2, growth: 3, culture: 4 }, recommend: 'yes', comments: 'Thanks' };

  it('wants a reason, five ratings from 1 to 5 and the recommendation', () => {
    expect(exitInterviewProblems(good)).toEqual([]);
    expect(exitInterviewProblems({ ...good, reason: 'bored' })).toEqual(['Choose the main reason for leaving.']);
    expect(exitInterviewProblems({ ...good, ratings: { ...good.ratings, pay: 6 } })).toEqual(['Pay and benefits: choose a rating from 1 to 5.']);
    expect(exitInterviewProblems({ ...good, ratings: { role: 4 } })).toHaveLength(4);
    expect(exitInterviewProblems({ ...good, recommend: 'perhaps' })).toEqual(['Say whether you would recommend working here.']);
    expect(exitInterviewProblems({ ...good, comments: 'x'.repeat(2001) })).toEqual(['Keep the comments to 2000 characters or fewer.']);
  });

  it('averages the ratings to one decimal', () => {
    expect(exitRatingAverage(good.ratings)).toBe(3.6);
    expect(exitRatingAverage(null)).toBeNull();
  });
});

describe('rehire eligibility', () => {
  it('needs a reason unless they are simply eligible', () => {
    expect(rehireProblems({ eligibility: 'eligible' })).toEqual([]);
    expect(rehireProblems({ eligibility: 'conditional', reason: '' })).toEqual(['Say on what conditions they could be hired again.']);
    expect(rehireProblems({ eligibility: 'not_eligible' })).toEqual(['Say why they shouldn’t be hired again.']);
    expect(rehireProblems({ eligibility: 'not_eligible', reason: 'Left during a shoot' })).toEqual([]);
    expect(rehireProblems({ eligibility: 'maybe' })).toEqual(['Choose whether they could be hired again.']);
  });
});

describe('turnover', () => {
  it('gives every end reason a kind: voluntary, involuntary or other', () => {
    expect(Object.keys(END_REASON_KINDS).sort()).toEqual([...END_REASONS].sort());
    expect(leaverKindOf('resigned')).toBe('voluntary');
    expect(leaverKindOf('mutual_agreement')).toBe('voluntary');
    expect(leaverKindOf('retired')).toBe('voluntary');
    expect(leaverKindOf('terminated')).toBe('involuntary');
    expect(leaverKindOf('contract_ended')).toBe('involuntary');
    expect(leaverKindOf('training_completed')).toBe('involuntary');
    expect(leaverKindOf('deceased')).toBe('other');
    expect(leaverKindOf(null)).toBe('other');
  });

  it('counts whole months served, and their band', () => {
    expect(tenureMonths('2026-03-01', '2026-05-31')).toBe(2);
    expect(tenureMonths('2026-03-01', '2026-06-01')).toBe(3);
    expect(tenureMonths('2024-01-15', '2026-01-14')).toBe(23);
    expect(tenureMonths('2026-05-10', '2026-05-01')).toBe(0);
    expect(tenureBandOf(2)).toBe('under_3m');
    expect(tenureBandOf(3)).toBe('3_12m');
    expect(tenureBandOf(12)).toBe('1_2y');
    expect(tenureBandOf(59)).toBe('2_5y');
    expect(tenureBandOf(60)).toBe('5y_plus');
    expect(tenureText(0)).toBe('Under a month');
    expect(tenureText(27)).toBe('2 years 3 months');
    expect(tenureText(12)).toBe('1 year');
  });

  it('is leavers ÷ average headcount, to one decimal', () => {
    expect(turnoverRate(2, 40)).toBe(5);
    expect(turnoverRate(1, 3)).toBe(33.3);
    expect(turnoverRate(1, 0)).toBeNull();
  });

  const people: TurnoverEmployment[] = [
    { joinDate: '2025-01-01', endDate: null, endReason: null, employmentType: 'full_time', department: 'Production' },
    { joinDate: '2025-06-01', endDate: null, endReason: null, employmentType: 'full_time', department: 'Production' },
    { joinDate: '2025-02-01', endDate: '2026-02-15', endReason: 'resigned', employmentType: 'full_time', department: 'Production' },
    { joinDate: '2026-01-10', endDate: '2026-03-09', endReason: 'terminated', employmentType: 'part_time', department: 'Marketing' },
    { joinDate: '2024-01-01', endDate: '2026-03-31', endReason: 'contract_ended', employmentType: 'full_time', department: 'Marketing' },
    // a freelancer is outside the labour law: never counted
    { joinDate: '2025-01-01', endDate: '2026-02-20', endReason: 'other', employmentType: 'freelance', department: 'Production' },
  ];

  it('counts the headcount of a day, freelancers left out', () => {
    expect(headcountOn(people, '2026-01-01')).toBe(4);
    expect(headcountOn(people, '2026-02-15')).toBe(5);
    expect(headcountOn(people, '2026-02-16')).toBe(4);
  });

  it('works out the year: months to today, the leavers by kind, department, reason and tenure', () => {
    const t = turnoverOf(people, 2026, '2026-04-10', (r) => r);
    expect(t.months.map((m) => m.month)).toEqual(['2026-01', '2026-02', '2026-03', '2026-04']);
    expect(t.months[1]).toMatchObject({ month: '2026-02', start: 5, end: 4, average: 4.5, leavers: 1, voluntary: 1, rate: 22.2, partial: false });
    expect(t.months[2]).toMatchObject({ leavers: 2, involuntary: 2, start: 4, end: 3 });
    expect(t.months[3]).toMatchObject({ partial: true, leavers: 0, start: 2, end: 2 });
    expect(t).toMatchObject({ leavers: 3, voluntary: 1, involuntary: 2, other: 0 });
    // (4.5 + 4.5 + 3.5 + 2) ÷ 4
    expect(t.averageHeadcount).toBe(3.6);
    expect(t.rate).toBe(83.3);
    expect(t.byDepartment).toEqual([
      { key: 'Marketing', label: 'Marketing', leavers: 2, voluntary: 0 },
      { key: 'Production', label: 'Production', leavers: 1, voluntary: 1 },
    ]);
    expect(t.byReason.map((r) => r.key).sort()).toEqual(['contract_ended', 'resigned', 'terminated']);
    expect(t.byTenure.map((b) => [b.key, b.leavers])).toEqual([
      ['under_3m', 1],
      ['1_2y', 1],
      ['2_5y', 1],
    ]);
    // 12 + 1 + 26 months
    expect(t.averageTenureMonths).toBe(13);
  });

  it('leaves out months that haven\'t started, and a year with nobody', () => {
    expect(turnoverOf([], 2026, '2026-01-05', (r) => r)).toMatchObject({ leavers: 0, rate: null, averageTenureMonths: null, months: [{ month: '2026-01', start: 0, rate: null }] });
  });
});

describe('who does what', () => {
  const user = (roles: string[]) => ({ id: 'u', email: 'u@x.com', roles }) as never;

  it('lets HR, the CEO and a Super Admin handle the cases', () => {
    expect(managesOffboarding({ roles: ['hr'] })).toBe(true);
    expect(managesOffboarding({ roles: ['ceo'] })).toBe(true);
    expect(managesOffboarding({ roles: ['super_admin'] })).toBe(true);
    expect(managesOffboarding({ roles: ['admin', 'finance', 'manager'] })).toBe(false);
  });

  it('lets each owner clear their own items, and those who handle cases any of a person', () => {
    const admin = offboardingCaller(user(['admin']), 'e1', 'none');
    const finance = offboardingCaller(user(['finance']), null, 'none');
    const manager = offboardingCaller(user(['manager']), 'boss', 'none');
    const custodian = offboardingCaller(user(['employee']), 'c1', 'custodian');
    const hr = offboardingCaller(user(['hr']), 'h1', 'none');
    expect(holdsOwner(admin, 'admin', 'boss')).toBe(true);
    expect(holdsOwner(offboardingCaller(user(['super_admin']), null, null), 'admin', null)).toBe(true);
    expect(holdsOwner(finance, 'finance', 'boss')).toBe(true);
    expect(holdsOwner(manager, 'manager', 'boss')).toBe(true);
    expect(holdsOwner(manager, 'manager', 'someone-else')).toBe(false);
    expect(holdsOwner(custodian, 'assets', null)).toBe(true);
    expect(holdsOwner(admin, 'finance', null)).toBe(false);
    const manual = { kind: 'manual', owner: 'admin' as const };
    expect(marksItem(admin, manual, null, true)).toBe(true);
    expect(marksItem(finance, manual, null, true)).toBe(false);
    expect(marksItem(hr, manual, null, true)).toBe(true);
    // never one the system ticks, nor on a case that isn't open
    expect(marksItem(hr, { kind: 'assets', owner: 'assets' }, null, true)).toBe(false);
    expect(marksItem(hr, manual, null, false)).toBe(false);
  });
});
