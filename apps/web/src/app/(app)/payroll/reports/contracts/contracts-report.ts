import {
  CONTRACT_FORM_LABELS,
  CONTRACT_FORMS,
  CONTRACT_VERSION_KIND_LABELS,
  CONTRACTS_REPORT_SHOW_DEFAULT,
  CONTRACTS_REPORT_SHOW_LABELS,
  CONTRACTS_REPORT_SHOWS,
  CONTRACTS_REPORT_STATUS_DEFAULT,
  CONTRACTS_REPORT_STATUS_FILTER_LABELS,
  CONTRACTS_REPORT_STATUS_LABELS,
  CONTRACTS_REPORT_STATUSES,
  departmentOf,
  EMPLOYEE_STANDING_LABELS,
  EMPLOYMENT_TYPES,
  LABELS,
  type ContractForm,
  type ContractsReport,
  type ContractsReportRow,
  type ContractsReportShow,
  type ContractsReportStatus,
  type ContractsReportTotals,
  type EmploymentType,
  type ReportPeriod,
  type Role,
} from '@trendlix/shared';
import { labelOf } from '../../../../../lib/hidden';
import { hasRole } from '../../../../../lib/roles';
import { CONTRACTS_ROLES, ENDING_WITHIN_DAYS } from '../../../contracts/list';
import { contractHref, employmentHref, salaryHistoryHref } from '../../../employees/tab-list';
import { readPeriod } from '../salary-raises/salary-raises';

// The Contracts report (owner, 25 October 2026: "if i want to export a contracts report, status, start and end dates,
// how?"; asked, "A report under Reports", a page of its own beside Salary Raises under Payroll → Reports, and "Dates and
// status": no salary or allowances in it), for HR, Finance and the CEO, as the Contracts page. For a period of months
// (this calendar year unless the address asks for another) and the Contracts page's filters: the totals and each
// contract version with its dates and status. Plain helpers for the page (no server-only, so they are unit tested): who
// sees it, the filters read from the address and the addresses that keep them, the tiles and each row in words.
// Relative imports: the tests run without the "@/" alias.

type WithRoles = { roles: readonly Role[] };
type Query = Record<string, string | string[] | undefined>;

/**
 * GET /reports/contracts: the report, as of when it was made. `confidentialExcluded`: how many C-level people it leaves
 * out for the caller (owner, 19 October 2026: "make C level Employees details not visible to HR"); 0 for the CEO and
 * the Super Admin.
 */
export type ContractsReportView = ContractsReport & { generatedAt: string; confidentialExcluded?: number };

/** Under Payroll → Reports, beside Salary Raises. */
export const CONTRACTS_REPORT_PATH = '/payroll/reports/contracts';

/** HR, Finance and the CEO, as the Contracts page; the API checks it again. */
export const canSeeContractsReport = (user: WithRoles) => hasRole(user, ...CONTRACTS_ROLES);

// ---------- the filters ----------

/** The report's filters as the page's address has them. */
export interface ReportFilters {
  period: ReportPeriod;
  status: ContractsReportStatus;
  show: ContractsReportShow;
  type: EmploymentType | '';
  form: ContractForm | '';
  /** A department (with its teams) or a team. */
  department: string | null;
  /** The Contracts page's choices: 30, 60 or 90 days; null for any time. */
  endingWithin: number | null;
  q: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v.trim() : '');
const oneOf = <T extends string>(value: string, allowed: readonly T[]): T | '' => ((allowed as readonly string[]).includes(value) ? (value as T) : '');

/** The filters in the page's address; anything it can't read is left out, as if not chosen (the period as Salary Raises reads it). */
export function readFilters(query: Query, today: string): ReportFilters {
  const days = Number(one(query.endingWithin));
  const department = one(query.department);
  return {
    period: readPeriod(query, today),
    status: oneOf(one(query.status), CONTRACTS_REPORT_STATUSES) || CONTRACTS_REPORT_STATUS_DEFAULT,
    show: oneOf(one(query.show), CONTRACTS_REPORT_SHOWS) || CONTRACTS_REPORT_SHOW_DEFAULT,
    type: oneOf(one(query.type), EMPLOYMENT_TYPES),
    form: oneOf(one(query.form), CONTRACT_FORMS),
    department: UUID.test(department) ? department : null,
    endingWithin: (ENDING_WITHIN_DAYS as readonly number[]).includes(days) ? days : null,
    q: one(query.q).slice(0, 100),
  };
}

/** The filters with nothing chosen, for a period. */
export const noFilters = (period: ReportPeriod): ReportFilters => ({
  period,
  status: CONTRACTS_REPORT_STATUS_DEFAULT,
  show: CONTRACTS_REPORT_SHOW_DEFAULT,
  type: '',
  form: '',
  department: null,
  endingWithin: null,
  q: '',
});

/** Whether a filter other than the period is chosen (Signed and the latest version are no choices). */
export function isFiltered(f: ReportFilters): boolean {
  return Boolean(f.q || f.type || f.form || f.department || f.endingWithin !== null || f.status !== CONTRACTS_REPORT_STATUS_DEFAULT || f.show !== CONTRACTS_REPORT_SHOW_DEFAULT);
}

const isThisYear = (p: ReportPeriod, today: string) => p.from === `${today.slice(0, 4)}-01` && p.to === `${today.slice(0, 4)}-12`;

/** The filters as a query, in a fixed order, the defaults left out; the period too unless `period` (always for the API and the download). */
function queryOf(f: ReportFilters, department: 'department' | 'departmentId', period: boolean): string {
  const params = new URLSearchParams();
  if (period) {
    params.set('from', f.period.from);
    params.set('to', f.period.to);
  }
  if (f.q) params.set('q', f.q);
  if (f.status !== CONTRACTS_REPORT_STATUS_DEFAULT) params.set('status', f.status);
  if (f.type) params.set('type', f.type);
  if (f.form) params.set('form', f.form);
  if (f.department) params.set(department, f.department);
  if (f.endingWithin !== null) params.set('endingWithin', String(f.endingWithin));
  if (f.show !== CONTRACTS_REPORT_SHOW_DEFAULT) params.set('show', f.show);
  return params.toString();
}

const withQuery = (path: string, qs: string) => (qs ? `${path}?${qs}` : path);

/** The page's address for these filters: plain for this calendar year with nothing chosen, as Reports links to it. */
export const reportHref = (f: ReportFilters, today: string) => withQuery(CONTRACTS_REPORT_PATH, queryOf(f, 'department', !isThisYear(f.period, today)));

/** The API's report for these filters. */
export const apiReportPath = (f: ReportFilters) => `/reports/contracts?${queryOf(f, 'departmentId', true)}`;

/** Where the browser downloads the workbook (a plain link, never prefetched): the page's filters, the period always written out. */
export const excelHref = (f: ReportFilters) => `${CONTRACTS_REPORT_PATH}/excel?${queryOf(f, 'department', true)}`;

/** The API's workbook for the filters a download asks for (excel/route.ts), read as the page reads them. */
export const apiExcelPath = (params: URLSearchParams, today: string) => `/reports/contracts.xlsx?${queryOf(readFilters(Object.fromEntries(params), today), 'departmentId', true)}`;

/** The filters' choices, as the form offers them (the Contracts page's for type, length and ending within). */
export const STATUS_OPTIONS = CONTRACTS_REPORT_STATUSES.map((s) => ({ value: s, label: CONTRACTS_REPORT_STATUS_FILTER_LABELS[s] }));
export const SHOW_OPTIONS = CONTRACTS_REPORT_SHOWS.map((s) => ({ value: s, label: CONTRACTS_REPORT_SHOW_LABELS[s] }));
export const TYPE_OPTIONS = [{ value: '', label: 'All types' }, ...EMPLOYMENT_TYPES.map((t) => ({ value: t, label: LABELS.employmentType[t] }))];
export const ENDING_OPTIONS = [{ value: '', label: 'Any time' }, ...ENDING_WITHIN_DAYS.map((d) => ({ value: String(d), label: `${d} days` }))];

// ---------- the totals ----------

export interface Tile {
  key: string;
  label: string;
  value: string;
  note: string | null;
}

/** "1 person", "3 people". */
const peopleLabel = (n: number) => `${n} ${n === 1 ? 'person' : 'people'}`;

/** The figures the report opens with: by status, then what ends soon, what wasn't renewed and the renewals signed. */
export function summaryTiles(t: ContractsReportTotals): Tile[] {
  return [
    { key: 'contracts', label: 'Contracts', value: String(t.contracts), note: peopleLabel(t.people) },
    { key: 'active', label: CONTRACTS_REPORT_STATUS_LABELS.active, value: String(t.byStatus.active), note: 'Signed, in force' },
    { key: 'draft', label: 'Drafts', value: String(t.byStatus.draft), note: 'Not signed yet' },
    { key: 'ended', label: CONTRACTS_REPORT_STATUS_LABELS.ended, value: String(t.byStatus.ended), note: 'With the employment' },
    { key: 'superseded', label: CONTRACTS_REPORT_STATUS_LABELS.superseded, value: String(t.byStatus.superseded), note: 'By a later version' },
    ...t.endingIn.map((e) => ({ key: `ending-${e.days}`, label: `Ending in ${e.days} days`, value: String(e.count), note: 'Active, from today' })),
    { key: 'not-renewed', label: 'Not renewed', value: String(t.notRenewed), note: 'Ended in the period, no later version signed' },
    { key: 'renewals', label: 'Renewals signed', value: String(t.renewalsSigned), note: 'In the period' },
  ];
}

// ---------- the rows ----------

/** Where the employee is: their profile's Employment tab. */
export const employeeHref = (r: Pick<ContractsReportRow, 'employee'>) => employmentHref(r.employee.id);

/**
 * Where the contract is: the active one and the draft on the Employment tab's Contract section (#contract); a replaced
 * or an ended version in the Salary History, which lists every version of every employment.
 */
export const contractLink = (r: Pick<ContractsReportRow, 'employee' | 'status'>) =>
  r.status === 'active' || r.status === 'draft' ? contractHref(r.employee.id) : salaryHistoryHref(r.employee.id);

/** "19 days", "1 day", "Ends today", "−5 days" once past; "Ended" for an ended contract; null for none. */
export function daysLeftText(r: Pick<ContractsReportRow, 'status' | 'daysLeft'>): string | null {
  if (r.status === 'ended') return 'Ended';
  const n = r.daysLeft;
  if (n === null) return null;
  if (n === 0) return 'Ends today';
  const count = `${Math.abs(n).toLocaleString('en-US')} ${Math.abs(n) === 1 ? 'day' : 'days'}`;
  return n < 0 ? `−${count}` : count;
}

/** Whether the days left are worth a look: past the end, or within 30 days. */
export const endsSoon = (r: Pick<ContractsReportRow, 'daysLeft'>) => r.daysLeft !== null && r.daysLeft <= 30;

export interface RowView {
  department: string | null;
  team: string | null;
  kind: string;
  type: string;
  length: string;
  status: string;
  employeeStatus: string;
  daysLeft: string | null;
}

/** A row's words: its place split into department and team, its kind, type, length and statuses. */
export function rowView(r: ContractsReportRow): RowView {
  return {
    department: departmentOf(r.department)?.nameEn ?? null,
    team: r.department?.parent ? r.department.nameEn : null,
    kind: CONTRACT_VERSION_KIND_LABELS[r.kind] ?? r.kind,
    type: labelOf(LABELS.employmentType, r.employmentType) ?? r.employmentType,
    length: CONTRACT_FORM_LABELS[r.form as ContractForm] ?? r.form,
    status: CONTRACTS_REPORT_STATUS_LABELS[r.status] ?? r.status,
    employeeStatus: EMPLOYEE_STANDING_LABELS[r.employeeStatus] ?? r.employeeStatus,
    daysLeft: daysLeftText(r),
  };
}

/** "1 contract", "12 contracts". */
export const contractsLabel = (n: number) => `${n} ${n === 1 ? 'contract' : 'contracts'}`;
