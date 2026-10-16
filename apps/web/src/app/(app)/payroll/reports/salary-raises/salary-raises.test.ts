import type { DueForReviewRow, Role, SalaryRaiseRow } from '@trendlix/shared';
import { describe, expect, it } from 'vitest';
import { contractHref, employeeRaiseRequestsHref, salaryHistoryHref as historyOnProfile } from '../../../employees/tab-list';
import {
  apiExcelPath,
  apiReportPath,
  canSeeSalaryRaises,
  costText,
  departmentLabel,
  excelHref,
  monthChoices,
  openText,
  percentText,
  periodTitle,
  quickPeriods,
  raisesHref,
  raiseView,
  readPeriod,
  reviewActions,
  reviewRuleText,
  salaryHistoryHref,
  sinceText,
  summaryTiles,
} from './salary-raises';

// The Salary Raises report's helpers (owner's decision, 16 October 2026). Today is 17 October 2026. Everyone here is
// invented.

const TODAY = '2026-10-17';
const YEAR = { from: '2026-01', to: '2026-12' };
const as = (...roles: Role[]) => ({ roles });

const RAISE: SalaryRaiseRow = {
  contractId: 'c-3',
  number: 'CON-2026-0004-A1',
  employee: { id: 'e-1', employeeCode: 'TL-0001', fullNameEn: 'Amy Example', fullNameAr: 'إيمي' },
  employmentId: 'job-1',
  department: { id: 'd-acc', nameEn: 'Accounts', parent: { id: 'd-fin', nameEn: 'Finance' } },
  jobTitle: 'Accountant',
  promotion: { jobTitle: 'Senior Accountant', grade: 'G5' },
  effectiveDate: '2026-06-01',
  upcoming: false,
  kind: 'amendment',
  reason: 'promotion',
  payBasis: 'monthly',
  gross: { from: 10000, to: 12500 },
  allowances: { from: 500, to: 500 },
  change: { amount: 2500, percent: 25 },
  monthlyCost: 2500,
  approvedBy: 'Chief Officer',
  approvedAt: '2026-05-20T07:00:00.000Z',
  signedOn: '2026-05-21',
};

const DUE: DueForReviewRow = {
  employee: { id: 'e-4', employeeCode: 'TL-0004', fullNameEn: 'Dina Example', fullNameAr: 'دينا' },
  employmentId: 'job-4',
  department: null,
  jobTitle: 'Analyst',
  joinDate: '2024-09-01',
  currentGross: 7000,
  lastRaise: null,
  monthsSince: 25,
  openRaise: null,
  openRequest: null,
};

describe('who sees the Salary Raises report', () => {
  it('is HR, Finance and the CEO, as salaries; not an Admin as such', () => {
    for (const role of ['hr', 'finance', 'ceo'] as const) expect(canSeeSalaryRaises(as(role))).toBe(true);
    for (const role of ['admin', 'super_admin', 'manager', 'employee'] as const) expect(canSeeSalaryRaises(as(role))).toBe(false);
  });
});

describe('the period', () => {
  it('is read from the address: this year unless asked, one month alone takes its year, the wrong way round swapped', () => {
    expect(readPeriod({}, TODAY)).toEqual(YEAR);
    expect(readPeriod({ from: '2025-11', to: '2026-10' }, TODAY)).toEqual({ from: '2025-11', to: '2026-10' });
    expect(readPeriod({ from: '2025-04' }, TODAY)).toEqual({ from: '2025-04', to: '2025-12' });
    expect(readPeriod({ to: '2025-03' }, TODAY)).toEqual({ from: '2025-01', to: '2025-03' });
    expect(readPeriod({ from: '2026-09', to: '2026-02' }, TODAY)).toEqual({ from: '2026-02', to: '2026-09' });
    // what it can't read is left out
    expect(readPeriod({ from: '2026-13', to: ['2026-01', '2026-02'] }, TODAY)).toEqual(YEAR);
  });

  it('keeps the period in the page’s, the workbook’s and the API’s addresses', () => {
    expect(raisesHref(YEAR, TODAY)).toBe('/payroll/reports/salary-raises');
    expect(raisesHref({ from: '2025-01', to: '2025-12' }, TODAY)).toBe('/payroll/reports/salary-raises?from=2025-01&to=2025-12');
    expect(excelHref(YEAR)).toBe('/payroll/reports/salary-raises/excel?from=2026-01&to=2026-12');
    expect(apiReportPath({ from: '2025-11', to: '2026-10' })).toBe('/reports/salary-raises?from=2025-11&to=2026-10');
    expect(apiExcelPath(new URLSearchParams('from=2025-11&to=2026-10'), TODAY)).toBe('/reports/salary-raises.xlsx?from=2025-11&to=2026-10');
    expect(apiExcelPath(new URLSearchParams('from=bad'), TODAY)).toBe('/reports/salary-raises.xlsx?from=2026-01&to=2026-12');
  });

  it('is named as the heading says it', () => {
    expect(periodTitle(YEAR)).toBe('2026');
    expect(periodTitle({ from: '2026-10', to: '2026-10' })).toBe('October 2026');
    expect(periodTitle({ from: '2026-01', to: '2026-06' })).toBe('January to June 2026');
    expect(periodTitle({ from: '2025-11', to: '2026-10' })).toBe('November 2025 to October 2026');
  });

  it('offers the months from five years back to next year, newest first, and the period’s own', () => {
    const months = monthChoices(TODAY, YEAR);
    expect(months[0]).toEqual({ value: '2027-12', label: 'December 2027' });
    expect(months.at(-1)).toEqual({ value: '2021-01', label: 'January 2021' });
    expect(months).toHaveLength(84);
    expect(monthChoices(TODAY, { from: '2019-03', to: '2026-12' }).at(-1)).toEqual({ value: '2019-03', label: 'March 2019' });
    expect(quickPeriods(TODAY).map((q) => [q.label, q.period])).toEqual([
      ['This year', YEAR],
      ['Last year', { from: '2025-01', to: '2025-12' }],
      ['Last 12 months', { from: '2025-11', to: '2026-10' }],
    ]);
  });
});

describe('the totals', () => {
  it('open the report: the raises, the people, the average with the median, and the monthly and yearly cost', () => {
    const tiles = summaryTiles({ count: 4, people: 3, averagePercent: 12.9, medianPercent: 11.3, monthlyCostIncrease: 4700, yearlyCostIncrease: 56400 });
    expect(tiles.map((t) => [t.label, t.value, t.note])).toEqual([
      ['Raises', '4', null],
      ['People', '3', 'Someone with two raises counts once'],
      ['Average raise', '+12.9%', 'Median +11.3%'],
      ['Monthly cost increase', '+EGP 4,700.00', 'Gross and allowances'],
      ['Yearly cost increase', '+EGP 56,400.00', 'The monthly increase × 12'],
    ]);
    const none = summaryTiles({ count: 0, people: 0, averagePercent: null, medianPercent: null, monthlyCostIncrease: 0, yearlyCostIncrease: 0 });
    expect(none.map((t) => t.value)).toEqual(['0', '0', '—', 'EGP 0.00', 'EGP 0.00']);
    expect(none[2].note).toBeNull();
  });

  it('word a cut, a percent and a department', () => {
    expect(costText(-500)).toBe('−EGP 500.00');
    expect(percentText(-10)).toBe('−10%');
    expect(percentText(null)).toBe('—');
    expect(departmentLabel({ id: 'd', nameEn: 'Finance' })).toBe('Finance');
    expect(departmentLabel(null)).toBe('No department');
  });
});

describe('a raise', () => {
  it('in words, with its person’s Salary History', () => {
    expect(raiseView(RAISE)).toEqual({
      key: 'c-3',
      effective: '01/06/2026',
      upcoming: false,
      kind: 'Amendment',
      reason: 'Promotion',
      place: 'Finance › Accounts',
      jobTitle: 'Accountant',
      promotion: 'Promoted to Senior Accountant, grade G5',
      gross: 'EGP 10,000.00 → EGP 12,500.00',
      allowances: 'EGP 500.00, as before',
      change: '+EGP 2,500.00 (+25%)',
      cost: '+EGP 2,500.00',
      approved: 'Chief Officer, 20/05/2026, 10:00 AM',
    });
    expect(raiseView({ ...RAISE, kind: 'renewal', reason: null, promotion: null, department: null, allowances: { from: 0, to: 0 }, approvedAt: null, approvedBy: null })).toMatchObject({
      kind: 'Renewal with new pay',
      reason: null,
      promotion: null,
      place: null,
      allowances: 'None',
      approved: null,
    });
    // the person's Salary History, where the profile has it
    expect(salaryHistoryHref('e-1')).toBe(historyOnProfile('e-1'));
    expect(salaryHistoryHref('e-1')).toMatch(/^\/employees\/e-1\?tab=employment.*#salary-history$/);
  });
});

describe('due for review', () => {
  it('says since when, and what is open now', () => {
    expect(sinceText(DUE)).toBe('No raise since joining on 01/09/2024, 2 years and 1 month ago');
    expect(sinceText({ ...DUE, lastRaise: '2025-10-01', monthsSince: 12 })).toBe('Last raise 01/10/2025, 1 year ago');
    expect(openText(DUE)).toBeNull();
    expect(openText({ ...DUE, openRaise: { contractId: 'c', number: 'CON-2026-0009-A1', stage: 'pending_ceo', effectiveDate: '2026-11-01' } })).toBe('A raise with the CEO, from 01/11/2026');
    expect(openText({ ...DUE, openRaise: { contractId: 'c', number: 'CON-2026-0009-A1', stage: 'draft', effectiveDate: '2026-11-01' } })).toBe('A raise HR is preparing, from 01/11/2026');
    expect(openText({ ...DUE, openRequest: { id: 'r', status: 'with_hr' } })).toBe('A raise request with HR');
    expect(openText({ ...DUE, openRequest: { id: 'r', status: 'with_ceo' } })).toBe('A raise request with the CEO');
    expect(reviewRuleText(12)).toBe('Due after 12 months without a raise');
    expect(reviewRuleText(1)).toBe('Due after 1 month without a raise');
  });

  it('HR prepares or asks for the raise, decides a request with HR, or carries on with what is open; Finance and the CEO only read', () => {
    expect(reviewActions(as('hr'), DUE)).toEqual([
      { key: 'prepare', label: 'Prepare a raise', href: '/employees/e-4/contracts/raise' },
      { key: 'request', label: 'Request a raise', href: employeeRaiseRequestsHref('e-4') },
    ]);
    expect(reviewActions(as('hr'), { ...DUE, openRequest: { id: 'r-1', status: 'with_hr' } })).toEqual([
      { key: 'decide', label: 'Decide on the request', href: employeeRaiseRequestsHref('e-4') },
    ]);
    expect(reviewActions(as('hr'), { ...DUE, openRequest: { id: 'r-1', status: 'with_ceo' } })).toEqual([
      { key: 'request', label: 'See the request', href: employeeRaiseRequestsHref('e-4') },
    ]);
    const open = { ...DUE, openRaise: { contractId: 'c', number: 'CON-2026-0009-A1', stage: 'approved' as const, effectiveDate: '2026-11-01' }, openRequest: { id: 'r-1', status: 'approved' as const } };
    expect(reviewActions(as('hr'), open)).toEqual([{ key: 'open', label: 'Open the raise', href: contractHref('e-4') }]);
    expect(employeeRaiseRequestsHref('e-4')).toMatch(/#raise-requests$/);
    expect(contractHref('e-4')).toMatch(/#contract$/);
    for (const role of ['finance', 'ceo'] as const) expect(reviewActions(as(role), DUE)).toEqual([]);
  });
});
