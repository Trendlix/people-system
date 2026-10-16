import {
  averageMoney,
  departmentParts,
  figuresOf,
  lineGross,
  medianMoney,
  monthRange,
  NO_DEPARTMENT,
  payrollStatistics,
  statisticsByDepartment,
  type StatisticsLine,
  type StatisticsRun,
} from '@trendlix/shared';

// Payroll statistics (owner, 17 October 2026: "Reports (Statistics)" under Payroll): from the runs the CEO approved, by
// month, department and team, the average and median gross, and this year to date. Today is 17 October 2026. Every
// figure is invented.

const TODAY = '2026-10-17';

function line(employeeId: string, over: Partial<StatisticsLine> = {}): StatisticsLine {
  return {
    employeeId,
    department: 'Sales',
    onHold: false,
    earned: 10000,
    allowances: 1000,
    net: 9000,
    transfer: 9000,
    monthlyTax: 800,
    employeeInsurance: 1100,
    employerInsurance: 1875,
    martyrsFund: 5.5,
    companyCost: 12875,
    ...over,
  };
}

const run = (month: string, status: StatisticsRun['status'], lines: StatisticsLine[]): StatisticsRun => ({ id: `run-${month}`, month, status, lines });

describe('the sums', () => {
  it('a line’s gross is what it earned and its allowances', () => {
    expect(lineGross({ earned: 10000.1, allowances: 999.2 })).toBe(10999.3);
  });

  it('sums each figure in piasters', () => {
    expect(figuresOf([line('a', { martyrsFund: 0.1 }), line('b', { martyrsFund: 0.2 })])).toEqual({
      gross: 22000,
      net: 18000,
      transfer: 18000,
      salaryTax: 1600,
      employeeInsurance: 2200,
      companyInsurance: 3750,
      martyrsFund: 0.3,
      companyCost: 25750,
    });
  });

  it('averages and takes the median to the piaster', () => {
    expect(averageMoney([])).toBeNull();
    expect(averageMoney([1000, 2000, 2000.01])).toBe(1666.67);
    expect(medianMoney([])).toBeNull();
    expect(medianMoney([3000, 1000, 2000])).toBe(2000);
    expect(medianMoney([1000, 2000, 3000.01, 4000])).toBe(2500.01); // the mean of 2000 and 3000.01, half up
  });

  it('lists the months of a period, across a year', () => {
    expect(monthRange('2025-11', '2026-02')).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
    expect(monthRange('2026-03', '2026-03')).toEqual(['2026-03']);
    expect(monthRange('2026-04', '2026-03')).toEqual([]);
  });
});

describe('by department', () => {
  it('reads a team as “Department › Team”, and no department as such', () => {
    expect(departmentParts('Sales › Inside Sales')).toEqual({ department: 'Sales', team: 'Inside Sales' });
    expect(departmentParts('Finance')).toEqual({ department: 'Finance', team: null });
    expect(departmentParts(null)).toEqual({ department: NO_DEPARTMENT, team: null });
    expect(departmentParts('  ')).toEqual({ department: NO_DEPARTMENT, team: null });
  });

  it('counts a team in its department too, people once each, by name with no department last', () => {
    const groups = statisticsByDepartment([
      line('a', { department: 'Sales › Inside Sales' }),
      line('a', { department: 'Sales › Inside Sales' }), // the same person, another month
      line('b', { department: 'Sales' }),
      line('c', { department: null, earned: 5000, allowances: 0 }),
      line('d', { department: 'Finance' }),
    ]);
    expect(groups.map((g) => [g.name, g.employees, g.personMonths, g.gross, g.teams.map((t) => [t.name, t.employees, t.personMonths])])).toEqual([
      ['Finance', 1, 1, 11000, []],
      ['Sales', 2, 3, 33000, [['Inside Sales', 1, 2]]],
      [NO_DEPARTMENT, 1, 1, 5000, []],
    ]);
    expect(groups[1].averageGross).toBe(11000);
  });
});

describe('payrollStatistics', () => {
  const runs = [
    run('2026-07', 'paid', [line('a'), line('b', { earned: 20000, allowances: 0, onHold: true })]),
    run('2026-08', 'approved', [line('a'), line('b', { earned: 20000, allowances: 0 }), line('c', { department: 'Finance', earned: 6000, allowances: 0 })]),
    run('2026-09', 'pending_ceo', [line('a')]), // not counted: with the CEO
    run('2026-10', 'draft', [line('a')]),
    run('2025-12', 'paid', [line('a')]), // outside the period, and not this year
    run('2026-02', 'paid', [line('z', { earned: 1000, allowances: 0, companyCost: 1000 })]), // this year, before the period
  ];

  it('counts only the approved and paid runs of the period, oldest first, each with its headcount and held', () => {
    const s = payrollStatistics(runs, { from: '2026-06', to: '2026-12' }, TODAY);
    expect(s.months.map((m) => [m.month, m.status, m.employees, m.held, m.gross, m.averageGross, m.medianGross])).toEqual([
      ['2026-07', 'paid', 2, 1, 31000, 15500, 15500],
      ['2026-08', 'approved', 3, 0, 37000, 12333.33, 11000],
    ]);
    // the months up to now with no approved run: none made (June), with the CEO (September), a draft (October)
    expect(s.without).toEqual([
      { month: '2026-06', status: null },
      { month: '2026-09', status: 'pending_ceo' },
      { month: '2026-10', status: 'draft' },
    ]);
  });

  it('totals the period: people once, person-months, the average and median of every line’s gross', () => {
    const s = payrollStatistics(runs, { from: '2026-06', to: '2026-12' }, TODAY);
    expect(s.totals).toMatchObject({ months: 2, employees: 3, personMonths: 5, gross: 68000, averageGross: 13600, medianGross: 11000 });
    expect(s.totals.companyCost).toBe(12875 * 5);
    expect(s.byDepartment.map((d) => [d.name, d.employees, d.personMonths])).toEqual([
      ['Finance', 1, 1],
      ['Sales', 2, 4],
    ]);
  });

  it('adds this year to date, January to this month, whatever the period', () => {
    const s = payrollStatistics(runs, { from: '2025-01', to: '2025-12' }, TODAY);
    expect(s.months.map((m) => m.month)).toEqual(['2025-12']);
    expect(s.yearToDate).toMatchObject({ year: 2026, from: '2026-01', to: '2026-10', months: 3, employees: 4, personMonths: 6 });
    expect(s.yearToDate.companyCost).toBe(1000 + 12875 * 5);
  });

  it('is empty, not broken, without runs', () => {
    const s = payrollStatistics([], { from: '2026-01', to: '2026-03' }, TODAY);
    expect(s.months).toEqual([]);
    expect(s.without.map((w) => w.month)).toEqual(['2026-01', '2026-02', '2026-03']);
    expect(s.totals).toMatchObject({ months: 0, employees: 0, personMonths: 0, gross: 0, averageGross: null, medianGross: null });
    expect(s.byDepartment).toEqual([]);
  });
});
