import {
  contractsReport,
  contractsReportTotals,
  daysLeft,
  inPlace,
  latestPerEmployment,
  matchesSearch,
  reportStatuses,
  shownRows,
  touchesPeriod,
  versionKind,
  versionRows,
  type ContractsReportEmployment,
  type ContractsReportFilters,
  type ReportContractVersion,
} from '@trendlix/shared';

// The Contracts report (owner, 25 October 2026: "if i want to export a contracts report, status, start and end dates,
// how?"; "A report under Reports", "Dates and status"): each version's kind and days left, the period it touches, the
// filters, one row per employment or every version, and the totals. Today is 25 October 2026. Everyone here is
// invented.

const TODAY = '2026-10-25';
const YEAR = { from: '2026-01', to: '2026-12' };
const SALES = { id: 'd-sales', nameEn: 'Sales', parent: null };
const FIELD = { id: 'd-field', nameEn: 'Field', parent: { id: 'd-sales', nameEn: 'Sales' } };
const FINANCE = { id: 'd-fin', nameEn: 'Finance', parent: null };

let ids = 0;
function version(n: number, over: Partial<ReportContractVersion> = {}): ReportContractVersion {
  ids += 1;
  return {
    id: `c${ids}`,
    number: `CON-2026-${String(ids).padStart(4, '0')}`,
    version: n,
    kind: 'contract',
    form: 'fixed',
    convertsTo: null,
    status: 'active',
    startDate: '2026-01-01',
    endDate: '2026-12-31',
    signedOn: '2025-12-20',
    probationEnd: null,
    ...over,
  };
}

function job(code: string, versions: ReportContractVersion[], over: Partial<ContractsReportEmployment> = {}): ContractsReportEmployment {
  return {
    employmentId: `job-${code}`,
    employee: { id: `e-${code}`, employeeCode: code, fullNameEn: `Person ${code}`, fullNameAr: 'شخص تجريبي' },
    current: true,
    department: SALES,
    jobTitle: 'Coordinator',
    employmentType: 'full_time',
    versions,
    ...over,
  };
}

const filters = (over: Partial<ContractsReportFilters> = {}): ContractsReportFilters => ({
  period: YEAR,
  status: 'signed',
  show: 'latest',
  employmentType: null,
  form: null,
  departmentId: null,
  endingWithin: null,
  q: null,
  ...over,
});

describe('the Contracts report', () => {
  describe('the status filter', () => {
    it('Signed is active, ended and replaced; All is every status', () => {
      expect(reportStatuses('signed')).toEqual(['active', 'ended', 'superseded']);
      expect(reportStatuses('all')).toEqual(['draft', 'active', 'ended', 'superseded']);
      expect(reportStatuses('draft')).toEqual(['draft']);
    });
  });

  describe('each version', () => {
    it('is the first, a renewal after the one before, a raise’s new contract within its term, an amendment or a conversion', () => {
      const first = version(1, { startDate: '2025-01-01', endDate: '2025-12-31' });
      expect(versionKind(first, null)).toBe('first');
      expect(versionKind(version(2, { startDate: '2026-01-01' }), first)).toBe('renewal');
      expect(versionKind(version(2, { startDate: '2025-07-01' }), first)).toBe('new_contract');
      expect(versionKind(version(2, { startDate: '2025-07-01', kind: 'amendment' }), first)).toBe('amendment');
      expect(versionKind(version(2, { startDate: '2026-01-01', convertsTo: 'full_time' }), first)).toBe('conversion');
      // after an open-ended one, a contract is within its term
      expect(versionKind(version(2, { startDate: '2026-01-01' }), { endDate: null })).toBe('new_contract');
    });

    it('has days left only while signed and in force with an end: 0 on its last day, negative once past', () => {
      expect(daysLeft({ status: 'active', endDate: '2026-11-24' }, TODAY)).toBe(30);
      expect(daysLeft({ status: 'active', endDate: TODAY }, TODAY)).toBe(0);
      expect(daysLeft({ status: 'active', endDate: '2026-10-20' }, TODAY)).toBe(-5);
      expect(daysLeft({ status: 'active', endDate: null }, TODAY)).toBeNull();
      for (const status of ['draft', 'superseded', 'ended']) expect(daysLeft({ status, endDate: '2026-11-24' }, TODAY)).toBeNull();
    });

    it('touches a period from its start to its end; an open end runs on', () => {
      const half = { from: '2026-01', to: '2026-06' };
      // open-ended, started before
      expect(touchesPeriod({ startDate: '2024-03-01', endDate: null }, half)).toBe(true);
      // ending inside, starting inside, on the period's first and last days
      expect(touchesPeriod({ startDate: '2025-02-01', endDate: '2026-01-31' }, half)).toBe(true);
      expect(touchesPeriod({ startDate: '2026-06-30', endDate: '2027-06-29' }, half)).toBe(true);
      expect(touchesPeriod({ startDate: '2025-01-02', endDate: '2026-01-01' }, half)).toBe(true);
      // starting after it, ended before it, open-ended starting after
      expect(touchesPeriod({ startDate: '2026-07-01', endDate: '2027-06-30' }, half)).toBe(false);
      expect(touchesPeriod({ startDate: '2025-01-01', endDate: '2025-12-31' }, half)).toBe(false);
      expect(touchesPeriod({ startDate: '2026-07-01', endDate: null }, half)).toBe(false);
    });
  });

  describe('the show rule', () => {
    const rows = versionRows(
      [
        // renewed, a raise drafted since: the active one
        job('E-1', [version(1, { status: 'superseded' }), version(2, { status: 'active' }), version(3, { status: 'draft', kind: 'amendment' })]),
        // ended: the latest signed
        job('E-2', [version(1, { status: 'superseded' }), version(2, { status: 'ended' })]),
        // not signed yet: the draft
        job('E-3', [version(1, { status: 'draft' })]),
      ],
      TODAY,
    );

    it('one row per employment: its active version, else its latest signed, else its draft, in the order given', () => {
      expect(latestPerEmployment(rows).map((r) => [r.employee.employeeCode, r.version, r.status])).toEqual([
        ['E-1', 2, 'active'],
        ['E-2', 2, 'ended'],
        ['E-3', 1, 'draft'],
      ]);
      expect(shownRows(rows, 'latest')).toEqual(latestPerEmployment(rows));
    });

    it('or every version', () => {
      expect(shownRows(rows, 'every')).toHaveLength(6);
    });
  });

  describe('the search and the place', () => {
    const row = { employee: { id: 'e-1', employeeCode: 'EMP-0042', fullNameEn: 'Amy Example', fullNameAr: 'إيمي مثال' }, number: 'CON-2026-0007-A1' };

    it('finds the names, the code or the contract number, whatever the case', () => {
      for (const q of ['amy', 'EXAMPLE', 'إيمي', 'emp-0042', 'con-2026-0007', ' A1 ', '', null]) expect(matchesSearch(row, q), String(q)).toBe(true);
      expect(matchesSearch(row, 'Omar')).toBe(false);
    });

    it('a department has its teams; a team only itself', () => {
      expect(inPlace(FIELD, 'd-sales')).toBe(true);
      expect(inPlace(FIELD, 'd-field')).toBe(true);
      expect(inPlace(SALES, 'd-field')).toBe(false);
      expect(inPlace(null, 'd-sales')).toBe(false);
    });
  });

  describe('the rows', () => {
    // renewed: 2025, then 2026 (ending in 67 days)
    const renewed = job('E-01', [
      version(1, { status: 'superseded', startDate: '2025-01-01', endDate: '2025-12-31', signedOn: '2024-12-20' }),
      version(2, { status: 'active', startDate: '2026-01-01', endDate: '2026-12-31', signedOn: '2025-12-15' }),
    ]);
    // a draft only, in Finance
    const drafted = job('E-02', [version(1, { status: 'draft', startDate: '2026-03-01', endDate: '2027-02-28', signedOn: null })], { department: FINANCE });
    // in the Field team, part-time, open-ended
    const open = job('E-03', [version(1, { form: 'open_ended', startDate: '2024-05-01', endDate: null })], { department: FIELD, employmentType: 'part_time' });
    // left: their contract ended with the employment
    const left = job('E-04', [version(1, { status: 'ended', startDate: '2025-09-01', endDate: '2026-08-31', probationEnd: '2025-11-30' })], { current: false });
    // ending in 20 days
    const soon = job('E-05', [version(1, { startDate: '2025-11-15', endDate: '2026-11-14' })], { department: FIELD });
    const all = [soon, left, open, drafted, renewed];

    it('are the signed versions touching the period, one per employment, by employee code; drafts left out', () => {
      const r = contractsReport(all, filters(), TODAY);
      expect(r.rows.map((x) => [x.employee.employeeCode, x.version, x.status, x.kind])).toEqual([
        ['E-01', 2, 'active', 'renewal'],
        ['E-03', 1, 'active', 'first'],
        ['E-04', 1, 'ended', 'first'],
        ['E-05', 1, 'active', 'first'],
      ]);
      expect(r.rows[0]).toMatchObject({ daysLeft: 67, employeeStatus: 'current', nextVersion: null, department: SALES, jobTitle: 'Coordinator', form: 'fixed' });
      expect(r.rows[2]).toMatchObject({ daysLeft: null, employeeStatus: 'former', probationEnd: '2025-11-30' });
    });

    it('a renewed employment has one row by default, two with every version over both years', () => {
      const both = { from: '2025-01', to: '2026-12' };
      expect(contractsReport([renewed], filters({ period: both }), TODAY).rows.map((x) => x.version)).toEqual([2]);
      const every = contractsReport([renewed], filters({ period: both, show: 'every' }), TODAY).rows;
      expect(every.map((x) => [x.version, x.status, x.nextVersion])).toEqual([
        [1, 'superseded', { number: renewed.versions[1].number, status: 'active' }],
        [2, 'active', null],
      ]);
      // in 2025 only the first version touches it: the latest of those matching
      expect(contractsReport([renewed], filters({ period: { from: '2025-01', to: '2025-12' } }), TODAY).rows.map((x) => [x.version, x.status])).toEqual([[1, 'superseded']]);
    });

    it('by status: drafts, one status, or all', () => {
      expect(contractsReport(all, filters({ status: 'draft' }), TODAY).rows.map((x) => x.employee.employeeCode)).toEqual(['E-02']);
      expect(contractsReport(all, filters({ status: 'ended' }), TODAY).rows.map((x) => x.employee.employeeCode)).toEqual(['E-04']);
      expect(contractsReport(all, filters({ status: 'all' }), TODAY).rows).toHaveLength(5);
    });

    it('by employment type, length, department or team, and the search', () => {
      const codes = (f: Partial<ContractsReportFilters>) => contractsReport(all, filters({ status: 'all', ...f }), TODAY).rows.map((x) => x.employee.employeeCode);
      expect(codes({ employmentType: 'part_time' })).toEqual(['E-03']);
      expect(codes({ form: 'open_ended' })).toEqual(['E-03']);
      expect(codes({ departmentId: 'd-sales' })).toEqual(['E-01', 'E-03', 'E-04', 'E-05']);
      expect(codes({ departmentId: 'd-field' })).toEqual(['E-03', 'E-05']);
      expect(codes({ q: 'e-02' })).toEqual(['E-02']);
      expect(codes({ q: renewed.versions[1].number })).toEqual(['E-01']);
    });

    it('ending within N days: active contracts only, those past their end too', () => {
      const late = job('E-06', [version(1, { startDate: '2025-10-01', endDate: '2026-09-30' })]);
      const codes = (days: number) => contractsReport([...all, late], filters({ status: 'all', endingWithin: days }), TODAY).rows.map((x) => x.employee.employeeCode);
      expect(codes(30)).toEqual(['E-05', 'E-06']);
      expect(codes(90)).toEqual(['E-01', 'E-05', 'E-06']);
    });
  });

  describe('the totals', () => {
    it('count by status and people, the active ones ending in 30, 60 and 90 days, those not renewed and the renewals signed', () => {
      const employments = [
        // ending in 20 and 67 days, one on its last day; one past its end (not counted as ending)
        job('T-1', [version(1, { startDate: '2025-11-15', endDate: '2026-11-14' })]),
        job('T-2', [version(1, { endDate: '2026-12-31' })]),
        job('T-3', [version(1, { startDate: '2025-10-26', endDate: TODAY })]),
        // ended in March, not renewed (a draft renewal since doesn't count as one)
        job('T-4', [version(1, { startDate: '2025-04-01', endDate: '2026-03-31' }), version(2, { status: 'draft', startDate: '2026-04-01', endDate: '2027-03-31', signedOn: null })]),
        // ended in June with the employment, not renewed
        job('T-5', [version(1, { status: 'ended', startDate: '2025-07-01', endDate: '2026-06-30' })], { current: false }),
        // renewed in the period: the end of the first isn't "not renewed", the renewal signed in it counts
        job('T-6', [
          version(1, { status: 'superseded', startDate: '2025-06-01', endDate: '2026-05-31' }),
          version(2, { startDate: '2026-06-01', endDate: '2027-05-31', signedOn: '2026-05-20' }),
        ]),
        // a renewal signed in December, starting after the period: still a renewal signed in it
        job('T-7', [
          version(1, { status: 'superseded', startDate: '2025-01-01', endDate: '2025-12-31', signedOn: '2024-12-01' }),
          version(2, { startDate: '2026-01-01', endDate: '2026-12-31', signedOn: '2025-12-10' }),
        ]),
      ];
      const r = contractsReport(employments, filters({ period: { from: '2025-01', to: '2025-12' }, status: 'all' }), TODAY);
      expect(r.totals.renewalsSigned).toBe(1);

      const year = contractsReport(employments, filters({ status: 'all' }), TODAY);
      expect(year.rows.map((x) => [x.employee.employeeCode, x.version])).toEqual([
        ['T-1', 1],
        ['T-2', 1],
        ['T-3', 1],
        ['T-4', 1],
        ['T-5', 1],
        ['T-6', 2],
        ['T-7', 2],
      ]);
      expect(year.totals).toEqual({
        contracts: 7,
        people: 7,
        byStatus: { draft: 0, active: 6, ended: 1, superseded: 0 },
        endingIn: [
          { days: 30, count: 2 },
          { days: 60, count: 2 },
          { days: 90, count: 4 },
        ],
        notRenewed: 2,
        renewalsSigned: 1,
      });
      // the same with every version: the draft and the replaced version touching 2026 are rows too, the renewal counted once
      const every = contractsReport(employments, filters({ status: 'all', show: 'every' }), TODAY);
      expect(every.totals).toMatchObject({ contracts: 9, people: 7, byStatus: { draft: 1, active: 6, ended: 1, superseded: 1 }, notRenewed: 2, renewalsSigned: 1 });
    });

    it('of the rows alone when no others are given', () => {
      const rows = versionRows([job('U-1', [version(1, { status: 'superseded' }), version(2, { startDate: '2027-01-01', endDate: '2027-12-31', signedOn: '2026-10-01' })])], TODAY);
      expect(contractsReportTotals(rows, YEAR, TODAY).renewalsSigned).toBe(1);
      expect(contractsReportTotals([], YEAR, TODAY)).toEqual({
        contracts: 0,
        people: 0,
        byStatus: { draft: 0, active: 0, ended: 0, superseded: 0 },
        endingIn: [
          { days: 30, count: 0 },
          { days: 60, count: 0 },
          { days: 90, count: 0 },
        ],
        notRenewed: 0,
        renewalsSigned: 0,
      });
    });
  });
});
