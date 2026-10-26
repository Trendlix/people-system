import { lockedChangeWarning, lockedMonthsOf, withWarnings } from './locked-changes.js';

// Leave and attendance changes in a month whose payroll has moved on (owner's brief, 27 October 2026). Every date is invented.

const runs = [
  { month: '2026-06', status: 'paid' },
  { month: '2026-07', status: 'pending_ceo' },
  { month: '2026-08', status: 'draft' },
  { month: '2026-09', status: 'approved' },
];

describe('the months whose payroll keeps its lines', () => {
  it('names the months the days touch whose run is with the CEO, approved or paid, the earliest first', () => {
    expect(lockedMonthsOf([{ from: '2026-07-03', to: '2026-07-04' }], runs)).toEqual([{ month: '2026-07', status: 'pending_ceo' }]);
    expect(lockedMonthsOf([{ from: '2026-09-29', to: '2026-10-02' }], runs)).toEqual([{ month: '2026-09', status: 'approved' }]);
    expect(lockedMonthsOf([{ from: '2026-06-30', to: '2026-07-01' }], runs)).toEqual([
      { month: '2026-06', status: 'paid' },
      { month: '2026-07', status: 'pending_ceo' },
    ]);
  });

  it('says nothing for a draft, or a month with no run yet', () => {
    expect(lockedMonthsOf([{ from: '2026-08-10', to: '2026-08-12' }], runs)).toEqual([]);
    expect(lockedMonthsOf([{ from: '2026-11-10', to: '2026-11-12' }], runs)).toEqual([]);
    expect(lockedMonthsOf([], runs)).toEqual([]);
  });

  it('reads several ranges at once, each month once', () => {
    expect(lockedMonthsOf([{ from: '2026-07-03', to: '2026-07-03' }, { from: '2026-07-20', to: '2026-07-21' }], runs)).toEqual([{ month: '2026-07', status: 'pending_ceo' }]);
  });
});

describe('the warning', () => {
  it('names the month, the run’s status, and what to do', () => {
    expect(lockedChangeWarning({ month: '2026-07', status: 'pending_ceo' })).toBe("July 2026's payroll is with the CEO: it isn't changed. Correct it by hand on the next payroll.");
    expect(lockedChangeWarning({ month: '2026-09', status: 'approved' })).toBe("September 2026's payroll is approved: it isn't changed. Correct it by hand on the next payroll.");
    expect(lockedChangeWarning({ month: '2026-06', status: 'paid' })).toBe("June 2026's payroll is marked paid: it isn't changed. Correct it by hand on the next payroll.");
  });

  it('is added to a view only when there is one, after the view’s own warnings', () => {
    expect(withWarnings({ id: 'r' }, [])).toEqual({ id: 'r' });
    expect(withWarnings({ id: 'r' }, ['w'])).toEqual({ id: 'r', warnings: ['w'] });
    // a work from home day's "recorded past" warnings stay first
    expect(withWarnings({ id: 'r', warnings: ['Recorded past the limit'] }, ['w'])).toEqual({ id: 'r', warnings: ['Recorded past the limit', 'w'] });
    expect(withWarnings({ id: 'r', warnings: ['w'] }, ['w'])).toEqual({ id: 'r', warnings: ['w'] });
  });
});
