import { monthsBetween, payEvents, salarySummary, type PayVersion } from '@trendlix/shared';

// An employment's salary history (owner, 16 October 2026: "think about tracking the salary raises through the
// employment period too"): its pay events from its contract versions, and the summary. Everyone here is invented.

function version(n: number, over: Partial<PayVersion> = {}): PayVersion {
  return {
    id: `c${n}`,
    number: `CON-2025-000${n}`,
    version: n,
    kind: 'contract',
    status: 'superseded',
    approval: null,
    returnedReason: null,
    startDate: '2025-03-01',
    endDate: '2026-02-28',
    payBasis: 'monthly',
    grossSalary: 10000,
    hourlyRate: null,
    allowances: [{ nameEn: 'Transport', amount: 500 }],
    raiseReason: null,
    newJobTitle: null,
    newGrade: null,
    approvedBy: null,
    approvedAt: null,
    signedOn: '2025-03-01',
    insuredWageFrom: null,
    ...over,
  };
}

// hired in March 2025; renewed with the same pay in March 2026; an amendment raise from November 2026 (approved, signed),
// with a promotion; a new-contract raise from February 2027 drafted and with the CEO
const HISTORY: PayVersion[] = [
  version(1),
  version(2, { startDate: '2026-03-01', endDate: '2027-02-28', number: 'CON-2026-0004' }),
  version(3, {
    kind: 'amendment',
    number: 'CON-2026-0004-A1',
    status: 'active',
    approval: 'approved',
    startDate: '2026-11-01',
    endDate: '2027-02-28',
    grossSalary: 12500,
    allowances: [{ nameEn: 'Transport', amount: 700 }],
    raiseReason: 'promotion',
    newJobTitle: 'Senior Accountant',
    newGrade: 'G5',
    approvedBy: 'Chief Officer',
    approvedAt: '2026-10-10T09:00:00.000Z',
    signedOn: '2026-10-12',
    insuredWageFrom: '2027-01-01',
  }),
  version(4, { status: 'draft', approval: 'pending_ceo', startDate: '2027-02-01', endDate: '2028-01-31', grossSalary: 14000, raiseReason: 'annual', signedOn: null, insuredWageFrom: '2028-01-01' }),
];

describe('pay events', () => {
  const events = payEvents([...HISTORY].reverse());

  it('are the versions in order, each against the one before', () => {
    expect(events.map((e) => [e.version, e.change, e.stage])).toEqual([
      [1, 'hired', 'replaced'],
      [2, 'renewal', 'replaced'],
      [3, 'amendment', 'signed'],
      [4, 'new_contract', 'pending_ceo'],
    ]);
  });

  it('the hire has nothing before it; a renewal with the same pay says so and is no raise', () => {
    expect(events[0]).toMatchObject({ from: null, to: { gross: 10000, allowances: 500, total: 10500 }, difference: null, samePay: false, raise: false });
    expect(events[1]).toMatchObject({ effectiveDate: '2026-03-01', samePay: true, raise: false, difference: { amount: 0, percent: 0 } });
  });

  it('a raise: from → to, the change, why, the promotion, who approved it and the insured-wage date', () => {
    expect(events[2]).toMatchObject({
      effectiveDate: '2026-11-01',
      from: { gross: 10000, allowances: 500, total: 10500 },
      to: { gross: 12500, allowances: 700, total: 13200 },
      difference: { amount: 2500, percent: 25 },
      samePay: false,
      raise: true,
      reason: 'promotion',
      promotion: { jobTitle: 'Senior Accountant', grade: 'G5' },
      approvedBy: 'Chief Officer',
      insuredWageFrom: '2027-01-01',
    });
    expect(events[3]).toMatchObject({ from: { gross: 12500 }, to: { gross: 14000 }, difference: { amount: 1500, percent: 12 }, reason: 'annual', promotion: null });
  });
});

describe('the summary', () => {
  it('from the first signed version to the one in force today, with the raises by today and the last one', () => {
    expect(salarySummary(payEvents(HISTORY), '2027-01-16')).toEqual({
      startingGross: 10000,
      currentGross: 12500,
      change: { amount: 2500, percent: 25 },
      raises: 1,
      lastRaise: { date: '2026-11-01', monthsAgo: 2 },
      next: null,
    });
  });

  it('a signed raise not in force yet is the next one, not counted', () => {
    expect(salarySummary(payEvents(HISTORY), '2026-10-16')).toEqual({
      startingGross: 10000,
      currentGross: 10000,
      change: { amount: 0, percent: 0 },
      raises: 0,
      lastRaise: null,
      next: { date: '2026-11-01', gross: 12500 },
    });
  });

  it('none until a version is signed', () => {
    expect(salarySummary(payEvents([version(1, { status: 'draft', signedOn: null })]), '2026-10-16')).toBeNull();
  });

  it('counts whole months', () => {
    expect(monthsBetween('2026-03-01', '2026-10-16')).toBe(7);
    expect(monthsBetween('2026-03-20', '2026-10-16')).toBe(6);
    expect(monthsBetween('2026-11-01', '2026-10-16')).toBe(-1);
  });
});
