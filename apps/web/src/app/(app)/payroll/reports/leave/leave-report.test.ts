import type { Role } from '@trendlix/shared';
import { describe, expect, it } from 'vitest';
import {
  apiExcelPath,
  apiReportPath,
  balanceText,
  canSeeLeaveReport,
  crossesPeriod,
  excelHref,
  figureText,
  isFiltered,
  leaveHref,
  leavesLabel,
  noFilters,
  quickPeriods,
  readFilters,
  readPeriod,
  reportHref,
  sourceText,
  typeTotal,
} from './leave-report';

// The Leave report's helpers (owner, 26 October 2026: "can i get a report for the monthly leaves with all types?"; "A month,
// or a range"). Today is 26 October 2026. Everyone here is invented.

const TODAY = '2026-10-26';
const MONTH = { from: '2026-10', to: '2026-10' };
const DEPT = '0b8f0c1e-2d3a-4b5c-8d9e-0f1a2b3c4d5e';
const PERSON = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const as = (...roles: Role[]) => ({ roles });

describe('who sees the leave report', () => {
  it('HR and the CEO, who see everyone’s leave; not Finance, an Admin, a Super Admin, a manager or an employee as such', () => {
    expect(canSeeLeaveReport(as('hr'))).toBe(true);
    expect(canSeeLeaveReport(as('ceo'))).toBe(true);
    expect(canSeeLeaveReport(as('hr', 'ceo', 'super_admin'))).toBe(true);
    for (const role of ['finance', 'admin', 'super_admin', 'manager', 'employee'] as const) expect(canSeeLeaveReport(as(role))).toBe(false);
  });
});

describe('the period in the address', () => {
  it('is this month unless asked; one month alone is that month', () => {
    expect(readPeriod({}, TODAY)).toEqual(MONTH);
    expect(readPeriod({ from: '2026-03' }, TODAY)).toEqual({ from: '2026-03', to: '2026-03' });
    expect(readPeriod({ to: '2026-03' }, TODAY)).toEqual({ from: '2026-03', to: '2026-03' });
  });

  it('is a range as sent; From and To the wrong way round are swapped; a month it can’t read is left out', () => {
    expect(readPeriod({ from: '2026-01', to: '2026-06' }, TODAY)).toEqual({ from: '2026-01', to: '2026-06' });
    expect(readPeriod({ from: '2026-06', to: '2026-01' }, TODAY)).toEqual({ from: '2026-01', to: '2026-06' });
    expect(readPeriod({ from: '2026-13', to: 'soon' }, TODAY)).toEqual(MONTH);
    expect(readPeriod({ from: ['2026-01', '2026-02'] }, TODAY)).toEqual(MONTH);
  });

  it('offers this month, last month, this year and last year', () => {
    expect(quickPeriods(TODAY).map((q) => [q.label, q.period.from, q.period.to])).toEqual([
      ['This month', '2026-10', '2026-10'],
      ['Last month', '2026-09', '2026-09'],
      ['This year', '2026-01', '2026-12'],
      ['Last year', '2025-01', '2025-12'],
    ]);
    // January's last month is December of the year before
    expect(quickPeriods('2026-01-10')[1].period).toEqual({ from: '2025-12', to: '2025-12' });
  });
});

describe('the filters and the addresses that keep them', () => {
  it('reads the department and the employee; anything else is left out', () => {
    expect(readFilters({ department: DEPT, employee: PERSON, from: '2026-09' }, TODAY)).toEqual({ period: { from: '2026-09', to: '2026-09' }, department: DEPT, employee: PERSON });
    expect(readFilters({ department: 'ops', employee: ' ' }, TODAY)).toEqual(noFilters(MONTH));
    expect(isFiltered(noFilters(MONTH))).toBe(false);
    expect(isFiltered({ ...noFilters(MONTH), employee: PERSON })).toBe(true);
  });

  it('keeps them in the page’s address, plain for this month with nothing chosen', () => {
    expect(reportHref(noFilters(MONTH), TODAY)).toBe('/payroll/reports/leave');
    expect(reportHref(noFilters({ from: '2026-09', to: '2026-10' }), TODAY)).toBe('/payroll/reports/leave?from=2026-09&to=2026-10');
    expect(reportHref({ period: MONTH, department: DEPT, employee: PERSON }, TODAY)).toBe(`/payroll/reports/leave?department=${DEPT}&employee=${PERSON}`);
  });

  it('asks the API with its own names, the period always written out', () => {
    expect(apiReportPath(noFilters(MONTH))).toBe('/reports/leave?from=2026-10&to=2026-10');
    expect(apiReportPath({ period: MONTH, department: DEPT, employee: PERSON })).toBe(`/reports/leave?from=2026-10&to=2026-10&departmentId=${DEPT}&employeeId=${PERSON}`);
  });

  it('downloads the workbook for the page’s filters, read as the page reads them', () => {
    expect(excelHref({ period: { from: '2026-01', to: '2026-06' }, department: DEPT, employee: null })).toBe(`/payroll/reports/leave/excel?from=2026-01&to=2026-06&department=${DEPT}`);
    expect(apiExcelPath(new URLSearchParams(`from=2026-01&to=2026-06&department=${DEPT}`), TODAY)).toBe(`/reports/leave.xlsx?from=2026-01&to=2026-06&departmentId=${DEPT}`);
    expect(apiExcelPath(new URLSearchParams(), TODAY)).toBe('/reports/leave.xlsx?from=2026-10&to=2026-10');
  });
});

describe('the figures in words', () => {
  it('shows days and hours as numbers and none as a dash', () => {
    expect(figureText(0)).toBe('—');
    expect(figureText(5)).toBe('5');
    expect(figureText(0.5)).toBe('0.5');
    expect(balanceText(null)).toBe('—');
    expect(balanceText(12.5)).toBe('12.5');
    expect(balanceText(0)).toBe('0');
    expect(balanceText(-1)).toBe('-1');
  });

  it('names a leave’s source, count and place; a type’s total is 0 when none', () => {
    expect(sourceText({ source: 'recorded' })).toBe('Recorded by HR');
    expect(sourceText({ source: 'imported' })).toBe('Imported');
    expect(sourceText({ source: 'requested' })).toBe('Requested');
    expect(leavesLabel(1)).toBe('1 leave');
    expect(leavesLabel(3)).toBe('3 leaves');
    expect(leaveHref({ id: 'l-1' })).toBe('/leave/l-1');
    expect(typeTotal({ byType: { a: 2 } }, 'a')).toBe(2);
    expect(typeTotal({ byType: { a: 2 } }, 'b')).toBe(0);
  });

  it('knows a leave that goes beyond the period', () => {
    expect(crossesPeriod({ daysInPeriod: 3, days: 5 })).toBe(true);
    expect(crossesPeriod({ daysInPeriod: 5, days: 5 })).toBe(false);
  });
});
