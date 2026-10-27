import {
  isReportMonth,
  SI_FORM_STATE_LABELS,
  SI_MISSING_ITEMS,
  SI_MISSING_LABELS,
  SI_PRINT_STATE_LABELS,
  SI_REGISTER_STATUS_DEFAULT,
  SI_REGISTER_STATUS_LABELS,
  SI_REGISTER_STATUSES,
  SI_REPORT_VIEW_LABELS,
  SI_REPORT_VIEWS,
  siMarksText,
  siMonthMarks,
  siPercent,
  STANDING_LABELS,
  type Role,
  type SiContributionsReport,
  type SiFormState,
  type SiMissingItem,
  type SiMissingReport,
  type SiMonthRow,
  type SiPrintState,
  type SiRates,
  type SiRegisterReport,
  type SiRegisterRow,
  type SiRegisterStatus,
  type SiReportView,
  type Standing,
} from '@trendlix/shared';
import { formatDate } from '../../../../../lib/format';
import { isHidden } from '../../../../../lib/hidden';
import { hasRole } from '../../../../../lib/roles';
import { formatEgp } from '../../../employees/[id]/contracts/salary';
import { insurableLimitsText, printHref } from '../../../employees/[id]/insurance/insurance';
import { profileHref } from '../../../employees/tab-list';

// The Social Insurance report (owner, 27 October 2026: "is there a report for the social insurance? to be filled from the
// social insurance tab"; asked which, he chose all three: the insured staff register, the monthly contributions and the
// missing data checklist), under Payroll → Reports beside Payroll vs Social Insurance: one page, the three views as tabs,
// each with its Excel download. Plain helpers for the page (no server-only, so they are unit tested): who sees which
// view, the filters read from the address and the addresses that keep them, the tiles and each row in words. Relative
// imports: the tests run without the "@/" alias. Salary data: HR, Finance and the CEO; the missing data (the employee
// file's forms and print) HR and the CEO; the API checks it again.

type WithRoles = { roles: readonly Role[] };
type Query = Record<string, string | string[] | undefined>;

/** Under Payroll → Reports, beside Payroll vs Social Insurance. */
export const SOCIAL_INSURANCE_PATH = '/payroll/reports/social-insurance';

/** HR, Finance and the CEO, who see salaries, as the payroll reports; the API checks it again. */
export const SOCIAL_INSURANCE_ROLES: readonly Role[] = ['hr', 'finance', 'ceo'];
export const canSeeSocialInsurance = (user: WithRoles) => hasRole(user, ...SOCIAL_INSURANCE_ROLES);

/** The missing data names the employee file's forms and print: HR and the CEO, as the Missing Details report. */
export const seesMissingData = (user: WithRoles) => hasRole(user, 'hr', 'ceo');

// ---------- the filters ----------

/** The view and its filters as the page's address has them. */
export interface SiFilters {
  view: SiReportView;
  /** A department (with its teams) or a team; null for everyone. */
  department: string | null;
  /** The register's. */
  status: SiRegisterStatus;
  /** The contributions' month, YYYY-MM. */
  month: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v.trim() : '');
const oneOf = <T extends string>(value: string, allowed: readonly T[]): T | '' => ((allowed as readonly string[]).includes(value) ? (value as T) : '');

/** The filters in the page's address; anything it can't read is left out, as if not chosen: the register, everyone, current employees, this month. */
export function readFilters(query: Query, today: string): SiFilters {
  const department = one(query.department);
  const month = one(query.month);
  return {
    view: oneOf(one(query.view), SI_REPORT_VIEWS) || 'register',
    department: UUID.test(department) ? department : null,
    status: oneOf(one(query.status), SI_REGISTER_STATUSES) || SI_REGISTER_STATUS_DEFAULT,
    month: isReportMonth(month) ? month : today.slice(0, 7),
  };
}

/** The filters a view takes, in a fixed order, the defaults left out (the month always when `month`). */
function paramsOf(f: SiFilters, department: 'department' | 'departmentId', today: string, month: 'always' | 'unless-this-month'): URLSearchParams {
  const params = new URLSearchParams();
  if (f.department) params.set(department, f.department);
  if (f.view === 'register' && f.status !== SI_REGISTER_STATUS_DEFAULT) params.set('status', f.status);
  if (f.view === 'contributions' && (month === 'always' || f.month !== today.slice(0, 7))) params.set('month', f.month);
  return params;
}

function withQuery(path: string, params: URLSearchParams): string {
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

/** The page's address for a view and its filters: plain for the register with nothing chosen, as Reports links to it. */
export function reportHref(f: SiFilters, today: string): string {
  const params = paramsOf(f, 'department', today, 'unless-this-month');
  const view = f.view === 'register' ? '' : `view=${f.view}`;
  const rest = params.toString();
  const qs = [view, rest].filter(Boolean).join('&');
  return qs ? `${SOCIAL_INSURANCE_PATH}?${qs}` : SOCIAL_INSURANCE_PATH;
}

/** The API's view for these filters (only what the view takes: the API refuses anything else). */
export const apiReportPath = (f: SiFilters, today: string) => withQuery(`/payroll/social-insurance/${f.view}`, paramsOf(f, 'departmentId', today, 'always'));

/** Where the browser downloads the view's workbook (a plain link, never prefetched): the view and its filters, the month written out. */
export function excelHref(f: SiFilters, today: string): string {
  const params = paramsOf(f, 'department', today, 'always');
  const rest = params.toString();
  return `${SOCIAL_INSURANCE_PATH}/excel?view=${f.view}${rest ? `&${rest}` : ''}`;
}

/** The API's workbook for the view a download asks for (excel/route.ts), read as the page reads it. */
export function apiExcelPath(params: URLSearchParams, today: string): string {
  const f = readFilters(Object.fromEntries(params), today);
  return withQuery(`/payroll/social-insurance/${f.view}/workbook`, paramsOf(f, 'departmentId', today, 'always'));
}

/** The views as tabs, each keeping the department; the missing data only for those who see it. */
export function viewTabs(f: SiFilters, today: string, missing: boolean): { key: SiReportView; label: string; href: string }[] {
  return SI_REPORT_VIEWS.filter((v) => v !== 'missing' || missing).map((view) => ({
    key: view,
    label: SI_REPORT_VIEW_LABELS[view],
    href: reportHref({ ...f, view }, today),
  }));
}

/** The register's statuses, as its filter offers them. */
export const STATUS_OPTIONS = SI_REGISTER_STATUSES.map((s) => ({ value: s, label: SI_REGISTER_STATUS_LABELS[s] }));

// ---------- the year's rates ----------

/** The shares' headings with the year's rates: "Employee 11%", "Company 18.75%". */
export const shareHeads = (rates: SiRates) => ({ employee: `Employee ${siPercent(rates.employeeInsuranceRate)}`, employer: `Company ${siPercent(rates.employerInsuranceRate)}` });

/** "EGP 2,700.00 to 16,700.00 in 2026", as the Social Insurance tab says it. */
export const limitsText = (rates: SiRates) => insurableLimitsText({ year: rates.year, min: rates.insurableWageMin, max: rates.insurableWageMax });

// ---------- the tiles ----------

export interface Tile {
  key: string;
  label: string;
  value: string;
  note: string | null;
}

/** "1 person", "3 people". */
export const peopleLabel = (n: number) => `${n} ${n === 1 ? 'person' : 'people'}`;

/** The register's figures: who is listed, their insured wages and both shares a month. */
export function registerTiles(r: Pick<SiRegisterReport, 'totals' | 'rates' | 'notRegistered'>): Tile[] {
  const t = r.totals;
  const heads = shareHeads(r.rates);
  return [
    { key: 'people', label: 'Registered', value: String(t.people), note: r.notRegistered > 0 ? `${r.notRegistered} under the labour law not registered` : null },
    { key: 'insured', label: 'Insured wages', value: formatEgp(t.insuredWage), note: t.insured < t.people ? `${peopleLabel(t.people - t.insured)} without an insured wage` : 'A month' },
    { key: 'employee', label: `${heads.employee} a month`, value: formatEgp(t.employeeInsurance), note: 'Deducted from their pay' },
    { key: 'employer', label: `${heads.employer} a month`, value: formatEgp(t.employerInsurance), note: 'Paid by the company' },
  ];
}

/** The month's figures: who is counted, joiners and leavers, both shares and what is paid to the insurance office. */
export function contributionTiles(r: Pick<SiContributionsReport, 'totals' | 'rates'>): Tile[] {
  const t = r.totals;
  const heads = shareHeads(r.rates);
  return [
    { key: 'people', label: 'Insured', value: String(t.people), note: `${t.joined} joined, ${t.left} left` },
    { key: 'insured', label: 'Insured wages', value: formatEgp(t.insuredWage), note: t.insured < t.people ? `${peopleLabel(t.people - t.insured)} without an insured wage` : null },
    { key: 'employee', label: heads.employee, value: formatEgp(t.employeeInsurance), note: null },
    { key: 'employer', label: heads.employer, value: formatEgp(t.employerInsurance), note: null },
    { key: 'toPay', label: 'To pay the office', value: formatEgp(t.toPay), note: 'Both shares' },
  ];
}

/** The checklist's figures: who was checked, who misses something, and how many miss each item. */
export function missingTiles(r: Pick<SiMissingReport, 'checked' | 'rows' | 'byItem'>): Tile[] {
  return [
    { key: 'checked', label: 'Checked', value: String(r.checked), note: 'Full time, and registered part-timers' },
    { key: 'missing', label: 'Missing something', value: String(r.rows.length), note: `${peopleLabel(r.checked - r.rows.length)} complete` },
    ...SI_MISSING_ITEMS.filter((i) => r.byItem[i] > 0).map((i) => ({ key: i, label: SI_MISSING_LABELS[i], value: String(r.byItem[i]), note: null })),
  ];
}

// ---------- each row in words ----------

/** What a figure shows, and where it came from when it isn't the employee's own ("default", "join date"); null for none. */
export type Shown = { text: string; from: string | null } | null;

export const standingText = (standing: Standing | string) => (isHidden(standing) ? 'Hidden' : (STANDING_LABELS[standing as Standing] ?? standing));

/** The subscription start Form 1 prints: the employee's own, else the join date (saying so); null when neither came (a developer). */
export function startText(row: Pick<SiRegisterRow, 'insuranceStartDate' | 'joinDate'>): Shown {
  if (row.insuranceStartDate) return { text: formatDate(row.insuranceStartDate), from: null };
  return row.joinDate ? { text: formatDate(row.joinDate), from: 'join date' } : null;
}

/** The basic wage: the employee's own, else the default ("EGP 410.00 · default"). */
export const basicText = (row: Pick<SiRegisterRow, 'insuranceBasicWage' | 'basicFrom'>): Shown => ({ text: formatEgp(row.insuranceBasicWage), from: row.basicFrom === 'default' ? 'default' : null });

/** The comprehensive wage: the employee's own, else the contract's gross and allowances; null with neither. */
export function comprehensiveText(row: Pick<SiRegisterRow, 'insuranceComprehensiveWage' | 'comprehensiveFrom'>): Shown {
  if (row.insuranceComprehensiveWage === null) return null;
  return { text: formatEgp(row.insuranceComprehensiveWage), from: row.comprehensiveFrom === 'contract' ? 'contract' : null };
}

/** The insured wage, and when it isn't the comprehensive wage as it is: "capped at the maximum", "raised to the minimum". */
export function insuredText(row: Pick<SiRegisterRow, 'insuredWage' | 'insuranceComprehensiveWage'>): Shown {
  if (row.insuredWage === null) return null;
  const c = row.insuranceComprehensiveWage;
  const from = c === null || c === row.insuredWage ? null : row.insuredWage < c ? 'capped at the maximum' : 'raised to the minimum';
  return { text: formatEgp(row.insuredWage), from };
}

/** A share, or a dash for someone without an insured wage. */
export const shareText = (n: number | null) => (n === null ? null : formatEgp(n));

/** Both shares of a month's row. */
export const bothShares = (row: Pick<SiMonthRow, 'employeeInsurance' | 'employerInsurance'>): number | null =>
  row.employeeInsurance === null || row.employerInsurance === null ? null : Math.round((row.employeeInsurance + row.employerInsurance) * 100) / 100;

/** How someone's employment ends: "Left 30/09/2026", "Leaving 20/11/2026"; null without an end. */
export function leftText(row: { leftOn: string | null }, today: string): string | null {
  if (!row.leftOn) return null;
  return `${row.leftOn <= today ? 'Left' : 'Leaving'} ${formatDate(row.leftOn)}`;
}

/** A form's state in words; null when not the caller's to see. */
export const formText = (state: SiFormState | null) => (state ? SI_FORM_STATE_LABELS[state] : null);

/** The badge's colour: done (verified, received) ok, to do (not generated, not received) warn, in between accent, else muted. */
export function stateTone(state: SiFormState | SiPrintState): 'ok' | 'warn' | 'accent' | 'muted' {
  if (state === 'verified' || state === 'received') return 'ok';
  if (state === 'not_generated' || state === 'not_received') return 'warn';
  if (state === 'generated' || state === 'printed' || state === 'signed') return 'accent';
  return 'muted';
}

/** The print in words: "Received 04/03/2026", "Not received", "Not needed"; null when not the caller's to see. */
export function printText(row: Pick<SiRegisterRow, 'print' | 'printReceivedOn'>): string | null {
  if (!row.print) return null;
  return row.print === 'received' && row.printReceivedOn ? `Received ${formatDate(row.printReceivedOn)}` : SI_PRINT_STATE_LABELS[row.print];
}

/** Joined or left in the month: "Joined", "Left", "Joined and left"; null for neither. */
export const marksText = (row: Pick<SiMonthRow, 'joinDate' | 'leftOn'>, month: string) => siMarksText(siMonthMarks(row, month));

/** Where someone's social insurance is kept: their profile's Social Insurance tab. */
export const insuranceTabHref = (row: { employee: { id: string } }) => profileHref(row.employee.id, 'insurance');

/**
 * Each missing item with where it is filled in: the insurance number on Basic Data, the print on the Documents tab (its
 * row in the employee file's checklist), the rest on the Social Insurance tab.
 */
export function missingLinks(row: { employee: { id: string }; missing: readonly SiMissingItem[] }): { key: SiMissingItem; label: string; href: string }[] {
  const id = row.employee.id;
  const where = (item: SiMissingItem) => (item === 'insurance_no' ? profileHref(id, 'basic') : item === 'print' ? printHref(id, true) : profileHref(id, 'insurance'));
  return row.missing.map((item) => ({ key: item, label: SI_MISSING_LABELS[item], href: where(item) }));
}
