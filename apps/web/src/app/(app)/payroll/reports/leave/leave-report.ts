import { isReportMonth, LEAVE_REPORT_SOURCE_LABELS, requestedLeavePeriod, type LeaveReport, type LeaveReportLeave, type LeaveReportTotals, type ReportPeriod, type Role } from '@trendlix/shared';
import { hasRole } from '../../../../../lib/roles';
import { addMonths, monthOf } from '../../list';

// The Leave report (owner, 26 October 2026: "can i get a report for the monthly leaves with all types?"; asked, "Both" (a
// summary and a list), to count the permission hours, the work from home days and the annual balance left, and "A month,
// or a range"), under Payroll → Reports beside Salary Raises and Contracts, and linked from Leave Requests. For a month or
// From and To months (this month unless the address asks for another): the approved leave only. Plain helpers for the
// page (no server-only, so they are unit tested): who sees it, the filters read from the address and the addresses that
// keep them, and the figures in words. Relative imports: the tests run without the "@/" alias.

type WithRoles = { roles: readonly Role[] };
type Query = Record<string, string | string[] | undefined>;

/**
 * GET /reports/leave: the report, as of when it was made. `balanceAsOf`: the day the annual balance is of (the period's
 * end, or today when it ends later). `confidentialExcluded`: how many C-level people it leaves out for the caller (owner,
 * 19 October 2026: "make C level Employees details not visible to HR"); 0 for the CEO and the Super Admin.
 */
export type LeaveReportView = LeaveReport & { generatedAt: string; balanceAsOf: string; confidentialExcluded?: number };

/** Under Payroll → Reports, beside Salary Raises and Contracts. */
export const LEAVE_REPORT_PATH = '/payroll/reports/leave';

/** HR and the CEO, who see everyone's leave on Leave Requests; the API checks it again. */
export const LEAVE_REPORT_ROLES: readonly Role[] = ['hr', 'ceo'];
export const canSeeLeaveReport = (user: WithRoles) => hasRole(user, ...LEAVE_REPORT_ROLES);

// ---------- the filters ----------

/** The report's filters as the page's address has them. */
export interface LeaveReportFilters {
  period: ReportPeriod;
  /** A department (with its teams) or a team. */
  department: string | null;
  employee: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v.trim() : '');

/**
 * The period in the page's address: this month when neither month is sent, one month alone when only one is; a month it
 * can't read is left out, as if not chosen; From and To the wrong way round are swapped.
 */
export function readPeriod(query: Query, today: string): ReportPeriod {
  const from = one(query.from);
  const to = one(query.to);
  const p = requestedLeavePeriod({ from: isReportMonth(from) ? from : undefined, to: isReportMonth(to) ? to : undefined }, today);
  return p.from <= p.to ? p : { from: p.to, to: p.from };
}

/** The filters in the page's address; anything it can't read is left out, as if not chosen. */
export function readFilters(query: Query, today: string): LeaveReportFilters {
  const department = one(query.department);
  const employee = one(query.employee);
  return { period: readPeriod(query, today), department: UUID.test(department) ? department : null, employee: UUID.test(employee) ? employee : null };
}

/** The filters with nothing chosen, for a period. */
export const noFilters = (period: ReportPeriod): LeaveReportFilters => ({ period, department: null, employee: null });

/** Whether a filter other than the period is chosen. */
export const isFiltered = (f: LeaveReportFilters) => Boolean(f.department || f.employee);

export const samePeriod = (a: ReportPeriod, b: ReportPeriod) => a.from === b.from && a.to === b.to;

/** The filters as a query, in a fixed order; the period too unless `period` is false; the names the API takes when `api`. */
function queryOf(f: LeaveReportFilters, api: boolean, period: boolean): string {
  const params = new URLSearchParams();
  if (period) {
    params.set('from', f.period.from);
    params.set('to', f.period.to);
  }
  if (f.department) params.set(api ? 'departmentId' : 'department', f.department);
  if (f.employee) params.set(api ? 'employeeId' : 'employee', f.employee);
  return params.toString();
}

const withQuery = (path: string, qs: string) => (qs ? `${path}?${qs}` : path);

/** The page's address for these filters: plain for this month with nothing chosen, as Reports links to it. */
export const reportHref = (f: LeaveReportFilters, today: string) => withQuery(LEAVE_REPORT_PATH, queryOf(f, false, !samePeriod(f.period, thisMonth(today))));

/** The API's report for these filters. */
export const apiReportPath = (f: LeaveReportFilters) => `/reports/leave?${queryOf(f, true, true)}`;

/** Where the browser downloads the workbook (a plain link, never prefetched): the filters, the period always written out. */
export const excelHref = (f: LeaveReportFilters) => `${LEAVE_REPORT_PATH}/excel?${queryOf(f, false, true)}`;

/** The API's workbook for the filters a download asks for (excel/route.ts), read as the page reads them. */
export const apiExcelPath = (params: URLSearchParams, today: string) => `/reports/leave.xlsx?${queryOf(readFilters(Object.fromEntries(params), today), true, true)}`;

/** Where the Leave Requests page links to it: this month. */
export const LEAVE_REPORT_HREF = LEAVE_REPORT_PATH;

// ---------- the period ----------

const thisMonth = (today: string): ReportPeriod => ({ from: monthOf(today), to: monthOf(today) });

/** The periods offered with one click: this month, last month, this year so far, last year. */
export function quickPeriods(today: string): { key: string; label: string; period: ReportPeriod }[] {
  const year = Number(today.slice(0, 4));
  const now = monthOf(today);
  return [
    { key: 'this-month', label: 'This month', period: thisMonth(today) },
    { key: 'last-month', label: 'Last month', period: { from: addMonths(now, -1), to: addMonths(now, -1) } },
    { key: 'this-year', label: 'This year', period: { from: `${year}-01`, to: `${year}-12` } },
    { key: 'last-year', label: 'Last year', period: { from: `${year - 1}-01`, to: `${year - 1}-12` } },
  ];
}

// ---------- the figures in words ----------

/** A count of days or hours: "5", "0.5"; a dash for none. */
export function figureText(n: number): string {
  return n === 0 ? '—' : String(n);
}

/** The annual balance left: "12.5", "-1" (a Super Admin may take it below 0); a dash for someone with none. */
export const balanceText = (n: number | null): string => (n === null ? '—' : String(n));

/** "1 leave", "3 leaves". */
export const leavesLabel = (n: number) => `${n} ${n === 1 ? 'leave' : 'leaves'}`;

/** A group's or the grand total's figure for a leave type column. */
export const typeTotal = (t: Pick<LeaveReportTotals, 'byType'>, typeId: string) => t.byType[typeId] ?? 0;

/** Where a listed leave came from, in words. */
export const sourceText = (l: Pick<LeaveReportLeave, 'source'>) => LEAVE_REPORT_SOURCE_LABELS[l.source] ?? l.source;


/** Whether a listed leave goes beyond the period (some of its days are outside). */
export const crossesPeriod = (l: Pick<LeaveReportLeave, 'daysInPeriod' | 'days'>) => l.daysInPeriod !== l.days;

/** Where the leave is: its own page. */
export const leaveHref = (l: Pick<LeaveReportLeave, 'id'>) => `/leave/${l.id}`;

/** Where the employee is: their profile. */
export const profileHref = (l: { employee: { id: string } }) => `/employees/${l.employee.id}`;
