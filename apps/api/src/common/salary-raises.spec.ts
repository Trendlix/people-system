import {
  averageOf,
  calendarYear,
  departmentOf,
  dueForReview,
  isCountedRaise,
  medianOf,
  payEvents,
  periodDays,
  periodProblem,
  periodRaises,
  raisesByDepartment,
  raiseTotals,
  requestedPeriod,
  salaryRaisesReport,
  type PayVersion,
  type ReportEmployment,
} from '@trendlix/shared';

// The company-wide Salary Raises report (owner's decision, 16 October 2026: the salary raises tracked on each profile and
// in a company-wide report): the raises of a period from each employment's pay events, the totals, by department, and
// who is due for a salary review. Today is 16 October 2026. Everyone here is invented.

const TODAY = '2026-10-16';
const YEAR_2026 = { from: '2026-01', to: '2026-12' };

let ids = 0;
function version(n: number, over: Partial<PayVersion> = {}): PayVersion {
  return {
    id: `c${++ids}`,
    number: `CON-2025-${String(ids).padStart(4, '0')}`,
    version: n,
    kind: 'contract',
    status: 'superseded',
    approval: null,
    returnedReason: null,
    startDate: '2025-01-01',
    endDate: '2025-12-31',
    payBasis: 'monthly',
    grossSalary: 10000,
    hourlyRate: null,
    allowances: [],
    raiseReason: null,
    newJobTitle: null,
    newGrade: null,
    approvedBy: null,
    approvedAt: null,
    signedOn: '2025-01-01',
    insuredWageFrom: null,
    ...over,
  };
}

/** A raise the CEO approved, signed. */
const raise = (n: number, over: Partial<PayVersion>) =>
  version(n, { approval: 'approved', raiseReason: 'annual', approvedBy: 'Chief Officer', approvedAt: '2026-01-10T09:00:00.000Z', ...over });

function employment(code: string, versions: PayVersion[], over: Partial<ReportEmployment> = {}): ReportEmployment {
  return {
    employee: { id: `e-${code}`, employeeCode: code, fullNameEn: `Person ${code}`, fullNameAr: 'موظف' },
    employmentId: `job-${code}`,
    department: null,
    jobTitle: null,
    joinDate: versions[0]?.startDate ?? '2025-01-01',
    endDate: null,
    ending: false,
    events: payEvents(versions),
    signedJobTitles: {},
    openRequest: null,
    ...over,
  };
}

const FINANCE = { id: 'd-fin', nameEn: 'Finance', parent: null };
const ACCOUNTS = { id: 'd-acc', nameEn: 'Accounts', parent: { id: 'd-fin', nameEn: 'Finance' } };
const SALES = { id: 'd-sal', nameEn: 'Sales', parent: null };

// Amy, Finance › Accounts: hired March 2025 at 10,000 and 500 transport; renewed with the same pay in March 2026; an
// amendment raise from June 2026 with a promotion; another signed amendment from December 2026, still to come.
const amyV = [
  version(1, { startDate: '2025-03-01', endDate: '2026-02-28', allowances: [{ nameEn: 'Transport', amount: 500 }] }),
  version(2, { startDate: '2026-03-01', endDate: '2027-02-28', allowances: [{ nameEn: 'Transport', amount: 500 }] }),
  raise(3, {
    kind: 'amendment',
    number: 'CON-2026-0004-A1',
    startDate: '2026-06-01',
    endDate: '2027-02-28',
    grossSalary: 12500,
    allowances: [{ nameEn: 'Transport', amount: 700 }],
    raiseReason: 'promotion',
    newJobTitle: 'Senior Accountant',
    newGrade: 'G5',
    signedOn: '2026-05-20',
  }),
  raise(4, { kind: 'amendment', number: 'CON-2026-0004-A2', status: 'active', startDate: '2026-12-01', endDate: '2027-02-28', grossSalary: 13000, allowances: [{ nameEn: 'Transport', amount: 700 }] }),
];
const amy = employment('EMP-0001', amyV, {
  department: ACCOUNTS,
  jobTitle: 'Senior Accountant',
  signedJobTitles: { [amyV[0].id]: 'Accountant', [amyV[1].id]: 'Accountant', [amyV[2].id]: 'Senior Accountant', [amyV[3].id]: 'Senior Accountant' },
});

// Ben, Sales: hired January 2025 at 8,000; renewed with new pay (9,000) in January 2026; a raise with the CEO now.
const ben = employment(
  'EMP-0002',
  [
    version(1, { grossSalary: 8000 }),
    raise(2, { status: 'active', startDate: '2026-01-01', endDate: '2026-12-31', grossSalary: 9000, raiseReason: 'adjustment' }),
    version(3, { kind: 'amendment', status: 'draft', approval: 'pending_ceo', raiseReason: 'annual', startDate: '2026-11-01', endDate: '2026-12-31', grossSalary: 9500, signedOn: null }),
  ],
  { department: SALES, jobTitle: 'Sales Representative' },
);

// Cara, not placed: hired May 2025 at 6,000; a new contract with a raise from December 2025, with a 200 allowance.
const cara = employment('EMP-0003', [
  version(1, { startDate: '2025-05-01', endDate: '2026-04-30', grossSalary: 6000 }),
  raise(2, { status: 'active', startDate: '2025-12-01', endDate: '2026-11-30', grossSalary: 6600, allowances: [{ nameEn: 'Meals', amount: 200 }] }),
]);

// Dina, Finance: hired September 2024 at 7,000, renewed with the same pay, no raise; a raise request with HR.
const dina = employment(
  'EMP-0004',
  [version(1, { startDate: '2024-09-01', endDate: '2025-08-31', grossSalary: 7000 }), version(2, { status: 'active', startDate: '2025-09-01', endDate: '2026-08-31', grossSalary: 7000 })],
  { department: FINANCE, openRequest: { id: 'r-1', status: 'with_hr' } },
);

// Eli: employed, no contract signed yet.
const eli = employment('EMP-0005', [version(1, { status: 'draft', startDate: '2024-01-01', signedOn: null })]);

// Fay, Sales: an amendment raise from March 2026, then she left in May 2026.
const fay = employment(
  'EMP-0006',
  [version(1, { startDate: '2025-09-01', endDate: '2026-08-31', grossSalary: 5000 }), raise(2, { kind: 'amendment', status: 'ended', startDate: '2026-03-01', endDate: '2026-08-31', grossSalary: 5500 })],
  { department: SALES, endDate: '2026-05-31' },
);

// Gus: hired in 2024, never a raise, and his employment is ending (with the CEO).
const gus = employment('EMP-0007', [version(1, { status: 'active', startDate: '2024-01-01', endDate: '2026-12-31' })], { ending: true });

const EVERYONE = [amy, ben, cara, dina, eli, fay, gus];

describe('the period', () => {
  it('is this calendar year unless asked; one month alone takes its year’s other end', () => {
    expect(calendarYear(TODAY)).toEqual(YEAR_2026);
    expect(requestedPeriod({}, TODAY)).toEqual(YEAR_2026);
    expect(requestedPeriod({ from: '2025-07' }, TODAY)).toEqual({ from: '2025-07', to: '2025-12' });
    expect(requestedPeriod({ to: '2025-03' }, TODAY)).toEqual({ from: '2025-01', to: '2025-03' });
    expect(requestedPeriod({ from: '2025-11', to: '2026-10' }, TODAY)).toEqual({ from: '2025-11', to: '2026-10' });
  });

  it('runs from its first month’s 1st to its last month’s last day, and ends on or after it starts', () => {
    expect(periodDays({ from: '2026-01', to: '2026-02' })).toEqual({ start: '2026-01-01', end: '2026-02-28' });
    expect(periodDays({ from: '2024-02', to: '2024-02' })).toEqual({ start: '2024-02-01', end: '2024-02-29' });
    expect(periodProblem(YEAR_2026)).toBeNull();
    expect(periodProblem({ from: '2026-05', to: '2026-05' })).toBeNull();
    expect(periodProblem({ from: '2026-12', to: '2026-01' })).toBe('The period ends before it starts: choose a "to" month on or after the "from" month.');
    expect(periodProblem({ from: '2026-13', to: '2026-12' })).toBe('Choose the months as YYYY-MM, e.g. 2026-01.');
  });
});

describe('the raises of a period', () => {
  const rows = periodRaises(EVERYONE, YEAR_2026, TODAY);

  it('every signed pay change that took effect in it: amendments, new contracts and renewals with new pay, oldest first', () => {
    expect(rows.map((r) => [r.employee.employeeCode, r.effectiveDate, r.kind])).toEqual([
      ['EMP-0002', '2026-01-01', 'renewal'],
      ['EMP-0006', '2026-03-01', 'amendment'],
      ['EMP-0001', '2026-06-01', 'amendment'],
      ['EMP-0001', '2026-12-01', 'amendment'],
    ]);
    // Cara's new contract from December 2025 is in 2025's
    expect(periodRaises(EVERYONE, { from: '2025-01', to: '2025-12' }, TODAY).map((r) => [r.employee.employeeCode, r.kind])).toEqual([['EMP-0003', 'new_contract']]);
    expect(periodRaises(EVERYONE, { from: '2026-02', to: '2026-05' }, TODAY).map((r) => r.effectiveDate)).toEqual(['2026-03-01']);
  });

  it('not a first contract, a renewal with the same pay, nor a raise not signed (with the CEO)', () => {
    const counted = EVERYONE.flatMap((e) => e.events.filter(isCountedRaise).map((ev) => `${e.employee.employeeCode} v${ev.version}`));
    expect(counted).toEqual(['EMP-0001 v3', 'EMP-0001 v4', 'EMP-0002 v2', 'EMP-0003 v2', 'EMP-0006 v2']);
  });

  it('each with the job title it was given in, the promotion, the pay from → to, the change, its cost and the CEO’s approval', () => {
    expect(rows[2]).toEqual({
      contractId: amyV[2].id,
      number: 'CON-2026-0004-A1',
      employee: amy.employee,
      employmentId: 'job-EMP-0001',
      department: ACCOUNTS,
      jobTitle: 'Accountant',
      promotion: { jobTitle: 'Senior Accountant', grade: 'G5' },
      effectiveDate: '2026-06-01',
      upcoming: false,
      kind: 'amendment',
      reason: 'promotion',
      payBasis: 'monthly',
      gross: { from: 10000, to: 12500 },
      allowances: { from: 500, to: 700 },
      change: { amount: 2500, percent: 25 },
      monthlyCost: 2700,
      approvedBy: 'Chief Officer',
      approvedAt: '2026-01-10T09:00:00.000Z',
      signedOn: '2026-05-20',
    });
    // signed, to come within the period: listed, marked as not in force yet
    expect(rows[3]).toMatchObject({ jobTitle: 'Senior Accountant', upcoming: true, change: { amount: 500, percent: 4 }, monthlyCost: 500, promotion: null });
    // without a title signed on the version before: the employment's now
    expect(rows[0]).toMatchObject({ jobTitle: 'Sales Representative', reason: 'adjustment', change: { amount: 1000, percent: 12.5 }, monthlyCost: 1000 });
  });
});

describe('the totals', () => {
  it('count the raises and the people, average and median the percents, and add up the monthly and yearly cost', () => {
    expect(raiseTotals(periodRaises(EVERYONE, YEAR_2026, TODAY))).toEqual({
      count: 4,
      people: 3,
      // 12.5, 10, 25 and 4
      averagePercent: 12.9,
      medianPercent: 11.3,
      monthlyCostIncrease: 4700,
      yearlyCostIncrease: 56400,
    });
    expect(raiseTotals([])).toEqual({ count: 0, people: 0, averagePercent: null, medianPercent: null, monthlyCostIncrease: 0, yearlyCostIncrease: 0 });
  });

  it('a median of an odd count is the middle one; to one decimal', () => {
    expect(medianOf([30, 5, 10])).toBe(10);
    expect(medianOf([1, 2])).toBe(1.5);
    expect(medianOf([])).toBeNull();
    expect(averageOf([10, 10, 11])).toBe(10.3);
    expect(averageOf([])).toBeNull();
  });

  it('add the cost in piastres, so it never drifts', () => {
    const rows = periodRaises(
      [employment('EMP-0100', [version(1, { grossSalary: 1000.1 }), raise(2, { status: 'active', startDate: '2026-01-01', grossSalary: 1000.3 })]), employment('EMP-0101', [version(1, { grossSalary: 1000.1 }), raise(2, { status: 'active', startDate: '2026-01-01', grossSalary: 1000.2 })])],
      YEAR_2026,
      TODAY,
    );
    expect(raiseTotals(rows)).toMatchObject({ monthlyCostIncrease: 0.3, yearlyCostIncrease: 3.6 });
  });
});

describe('by department', () => {
  it('a team’s raises are its department’s; by name, people not placed last', () => {
    expect(departmentOf(ACCOUNTS)).toEqual({ id: 'd-fin', nameEn: 'Finance' });
    expect(departmentOf(SALES)).toEqual({ id: 'd-sal', nameEn: 'Sales' });
    expect(departmentOf(null)).toBeNull();
    const groups = raisesByDepartment(periodRaises(EVERYONE, { from: '2025-01', to: '2026-12' }, TODAY));
    expect(groups.map((g) => [g.department?.nameEn ?? null, g.count, g.people, g.averagePercent, g.monthlyCostIncrease, g.yearlyCostIncrease])).toEqual([
      ['Finance', 2, 1, 14.5, 3200, 38400],
      ['Sales', 2, 2, 11.3, 1500, 18000],
      [null, 1, 1, 10, 800, 9600],
    ]);
  });
});

describe('due for review', () => {
  it('current employees whose last raise, or join date without one, is at least the months ago; longest waiting first', () => {
    // Dina: no raise since joining on 1 September 2024; Ben's last raise is 9 months ago and Cara's 10: not yet
    expect(dueForReview(EVERYONE, TODAY, 12)).toEqual([
      {
        employee: dina.employee,
        employmentId: 'job-EMP-0004',
        department: FINANCE,
        jobTitle: null,
        joinDate: '2024-09-01',
        currentGross: 7000,
        lastRaise: null,
        monthsSince: 25,
        openRaise: null,
        openRequest: { id: 'r-1', status: 'with_hr' },
      },
    ]);
    const six = dueForReview(EVERYONE, TODAY, 6);
    expect(six.map((r) => [r.employee.employeeCode, r.lastRaise, r.monthsSince, r.currentGross])).toEqual([
      ['EMP-0004', null, 25, 7000],
      ['EMP-0003', '2025-12-01', 10, 6600],
      ['EMP-0002', '2026-01-01', 9, 9000],
    ]);
    // Ben's raise with the CEO is open
    expect(six[2].openRaise).toEqual({ contractId: ben.events[2].contractId, number: ben.events[2].number, stage: 'pending_ceo', effectiveDate: '2026-11-01' });
  });

  it('not someone with a signed raise to come, without a signed contract, who left, or whose employment is ending', () => {
    const codes = dueForReview(EVERYONE, TODAY, 1).map((r) => r.employee.employeeCode);
    expect(codes).not.toContain('EMP-0001'); // Amy: a signed raise from December
    expect(codes).not.toContain('EMP-0005'); // Eli: no contract signed
    expect(codes).not.toContain('EMP-0006'); // Fay: left
    expect(codes).not.toContain('EMP-0007'); // Gus: his employment is ending
    // without the ending, Gus is due: hired in January 2024, never a raise
    expect(dueForReview([{ ...gus, ending: false }], TODAY, 12)).toMatchObject([{ lastRaise: null, monthsSince: 33, currentGross: 10000 }]);
  });
});

describe('the report', () => {
  it('has the period, the setting, the raises with their totals and departments, and who is due', () => {
    const report = salaryRaisesReport(EVERYONE, YEAR_2026, TODAY, 12);
    expect(report.period).toEqual(YEAR_2026);
    expect(report.reviewMonths).toBe(12);
    expect(report.raises).toHaveLength(4);
    expect(report.totals).toMatchObject({ count: 4, monthlyCostIncrease: 4700 });
    expect(report.byDepartment.map((d) => d.department?.nameEn)).toEqual(['Finance', 'Sales']);
    expect(report.dueForReview.map((r) => r.employee.employeeCode)).toEqual(['EMP-0004']);
  });
});
