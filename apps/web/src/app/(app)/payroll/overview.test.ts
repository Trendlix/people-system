import { describe, expect, it } from 'vitest';
import type { PayrollRunSummary } from '../../../lib/types';
import { currentRunMonth, daysUntil, lastPaidRun, nextPayday, paidFigures } from './overview';
import { PAYROLL_SECTIONS } from './sections';

// The Payroll Overview's key figures (owner, 17 October 2026). Today is 17 October 2026. Every figure is invented.

const TODAY = '2026-10-17';

const totals = { employees: 12, earned: 300000, allowances: 12000.5, employeeInsurance: 0, employerInsurance: 0, monthlyTax: 0, martyrsFund: 0, deductions: 0, net: 250000, released: 0, transfer: 249000, companyCost: 350000 };
const run = (month: string, status: PayrollRunSummary['status']): PayrollRunSummary =>
  ({ id: `run-${month}`, month, status, totals, createdAt: '2026-10-01T10:00:00Z', approvedAt: null, paidOn: status === 'paid' ? `${month}-28` : null }) as PayrollRunSummary;

describe('the Payroll pages', () => {
  it('are Overview, Unsettled, Additions / Deductions and Reports, in the owner’s order', () => {
    expect(PAYROLL_SECTIONS.map((s) => [s.label, s.href])).toEqual([
      ['Overview', '/payroll'],
      ['Unsettled', '/payroll/unsettled'],
      ['Additions / Deductions', '/payroll/adjustments'],
      ['Reports', '/payroll/reports'],
    ]);
  });
});

describe('the next payday', () => {
  it('is the payday this month if it is still to come, else next month’s; it pays the month before it', () => {
    expect(nextPayday(TODAY, 25)).toEqual({ date: '2026-10-25', forMonth: '2026-09' });
    expect(nextPayday(TODAY, 17)).toEqual({ date: '2026-10-17', forMonth: '2026-09' });
    expect(nextPayday(TODAY, 5)).toEqual({ date: '2026-11-05', forMonth: '2026-10' });
    // a payday past a short month's end is its last day
    expect(nextPayday('2026-02-10', 31)).toEqual({ date: '2026-02-28', forMonth: '2026-01' });
    expect(nextPayday('2026-12-30', 5)).toEqual({ date: '2027-01-05', forMonth: '2026-12' });
    expect(nextPayday(TODAY, null)).toBeNull();
    expect(nextPayday(TODAY, 0)).toBeNull();
  });

  it('says how far off it is', () => {
    expect(daysUntil(TODAY, TODAY)).toBe('Today');
    expect(daysUntil(TODAY, '2026-10-18')).toBe('Tomorrow');
    expect(daysUntil(TODAY, '2026-11-05')).toBe('In 19 days');
  });
});

describe('the run paid next', () => {
  it('is the next payday’s month, or last month without a payday', () => {
    expect(currentRunMonth(TODAY, 25)).toBe('2026-09');
    expect(currentRunMonth(TODAY, 5)).toBe('2026-10');
    expect(currentRunMonth(TODAY, null)).toBe('2026-09');
  });
});

describe('the last paid run', () => {
  it('is the newest month marked paid, with its totals', () => {
    const runs = [run('2026-09', 'approved'), run('2026-07', 'paid'), run('2026-08', 'paid')];
    expect(lastPaidRun(runs)?.month).toBe('2026-08');
    expect(lastPaidRun([run('2026-09', 'draft')])).toBeNull();
    expect(paidFigures(run('2026-08', 'paid'))).toEqual([
      { label: 'Employees', value: '12' },
      { label: 'Gross', value: 'EGP 312,000.50' },
      { label: 'Net', value: 'EGP 250,000.00' },
      { label: 'Transfer', value: 'EGP 249,000.00' },
      { label: 'Company cost', value: 'EGP 350,000.00' },
    ]);
  });
});
