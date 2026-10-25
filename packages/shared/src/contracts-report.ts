// The Contracts report (owner, 25 October 2026: "if i want to export a contracts report, status, start and end dates,
// how?"; there was no export, only the Contracts page's table). Asked, the owner chose "A report under Reports", a page
// of its own with its own period and filters beside the Salary Raises report (Payroll → Reports), and "Dates and
// status": no salary or allowances in it. For a period of months (this calendar year unless asked): every contract
// version whose term touches it, from its start to its end (an open end counts as running), filtered by status (Signed
// unless asked: active, ended and replaced, drafts left out), employment type, contract length, department or team,
// "ending within" N days and a search; one row per employment (its active version, else its latest signed, else its
// draft) or every version; and the totals. Pure code: the API sends it (GET /reports/contracts) and makes its workbook
// from it (GET /reports/contracts.xlsx); the screens word it. Dates: YYYY-MM-DD.

import { CONTRACT_STATUSES, type ContractStatus } from './contracts.js';
import { payChangeOf } from './raises.js';
import { inPeriod, periodDays, type ReportDepartment, type ReportPeriod, type ReportPerson } from './salary-raises.js';

// ---------- the filters ----------

/**
 * The status filter: Signed (active, ended and replaced; the default, drafts left out), one status, or All. The
 * contract statuses are CONTRACT_STATUSES: draft, active, ended, superseded (replaced by a later version).
 */
export const CONTRACTS_REPORT_STATUSES = ['signed', 'active', 'draft', 'ended', 'superseded', 'all'] as const;
export type ContractsReportStatus = (typeof CONTRACTS_REPORT_STATUSES)[number];
export const CONTRACTS_REPORT_STATUS_DEFAULT: ContractsReportStatus = 'signed';

/** The status filter's choices, as the page and the workbook's Summary name them. */
export const CONTRACTS_REPORT_STATUS_FILTER_LABELS: Record<ContractsReportStatus, string> = {
  signed: 'Signed (active, ended and replaced)',
  active: 'Active',
  draft: 'Drafts',
  ended: 'Ended',
  superseded: 'Replaced',
  all: 'All',
};

/**
 * A version's status on the report: "Active" for the signed contract in force, as the report's filter says it (the
 * Contracts page's badge says "Signed"); a superseded version is "Replaced", as everywhere else.
 */
export const CONTRACTS_REPORT_STATUS_LABELS: Record<ContractStatus, string> = { draft: 'Draft', active: 'Active', ended: 'Ended', superseded: 'Replaced' };

/** The contract statuses a status filter keeps. */
export function reportStatuses(status: ContractsReportStatus): readonly ContractStatus[] {
  if (status === 'all') return CONTRACT_STATUSES;
  if (status === 'signed') return ['active', 'ended', 'superseded'];
  return [status];
}

/** Show: the latest version per employment (the default), or every version. */
export const CONTRACTS_REPORT_SHOWS = ['latest', 'every'] as const;
export type ContractsReportShow = (typeof CONTRACTS_REPORT_SHOWS)[number];
export const CONTRACTS_REPORT_SHOW_DEFAULT: ContractsReportShow = 'latest';
export const CONTRACTS_REPORT_SHOW_LABELS: Record<ContractsReportShow, string> = { latest: 'Latest version per employment', every: 'Every version' };

/** The ends the totals count ahead, in days: signed contracts ending in the next 30, 60 and 90 days. */
export const CONTRACTS_ENDING_DAYS = [30, 60, 90] as const;

/** What the report is asked for (GET /reports/contracts): every filter but the period optional. */
export interface ContractsReportFilters {
  period: ReportPeriod;
  status: ContractsReportStatus;
  show: ContractsReportShow;
  /** EMPLOYMENT_TYPES; the employment's. */
  employmentType: string | null;
  /** CONTRACT_FORMS: the contract's length. */
  form: string | null;
  /** A department (with its teams) or a team. */
  departmentId: string | null;
  /** Active contracts ending within this many days of today, those already past their end included (as the Contracts page). */
  endingWithin: number | null;
  /** The employee's names or code, or the contract's number; case doesn't matter. */
  q: string | null;
}

/** The filters as the report says it used them: the department or team named, for the page and the workbook's Summary. */
export type ContractsReportFiltersUsed = Omit<ContractsReportFilters, 'departmentId'> & { department: ReportDepartment | null };

// ---------- what the report reads ----------

/** A contract version as the report reads it: its dates and status, nothing of its pay. */
export interface ReportContractVersion {
  id: string;
  number: string;
  version: number;
  /** CONTRACT_KINDS: a whole contract, or a salary amendment. */
  kind: string;
  /** CONTRACT_FORMS. */
  form: string;
  /** An intern's agreement converted to full-time by this version: the type it converts to. */
  convertsTo: string | null;
  /** CONTRACT_STATUSES. */
  status: string;
  startDate: string;
  /** None when open-ended, or a specific job's end not set. */
  endDate: string | null;
  signedOn: string | null;
  probationEnd: string | null;
}

/** An employment as the report reads it: its person and place now, and every one of its versions. */
export interface ContractsReportEmployment {
  employmentId: string;
  employee: ReportPerson;
  /** Whether the person is employed now (this employment or another of theirs without an end). */
  current: boolean;
  /** Where it is now: a team (with its department as `parent`) or a department. */
  department: ReportDepartment | null;
  /** Its job title now. */
  jobTitle: string | null;
  /** EMPLOYMENT_TYPES: the employment's now. */
  employmentType: string;
  versions: readonly ReportContractVersion[];
}

// ---------- each version ----------

/** What a version is to the one before it: the first contract, a renewal, a raise's new contract, an amendment, a conversion. */
export const CONTRACT_VERSION_KINDS = ['first', 'renewal', 'new_contract', 'amendment', 'conversion'] as const;
export type ContractVersionKind = (typeof CONTRACT_VERSION_KINDS)[number];
export const CONTRACT_VERSION_KIND_LABELS: Record<ContractVersionKind, string> = {
  first: 'First contract',
  renewal: 'Renewal',
  new_contract: 'New contract',
  amendment: 'Salary amendment',
  conversion: 'Conversion to full-time',
};

/**
 * What a version is: the first (no version before it); an intern's agreement converted to full-time;
 * otherwise as the Salary History reads it (payChangeOf): a salary amendment, a new contract starting within the term
 * of the one before (a raise's), or a renewal after it.
 */
export function versionKind(v: Pick<ReportContractVersion, 'kind' | 'startDate' | 'convertsTo'>, previous: Pick<ReportContractVersion, 'endDate'> | null): ContractVersionKind {
  if (!previous) return 'first';
  if (v.convertsTo) return 'conversion';
  const change = payChangeOf(v, previous);
  return change === 'hired' ? 'first' : change;
}

/** Whole days from one day to another (YYYY-MM-DD); negative when `to` is before `from`. */
const daysFrom = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/**
 * The days from today to the end of a signed contract in force: 0 on its last day, negative once its end has passed
 * (still the contract in force: the employment went on). Null for a draft, a replaced or an ended version, and for one
 * without an end (open-ended, or a specific job's end not set).
 */
export function daysLeft(c: { status: string; endDate: string | null }, today: string): number | null {
  if (c.status !== 'active' || !c.endDate) return null;
  return daysFrom(today, c.endDate);
}

/** Whether a version's term (its start to its end; no end: running) touches the period's days. */
export function touchesPeriod(c: { startDate: string; endDate: string | null }, period: ReportPeriod): boolean {
  const { start, end } = periodDays(period);
  return c.startDate <= end && (c.endDate === null || c.endDate >= start);
}

// ---------- the rows ----------

/** Whether the person works now or has left: of the person, not of this employment (someone rehired is current). */
export type EmployeeStanding = 'current' | 'former';
export const EMPLOYEE_STANDING_LABELS: Record<EmployeeStanding, string> = { current: 'Current', former: 'Former' };

/** One contract version on the report: dates and status, no pay. */
export interface ContractsReportRow {
  contractId: string;
  number: string;
  version: number;
  kind: ContractVersionKind;
  employee: ReportPerson;
  employmentId: string;
  department: ReportDepartment | null;
  jobTitle: string | null;
  employmentType: string;
  form: string;
  startDate: string;
  endDate: string | null;
  /** daysLeft: a signed contract in force with an end only. */
  daysLeft: number | null;
  status: ContractStatus;
  signedOn: string | null;
  probationEnd: string | null;
  employeeStatus: EmployeeStanding;
  /** The version after it in its employment (a renewal, a raise, a draft), if any. */
  nextVersion: { number: string; status: ContractStatus } | null;
}

/** By employee code, then the start (a rehired person's employments in turn), then the version. */
const byCodeThenStart = (a: ContractsReportRow, b: ContractsReportRow) =>
  a.employee.employeeCode.localeCompare(b.employee.employeeCode) || a.startDate.localeCompare(b.startDate) || a.version - b.version || a.number.localeCompare(b.number);

/** Every version of the employments as a row, in the report's order. */
export function versionRows(employments: readonly ContractsReportEmployment[], today: string): ContractsReportRow[] {
  return employments
    .flatMap((e) => {
      const versions = [...e.versions].sort((a, b) => a.version - b.version);
      return versions.map((v, i): ContractsReportRow => {
        const next = versions[i + 1] ?? null;
        return {
          contractId: v.id,
          number: v.number,
          version: v.version,
          kind: versionKind(v, versions[i - 1] ?? null),
          employee: e.employee,
          employmentId: e.employmentId,
          department: e.department,
          jobTitle: e.jobTitle,
          employmentType: e.employmentType,
          form: v.form,
          startDate: v.startDate,
          endDate: v.endDate,
          daysLeft: daysLeft(v, today),
          status: v.status as ContractStatus,
          signedOn: v.signedOn,
          probationEnd: v.probationEnd,
          employeeStatus: e.current ? 'current' : 'former',
          nextVersion: next && { number: next.number, status: next.status as ContractStatus },
        };
      });
    })
    .sort(byCodeThenStart);
}

/** Whether a place is the one asked for: the team itself, or the department itself or one of its teams. */
export const inPlace = (d: ReportDepartment | null, id: string): boolean => !!d && (d.id === id || d.parent?.id === id);

/** Whether a row matches the search: the employee's English or Arabic name or code, or the contract's number; case doesn't matter. */
export function matchesSearch(row: Pick<ContractsReportRow, 'employee' | 'number'>, q: string | null): boolean {
  const text = q?.trim().toLocaleLowerCase();
  if (!text) return true;
  return [row.employee.fullNameEn, row.employee.fullNameAr, row.employee.employeeCode, row.number].some((s) => s.toLocaleLowerCase().includes(text));
}

/** Whether an active contract ends within `days` of today, one already past its end included (as the Contracts page's "Ending within"). */
const endsWithin = (r: Pick<ContractsReportRow, 'status' | 'daysLeft'>, days: number) => r.status === 'active' && r.daysLeft !== null && r.daysLeft <= days;

/** Whether a row passes every filter but the period. */
function matchesFilters(r: ContractsReportRow, f: ContractsReportFilters, statuses: readonly ContractStatus[]): boolean {
  return (
    statuses.includes(r.status) &&
    (!f.form || r.form === f.form) &&
    (!f.employmentType || r.employmentType === f.employmentType) &&
    (!f.departmentId || inPlace(r.department, f.departmentId)) &&
    (f.endingWithin === null || endsWithin(r, f.endingWithin)) &&
    matchesSearch(r, f.q)
  );
}

/** Which of an employment's versions stands for it: the active one, else the latest signed (ended or replaced), else its draft. */
const standing = (r: Pick<ContractsReportRow, 'status'>) => (r.status === 'active' ? 3 : r.status === 'draft' ? 1 : 2);

/**
 * "Latest version per employment": one row per employment, among the rows given (those the filters kept): its active
 * version, else its latest signed one, else its latest draft. In the order given.
 */
export function latestPerEmployment<T extends Pick<ContractsReportRow, 'employmentId' | 'status' | 'version'>>(rows: readonly T[]): T[] {
  const best = new Map<string, T>();
  for (const r of rows) {
    const held = best.get(r.employmentId);
    if (!held || standing(r) > standing(held) || (standing(r) === standing(held) && r.version > held.version)) best.set(r.employmentId, r);
  }
  const kept = new Set(best.values());
  return rows.filter((r) => kept.has(r));
}

/** The rows shown: one per employment (latestPerEmployment), or every version. */
export const shownRows = <T extends Pick<ContractsReportRow, 'employmentId' | 'status' | 'version'>>(rows: readonly T[], show: ContractsReportShow): T[] =>
  show === 'every' ? [...rows] : latestPerEmployment(rows);

// ---------- the totals ----------

export interface ContractsReportTotals {
  /** The rows shown, and the people in them. */
  contracts: number;
  people: number;
  byStatus: Record<ContractStatus, number>;
  /** Active contracts shown ending in the next 30, 60 and 90 days, today included (one past its end is not). */
  endingIn: { days: number; count: number }[];
  /**
   * Signed contracts whose end fell in the period and has passed, with no later signed version: not renewed (a draft
   * renewal not signed yet doesn't count as one).
   */
  notRenewed: number;
  /** Renewals signed in the period, whichever versions are shown and whenever they start. */
  renewalsSigned: number;
}

/**
 * The totals of the rows shown, on `today`. The renewals signed in the period are counted among `others` (the versions
 * every filter but the period kept, whichever are shown), so a renewal signed ahead of a start after the period, or
 * since amended, still counts; the rows themselves when not given.
 */
export function contractsReportTotals(rows: readonly ContractsReportRow[], period: ReportPeriod, today: string, others: readonly ContractsReportRow[] = rows): ContractsReportTotals {
  const byStatus = Object.fromEntries(CONTRACT_STATUSES.map((s) => [s, 0])) as Record<ContractStatus, number>;
  for (const r of rows) byStatus[r.status] += 1;
  return {
    contracts: rows.length,
    people: new Set(rows.map((r) => r.employee.id)).size,
    byStatus,
    endingIn: CONTRACTS_ENDING_DAYS.map((days) => ({ days, count: rows.filter((r) => r.status === 'active' && r.daysLeft !== null && r.daysLeft >= 0 && r.daysLeft <= days).length })),
    notRenewed: rows.filter(
      (r) =>
        (r.status === 'active' || r.status === 'ended') &&
        r.endDate !== null &&
        r.endDate < today &&
        inPeriod(r.endDate, period) &&
        (r.nextVersion === null || r.nextVersion.status === 'draft'),
    ).length,
    renewalsSigned: others.filter((r) => r.kind === 'renewal' && r.status !== 'draft' && r.signedOn !== null && inPeriod(r.signedOn, period)).length,
  };
}

// ---------- the report ----------

/** GET /reports/contracts (HR, Finance and the CEO), less the moment it was made and the C-level people left out. */
export interface ContractsReport {
  filters: ContractsReportFiltersUsed;
  rows: ContractsReportRow[];
  totals: ContractsReportTotals;
}

/**
 * The rows and totals for these filters on `today`: every version the filters keep whose term touches the period, then
 * one per employment or every one (`show`), in the report's order.
 */
export function contractsReport(employments: readonly ContractsReportEmployment[], filters: ContractsReportFilters, today: string): Pick<ContractsReport, 'rows' | 'totals'> {
  const statuses = reportStatuses(filters.status);
  const others = versionRows(employments, today).filter((r) => matchesFilters(r, filters, statuses));
  const rows = shownRows(
    others.filter((r) => touchesPeriod(r, filters.period)),
    filters.show,
  );
  return { rows, totals: contractsReportTotals(rows, filters.period, today, others) };
}
