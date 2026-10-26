import type { Role } from '@trendlix/shared';
import { describe, expect, it } from 'vitest';
import {
  apiExcelPath,
  apiReportPath,
  canSeeVsInsurance,
  COLUMN_COUNT,
  defaultedText,
  differenceText,
  excelHref,
  mayChangeNote,
  moneyText,
  quickPeriods,
  readPeriod,
  reportHref,
  rowsLabel,
  samePeriod,
  standingNote,
  standingText,
  statusText,
} from './vs-insurance';

// The Payroll vs Social Insurance report's helpers (owner, 26 October 2026: "a comparison report between the actual payroll
// run and the social insurance data"). Today is 26 October 2026. Every figure is invented.

const TODAY = '2026-10-26';
const SEP = { from: '2026-09', to: '2026-09' };
const as = (...roles: Role[]) => ({ roles });

describe('who sees it', () => {
  it('is HR, Finance and the CEO, as the payroll reports', () => {
    expect(canSeeVsInsurance(as('hr'))).toBe(true);
    expect(canSeeVsInsurance(as('finance'))).toBe(true);
    expect(canSeeVsInsurance(as('ceo'))).toBe(true);
    expect(canSeeVsInsurance(as('admin'))).toBe(false);
    expect(canSeeVsInsurance(as('super_admin'))).toBe(false);
    expect(canSeeVsInsurance(as('employee', 'manager'))).toBe(false);
  });
});

describe('the period in the address', () => {
  it('is none (the latest run) without a month; one month alone is that month; the wrong way round is swapped', () => {
    expect(readPeriod({})).toBeNull();
    expect(readPeriod({ from: '2026-09' })).toEqual(SEP);
    expect(readPeriod({ to: '2026-09' })).toEqual(SEP);
    expect(readPeriod({ from: '2026-01', to: '2026-03' })).toEqual({ from: '2026-01', to: '2026-03' });
    expect(readPeriod({ from: '2026-03', to: '2026-01' })).toEqual({ from: '2026-01', to: '2026-03' });
  });

  it('leaves out a month it can’t read, as if not chosen', () => {
    expect(readPeriod({ from: '2026-13', to: '2026-09' })).toEqual(SEP);
    expect(readPeriod({ from: 'september', to: ['2026-09'] })).toBeNull();
  });
});

describe('the addresses', () => {
  it('keep the period, plain for the latest run', () => {
    expect(reportHref(null)).toBe('/payroll/reports/vs-insurance');
    expect(reportHref(SEP)).toBe('/payroll/reports/vs-insurance?from=2026-09&to=2026-09');
    expect(apiReportPath(null)).toBe('/payroll/vs-insurance');
    expect(apiReportPath({ from: '2026-01', to: '2026-03' })).toBe('/payroll/vs-insurance?from=2026-01&to=2026-03');
    expect(excelHref(null)).toBe('/payroll/reports/vs-insurance/excel');
    expect(excelHref(SEP)).toBe('/payroll/reports/vs-insurance/excel?from=2026-09&to=2026-09');
  });

  it('ask the API for the workbook of the period a download names, read as the page reads it', () => {
    expect(apiExcelPath(new URLSearchParams('from=2026-09&to=2026-09'))).toBe('/payroll/vs-insurance/workbook?from=2026-09&to=2026-09');
    expect(apiExcelPath(new URLSearchParams('from=2026-03&to=2026-01'))).toBe('/payroll/vs-insurance/workbook?from=2026-01&to=2026-03');
    expect(apiExcelPath(new URLSearchParams(''))).toBe('/payroll/vs-insurance/workbook');
  });

  it('offers the latest run, last month, this month and this year with one click', () => {
    expect(quickPeriods(TODAY).map((q) => [q.key, q.period])).toEqual([
      ['latest', null],
      ['last-month', SEP],
      ['this-month', { from: '2026-10', to: '2026-10' }],
      ['this-year', { from: '2026-01', to: '2026-12' }],
    ]);
    expect(samePeriod(null, null)).toBe(true);
    expect(samePeriod(null, SEP)).toBe(false);
    expect(samePeriod(SEP, { from: '2026-09', to: '2026-09' })).toBe(true);
  });
});

describe('the words', () => {
  it('say how the period was chosen when none was asked', () => {
    expect(defaultedText({ period: SEP, defaulted: 'latest_run' })).toBe('The latest run, September 2026');
    expect(defaultedText({ period: { from: '2026-10', to: '2026-10' }, defaulted: 'this_month' })).toBe('No payroll run yet: October 2026');
    expect(defaultedText({ period: SEP, defaulted: null })).toBeNull();
  });

  it('show money with two decimals and the differences signed', () => {
    expect(moneyText(12000)).toBe('EGP 12,000.00');
    expect(differenceText(-1234.5)).toBe('−EGP 1,234.50');
    expect(differenceText(50)).toBe('+EGP 50.00');
    expect(differenceText(0)).toBe('EGP 0.00');
  });

  it('name the standing, why there is no SI cycle, and the run’s status', () => {
    expect(standingText({ standing: 'registered' })).toBe('Registered');
    expect(standingText({ standing: 'counted_as_insured' })).toBe('Counted as insured (not registered)');
    expect(standingText({ standing: 'outside_law' })).toBe('Outside the labour law');
    expect(standingNote({ standing: 'registered' })).toBeNull();
    expect(standingNote({ standing: 'not_registered' })).toContain('no SI cycle');
    expect(statusText({ status: 'draft' })).toBe('Draft: may change');
    expect(statusText({ status: 'paid' })).toBe('Paid');
    expect(mayChangeNote({ status: 'draft' })).toBe('May change');
    expect(mayChangeNote({ status: 'pending_ceo' })).toBe('May still change');
    expect(mayChangeNote({ status: 'approved' })).toBeNull();
    expect(mayChangeNote({ status: 'paid' })).toBeNull();
    expect(rowsLabel(1)).toBe('1 row');
    expect(rowsLabel(3)).toBe('3 rows');
  });

  it('counts the table’s columns: the employee and the month, two blocks of twelve and six differences', () => {
    expect(COLUMN_COUNT).toBe(32);
  });
});
