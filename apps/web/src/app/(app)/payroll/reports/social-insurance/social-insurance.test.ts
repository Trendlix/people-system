import type { Role, SiMissingReport, SiRegisterReport, SiRegisterRow } from '@trendlix/shared';
import { describe, expect, it } from 'vitest';
import {
  apiExcelPath,
  apiReportPath,
  basicText,
  bothShares,
  canSeeSocialInsurance,
  comprehensiveText,
  contributionTiles,
  excelHref,
  insuranceTabHref,
  insuredText,
  leftText,
  limitsText,
  marksText,
  missingLinks,
  missingTiles,
  printText,
  readFilters,
  registerTiles,
  reportHref,
  seesMissingData,
  shareHeads,
  standingText,
  startText,
  stateTone,
  viewTabs,
  type SiFilters,
} from './social-insurance';

// The Social Insurance report's helpers (owner, 27 October 2026: "is there a report for the social insurance? to be filled
// from the social insurance tab"; he chose all three: the register, the monthly contributions and the missing data).
// Today is 27 October 2026. Every figure is invented.

const TODAY = '2026-10-27';
const DEPARTMENT = '7f1c2b9e-3a4d-4e5f-8a6b-1c2d3e4f5a6b';
const as = (...roles: Role[]) => ({ roles });
const RATES = { year: 2026, employeeInsuranceRate: 0.11, employerInsuranceRate: 0.1875, insurableWageMin: 2700, insurableWageMax: 16700 };
const filters = (over: Partial<SiFilters> = {}): SiFilters => ({ view: 'register', department: null, status: 'current', month: '2026-10', ...over });

const row = (over: Partial<SiRegisterRow> = {}): SiRegisterRow => ({
  employee: { id: 'e1', employeeCode: 'EMP-0001', fullNameEn: 'Rana', fullNameAr: 'رنا' },
  employmentId: 'm1',
  department: null,
  employmentType: 'full_time',
  standing: 'active',
  joinDate: '2026-02-01',
  leftOn: null,
  insuranceNo: '12345678',
  nationalId: '•••• 1234',
  occupationCode: '194200',
  occupationName: 'اخصائي موارد بشريه',
  insuranceStartDate: null,
  insuranceBasicWage: 410,
  basicFrom: 'default',
  insuranceComprehensiveWage: 20000,
  comprehensiveFrom: 'contract',
  insuredWage: 16700,
  employeeInsurance: 1837,
  employerInsurance: 3131.25,
  form1: 'printed',
  form6: 'not_due',
  print: 'received',
  printReceivedOn: '2026-03-04',
  ...over,
});

describe('who sees it', () => {
  it('the register and the contributions: HR, Finance and the CEO, as the payroll reports', () => {
    for (const r of ['hr', 'finance', 'ceo'] as const) expect(canSeeSocialInsurance(as(r))).toBe(true);
    for (const r of ['admin', 'super_admin', 'employee'] as const) expect(canSeeSocialInsurance(as(r))).toBe(false);
  });

  it('the missing data: HR and the CEO, who see the employee file', () => {
    expect(seesMissingData(as('hr'))).toBe(true);
    expect(seesMissingData(as('ceo'))).toBe(true);
    expect(seesMissingData(as('finance'))).toBe(false);
  });
});

describe('the address', () => {
  it('reads the view and its filters, leaving out what it can’t read', () => {
    expect(readFilters({}, TODAY)).toEqual(filters());
    expect(readFilters({ view: 'contributions', month: '2026-08', department: DEPARTMENT, status: 'former' }, TODAY)).toEqual({
      view: 'contributions',
      month: '2026-08',
      department: DEPARTMENT,
      status: 'former',
    });
    expect(readFilters({ view: 'charts', month: '2026-13', department: 'sales', status: 'retired' }, TODAY)).toEqual(filters());
  });

  it('keeps the page’s address plain for the register with nothing chosen, each view with its own filters', () => {
    expect(reportHref(filters(), TODAY)).toBe('/payroll/reports/social-insurance');
    expect(reportHref(filters({ status: 'former', department: DEPARTMENT }), TODAY)).toBe(`/payroll/reports/social-insurance?department=${DEPARTMENT}&status=former`);
    // this month is the contributions' default: left out; the register's status isn't the month's
    expect(reportHref(filters({ view: 'contributions', status: 'former' }), TODAY)).toBe('/payroll/reports/social-insurance?view=contributions');
    expect(reportHref(filters({ view: 'contributions', month: '2026-08' }), TODAY)).toBe('/payroll/reports/social-insurance?view=contributions&month=2026-08');
    expect(reportHref(filters({ view: 'missing', status: 'former', month: '2026-08' }), TODAY)).toBe('/payroll/reports/social-insurance?view=missing');
  });

  it('asks the API only what each view takes, as it refuses anything else', () => {
    expect(apiReportPath(filters({ department: DEPARTMENT, status: 'all' }), TODAY)).toBe(`/payroll/social-insurance/register?departmentId=${DEPARTMENT}&status=all`);
    expect(apiReportPath(filters({ view: 'contributions' }), TODAY)).toBe('/payroll/social-insurance/contributions?month=2026-10');
    expect(apiReportPath(filters({ view: 'missing', status: 'former' }), TODAY)).toBe('/payroll/social-insurance/missing');
  });

  it('downloads the view’s workbook with its filters, the month always written out', () => {
    expect(excelHref(filters(), TODAY)).toBe('/payroll/reports/social-insurance/excel?view=register');
    expect(excelHref(filters({ view: 'contributions', department: DEPARTMENT }), TODAY)).toBe(`/payroll/reports/social-insurance/excel?view=contributions&department=${DEPARTMENT}&month=2026-10`);
    expect(apiExcelPath(new URLSearchParams({ view: 'contributions', department: DEPARTMENT, month: '2026-09' }), TODAY)).toBe(
      `/payroll/social-insurance/contributions/workbook?departmentId=${DEPARTMENT}&month=2026-09`,
    );
    expect(apiExcelPath(new URLSearchParams({ view: 'register', status: 'former' }), TODAY)).toBe('/payroll/social-insurance/register/workbook?status=former');
    expect(apiExcelPath(new URLSearchParams({ view: 'missing' }), TODAY)).toBe('/payroll/social-insurance/missing/workbook');
  });

  it('offers the views as tabs, keeping the department; the missing data only for those who see it', () => {
    const tabs = viewTabs(filters({ department: DEPARTMENT, status: 'former' }), TODAY, true);
    expect(tabs.map((t) => [t.key, t.label])).toEqual([
      ['register', 'Register'],
      ['contributions', 'Monthly contributions'],
      ['missing', 'Missing data'],
    ]);
    expect(tabs[1].href).toBe(`/payroll/reports/social-insurance?view=contributions&department=${DEPARTMENT}`);
    expect(viewTabs(filters(), TODAY, false).map((t) => t.key)).toEqual(['register', 'contributions']);
  });
});

describe('the figures in words', () => {
  it('the rates and the limits', () => {
    expect(shareHeads(RATES)).toEqual({ employee: 'Employee 11%', employer: 'Company 18.75%' });
    expect(limitsText(RATES)).toBe('EGP 2,700.00 to 16,700.00 in 2026');
  });

  it('what Form 1 prints, and where it came from when it isn’t the employee’s own', () => {
    expect(startText(row())).toEqual({ text: '01/02/2026', from: 'join date' });
    expect(startText(row({ insuranceStartDate: '2026-03-01' }))).toEqual({ text: '01/03/2026', from: null });
    // a developer gets neither date
    expect(startText(row({ joinDate: null as unknown as string }))).toBeNull();
    expect(basicText(row())).toEqual({ text: 'EGP 410.00', from: 'default' });
    expect(comprehensiveText(row())).toEqual({ text: 'EGP 20,000.00', from: 'contract' });
    expect(comprehensiveText(row({ insuranceComprehensiveWage: null }))).toBeNull();
  });

  it('the insured wage, capped or raised when it isn’t the comprehensive wage as it is', () => {
    expect(insuredText(row())).toEqual({ text: 'EGP 16,700.00', from: 'capped at the maximum' });
    expect(insuredText(row({ insuranceComprehensiveWage: 1500, insuredWage: 2700 }))).toEqual({ text: 'EGP 2,700.00', from: 'raised to the minimum' });
    expect(insuredText(row({ insuranceComprehensiveWage: 9000, insuredWage: 9000 }))).toEqual({ text: 'EGP 9,000.00', from: null });
    expect(insuredText(row({ insuredWage: null }))).toBeNull();
  });

  it('the status, the end, the forms and the print', () => {
    expect(standingText('notice_period')).toBe('Notice period');
    expect(standingText('••••')).toBe('Hidden');
    expect(leftText(row({ leftOn: '2026-09-30' }), TODAY)).toBe('Left 30/09/2026');
    expect(leftText(row({ leftOn: '2026-11-20' }), TODAY)).toBe('Leaving 20/11/2026');
    expect(leftText(row(), TODAY)).toBeNull();
    expect(printText(row())).toBe('Received 04/03/2026');
    expect(printText(row({ print: 'not_received', printReceivedOn: null }))).toBe('Not received');
    expect(printText(row({ print: null }))).toBeNull();
    expect(stateTone('verified')).toBe('ok');
    expect(stateTone('not_generated')).toBe('warn');
    expect(stateTone('printed')).toBe('accent');
    expect(stateTone('not_due')).toBe('muted');
  });

  it('a month’s marks and both shares', () => {
    expect(marksText({ joinDate: '2026-10-12', leftOn: null }, '2026-10')).toBe('Joined');
    expect(marksText({ joinDate: '2026-02-01', leftOn: '2026-10-20' }, '2026-10')).toBe('Left');
    expect(marksText({ joinDate: '2026-02-01', leftOn: null }, '2026-10')).toBeNull();
    expect(bothShares({ employeeInsurance: 297.06, employerInsurance: 506.35 })).toBe(803.41);
    expect(bothShares({ employeeInsurance: null, employerInsurance: null })).toBeNull();
  });
});

describe('the tiles', () => {
  it('the register: who is registered, who isn’t, the wages and both shares a month', () => {
    const report = { rates: RATES, notRegistered: 2, totals: { people: 3, insured: 2, insuredWage: 28700, employeeInsurance: 3157, employerInsurance: 5381.25, toPay: 8538.25 } } as SiRegisterReport;
    expect(registerTiles(report).map((t) => [t.label, t.value, t.note])).toEqual([
      ['Registered', '3', '2 under the labour law not registered'],
      ['Insured wages', 'EGP 28,700.00', '1 person without an insured wage'],
      ['Employee 11% a month', 'EGP 3,157.00', 'Deducted from their pay'],
      ['Company 18.75% a month', 'EGP 5,381.25', 'Paid by the company'],
    ]);
  });

  it('the month: joiners and leavers, and what is paid to the office', () => {
    const tiles = contributionTiles({ rates: RATES, totals: { people: 2, insured: 2, insuredWage: 28700, employeeInsurance: 3157, employerInsurance: 5381.25, toPay: 8538.25, joined: 1, left: 1 } });
    expect(tiles[0]).toMatchObject({ label: 'Insured', value: '2', note: '1 joined, 1 left' });
    expect(tiles.at(-1)).toMatchObject({ label: 'To pay the office', value: 'EGP 8,538.25' });
  });

  it('the missing data: the counts, only the items someone misses', () => {
    const report = {
      checked: 5,
      rows: [{}, {}],
      byItem: { not_registered: 1, insurance_no: 2, occupation: 0, start_date: 2, form_1: 0, print: 1 },
    } as unknown as SiMissingReport;
    expect(missingTiles(report).map((t) => [t.label, t.value])).toEqual([
      ['Checked', '5'],
      ['Missing something', '2'],
      ['Not registered with social insurance', '1'],
      ['Insurance number', '2'],
      ['Subscription start', '2'],
      ['Social insurance print not received', '1'],
    ]);
  });
});

describe('where each is filled in', () => {
  it('the person on their Social Insurance tab; the insurance number on Basic Data, the print in the employee file', () => {
    expect(insuranceTabHref(row())).toBe('/employees/e1?tab=insurance');
    expect(missingLinks({ employee: { id: 'e1' }, missing: ['insurance_no', 'occupation', 'form_1', 'print'] })).toEqual([
      { key: 'insurance_no', label: 'Insurance number', href: '/employees/e1' },
      { key: 'occupation', label: 'Occupation', href: '/employees/e1?tab=insurance' },
      { key: 'form_1', label: 'Form 1 not generated', href: '/employees/e1?tab=insurance' },
      { key: 'print', label: 'Social insurance print not received', href: '/employees/e1?tab=documents#paper-insurance_print' },
    ]);
  });
});
