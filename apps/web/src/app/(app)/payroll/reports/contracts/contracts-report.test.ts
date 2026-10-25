import type { ContractsReportRow, ContractsReportTotals, Role } from '@trendlix/shared';
import { describe, expect, it } from 'vitest';
import {
  apiExcelPath,
  apiReportPath,
  canSeeContractsReport,
  contractLink,
  daysLeftText,
  employeeHref,
  endsSoon,
  excelHref,
  isFiltered,
  noFilters,
  readFilters,
  reportHref,
  rowView,
  summaryTiles,
} from './contracts-report';

// The Contracts report's helpers (owner, 25 October 2026: "A report under Reports", "Dates and status"). Today is 25
// October 2026. Everyone here is invented.

const TODAY = '2026-10-25';
const YEAR = { from: '2026-01', to: '2026-12' };
const DEPT = '0b8f0c1e-2d3a-4b5c-8d9e-0f1a2b3c4d5e';
const as = (...roles: Role[]) => ({ roles });

const ROW: ContractsReportRow = {
  contractId: 'c-2',
  number: 'CON-2026-0004',
  version: 2,
  kind: 'renewal',
  employee: { id: 'e-1', employeeCode: 'EMP-0001', fullNameEn: 'Amy Example', fullNameAr: 'إيمي' },
  employmentId: 'job-1',
  department: { id: 'd-pay', nameEn: 'Payroll', parent: { id: 'd-acc', nameEn: 'Accounts' } },
  jobTitle: 'Accountant',
  employmentType: 'full_time',
  form: 'fixed',
  startDate: '2026-01-01',
  endDate: '2026-12-31',
  daysLeft: 67,
  status: 'active',
  signedOn: '2025-12-15',
  probationEnd: null,
  employeeStatus: 'current',
  nextVersion: null,
};

describe('the Contracts report', () => {
  it('is for HR, Finance and the CEO, as the Contracts page', () => {
    for (const role of ['hr', 'finance', 'ceo'] as const) expect(canSeeContractsReport(as(role))).toBe(true);
    for (const role of ['admin', 'super_admin', 'manager', 'employee'] as const) expect(canSeeContractsReport(as(role))).toBe(false);
  });

  describe('the filters', () => {
    it('are this calendar year, signed, the latest version per employment, nothing else, unless the address asks', () => {
      expect(readFilters({}, TODAY)).toEqual(noFilters(YEAR));
      expect(isFiltered(readFilters({}, TODAY))).toBe(false);
      expect(
        readFilters({ from: '2025-01', to: '2025-06', status: 'all', show: 'every', type: 'freelance', form: 'open_ended', department: DEPT, endingWithin: '60', q: '  Amy ' }, TODAY),
      ).toEqual({ period: { from: '2025-01', to: '2025-06' }, status: 'all', show: 'every', type: 'freelance', form: 'open_ended', department: DEPT, endingWithin: 60, q: 'Amy' });
    });

    it('leave out what they can’t read, as if not chosen', () => {
      const f = readFilters({ from: '2026-13', status: 'signedish', show: 'some', type: 'sales', form: 'weekly', department: 'ops', endingWithin: '45', q: ['a', 'b'] }, TODAY);
      expect(f).toEqual(noFilters(YEAR));
    });

    it('kept in the page’s address, plain for this year with nothing chosen; the period written out once another', () => {
      expect(reportHref(noFilters(YEAR), TODAY)).toBe('/payroll/reports/contracts');
      expect(reportHref({ ...noFilters(YEAR), status: 'draft', department: DEPT }, TODAY)).toBe(`/payroll/reports/contracts?status=draft&department=${DEPT}`);
      expect(reportHref({ ...noFilters({ from: '2025-01', to: '2025-12' }), q: 'Amy Example', endingWithin: 30, show: 'every' }, TODAY)).toBe(
        '/payroll/reports/contracts?from=2025-01&to=2025-12&q=Amy+Example&endingWithin=30&show=every',
      );
    });

    it('sent to the API with the period always, the place as departmentId', () => {
      expect(apiReportPath(noFilters(YEAR))).toBe('/reports/contracts?from=2026-01&to=2026-12');
      expect(apiReportPath({ ...noFilters(YEAR), type: 'full_time', form: 'fixed', department: DEPT })).toBe(`/reports/contracts?from=2026-01&to=2026-12&type=full_time&form=fixed&departmentId=${DEPT}`);
    });

    it('and the download keeps them: the page’s link, then the API’s workbook read from it', () => {
      const f = { ...noFilters(YEAR), status: 'ended' as const, department: DEPT, q: 'Amy' };
      const href = excelHref(f);
      expect(href).toBe(`/payroll/reports/contracts/excel?from=2026-01&to=2026-12&q=Amy&status=ended&department=${DEPT}`);
      expect(apiExcelPath(new URL(href, 'https://people.example').searchParams, TODAY)).toBe(`/reports/contracts.xlsx?from=2026-01&to=2026-12&q=Amy&status=ended&departmentId=${DEPT}`);
      // without a period: this calendar year's
      expect(apiExcelPath(new URLSearchParams(), TODAY)).toBe('/reports/contracts.xlsx?from=2026-01&to=2026-12');
    });
  });

  it('opens with the counts by status, what ends soon, what wasn’t renewed and the renewals signed', () => {
    const totals: ContractsReportTotals = {
      contracts: 12,
      people: 1,
      byStatus: { draft: 1, active: 8, ended: 2, superseded: 1 },
      endingIn: [
        { days: 30, count: 1 },
        { days: 60, count: 2 },
        { days: 90, count: 4 },
      ],
      notRenewed: 3,
      renewalsSigned: 5,
    };
    expect(summaryTiles(totals).map((t) => [t.label, t.value, t.note])).toEqual([
      ['Contracts', '12', '1 person'],
      ['Active', '8', 'Signed, in force'],
      ['Drafts', '1', 'Not signed yet'],
      ['Ended', '2', 'With the employment'],
      ['Replaced', '1', 'By a later version'],
      ['Ending in 30 days', '1', 'Active, from today'],
      ['Ending in 60 days', '2', 'Active, from today'],
      ['Ending in 90 days', '4', 'Active, from today'],
      ['Not renewed', '3', 'Ended in the period, no later version signed'],
      ['Renewals signed', '5', 'In the period'],
    ]);
  });

  describe('each row', () => {
    it('in words: the team apart from its department, the kind, type, length and statuses', () => {
      expect(rowView(ROW)).toEqual({
        department: 'Accounts',
        team: 'Payroll',
        kind: 'Renewal',
        type: 'Full-time',
        length: 'Fixed-term',
        status: 'Active',
        employeeStatus: 'Current',
        daysLeft: '67 days',
      });
      expect(rowView({ ...ROW, department: { id: 'd-acc', nameEn: 'Accounts', parent: null }, kind: 'first', status: 'ended', employeeStatus: 'former', daysLeft: null })).toMatchObject({
        department: 'Accounts',
        team: null,
        kind: 'First contract',
        status: 'Ended',
        employeeStatus: 'Former',
        daysLeft: 'Ended',
      });
      // a developer's: hidden
      expect(rowView({ ...ROW, employmentType: '••••', department: { id: null as unknown as string, nameEn: '••••', parent: null } })).toMatchObject({ department: '••••', type: 'Hidden' });
    });

    it('the days left, past the end too', () => {
      expect(daysLeftText({ status: 'active', daysLeft: 1 })).toBe('1 day');
      expect(daysLeftText({ status: 'active', daysLeft: 0 })).toBe('Ends today');
      expect(daysLeftText({ status: 'active', daysLeft: -1394 })).toBe('−1,394 days');
      expect(daysLeftText({ status: 'superseded', daysLeft: null })).toBeNull();
      expect([30, 0, -5].map((daysLeft) => endsSoon({ daysLeft }))).toEqual([true, true, true]);
      expect([31, null].map((daysLeft) => endsSoon({ daysLeft }))).toEqual([false, false]);
    });

    it('links the person to their Employment tab, the contract in force or the draft to its Contract section, any other to the Salary History', () => {
      expect(employeeHref(ROW)).toBe('/employees/e-1?tab=employment');
      expect(contractLink(ROW)).toBe('/employees/e-1?tab=employment#contract');
      expect(contractLink({ ...ROW, status: 'draft' })).toBe('/employees/e-1?tab=employment#contract');
      expect(contractLink({ ...ROW, status: 'superseded' })).toBe('/employees/e-1?tab=employment&sub=salary#salary-history');
      expect(contractLink({ ...ROW, status: 'ended' })).toBe('/employees/e-1?tab=employment&sub=salary#salary-history');
    });
  });
});
