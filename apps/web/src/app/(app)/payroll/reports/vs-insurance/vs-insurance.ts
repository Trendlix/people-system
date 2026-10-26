import {
  isReportMonth,
  VS_INSURANCE_DIFFERENCE_KEYS,
  VS_INSURANCE_FIGURE_KEYS,
  VS_INSURANCE_FIGURE_LABELS,
  VS_INSURANCE_STANDING_LABELS,
  VS_INSURANCE_STANDING_NOTES,
  vsInsuranceStatusText,
  type PayrollVsInsurance,
  type ReportPeriod,
  type Role,
  type VsInsuranceRow,
} from '@trendlix/shared';
import { hasRole } from '../../../../../lib/roles';
import { formatEgp } from '../../../employees/[id]/contracts/salary';
import { signedEgp } from '../../../employees/[id]/salary-history/salary-history';
import { addMonths, monthName, monthOf } from '../../list';

// The Payroll vs Social Insurance report (owner, 26 October 2026: "i want a comparison report between the actual payroll
// run and the social insurance data, and the differences in the social insurance and taxes between the 2 runs"; asked which
// two figures: "actual gross and the whole cycle vs the social insurance gross with the whole cycle"), under Payroll →
// Reports beside Salary Raises, Contracts and Leave. For a month or From and To months (the latest run's month unless the
// address asks for another): per employee and month the actual run's whole cycle beside the same month on the registered
// insured wage, and the differences. Plain helpers for the page (no server-only, so they are unit tested): who sees it, the
// period read from the address and the addresses that keep it, and the figures in words. Relative imports: the tests run
// without the "@/" alias. Salary data: HR, Finance and the CEO; the API checks it again.

type WithRoles = { roles: readonly Role[] };
type Query = Record<string, string | string[] | undefined>;

/**
 * GET /payroll/vs-insurance: the report, as of when it was made. `confidentialExcluded`: how many C-level people it
 * leaves out for the caller (owner, 19 October 2026: "make C level Employees details not visible to HR"); 0 for the CEO
 * and the Super Admin.
 */
export type VsInsuranceView = PayrollVsInsurance & { generatedAt: string; confidentialExcluded?: number };

/** Under Payroll → Reports, beside Salary Raises, Contracts and Leave. */
export const VS_INSURANCE_PATH = '/payroll/reports/vs-insurance';

/** HR, Finance and the CEO, who see payroll figures; the API checks it again. */
export const VS_INSURANCE_ROLES: readonly Role[] = ['hr', 'finance', 'ceo'];
export const canSeeVsInsurance = (user: WithRoles) => hasRole(user, ...VS_INSURANCE_ROLES);

// ---------- the period ----------

const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v.trim() : '');

/**
 * The period in the page's address: null when no month is there (the API then answers with the latest run's month); one
 * month alone when only one is; a month it can't read is left out, as if not chosen; From and To the wrong way round are
 * swapped.
 */
export function readPeriod(query: Query): ReportPeriod | null {
  const from = one(query.from);
  const to = one(query.to);
  const f = isReportMonth(from) ? from : null;
  const t = isReportMonth(to) ? to : null;
  if (f === null && t === null) return null;
  const p = { from: f ?? t!, to: t ?? f! };
  return p.from <= p.to ? p : { from: p.to, to: p.from };
}

const query = (p: ReportPeriod) => `from=${p.from}&to=${p.to}`;
const withQuery = (path: string, p: ReportPeriod | null) => (p ? `${path}?${query(p)}` : path);

/** The page's address for a period: plain for the latest run, as Reports links to it. */
export const reportHref = (p: ReportPeriod | null) => withQuery(VS_INSURANCE_PATH, p);

/** The API's report for a period (the latest run's month without one). */
export const apiReportPath = (p: ReportPeriod | null) => withQuery('/payroll/vs-insurance', p);

/** Where the browser downloads the workbook (a plain link, never prefetched). */
export const excelHref = (p: ReportPeriod | null) => withQuery(`${VS_INSURANCE_PATH}/excel`, p);

/** The API's workbook for the period a download asks for (excel/route.ts), read as the page reads it. */
export const apiExcelPath = (params: URLSearchParams) => withQuery('/payroll/vs-insurance/workbook', readPeriod(Object.fromEntries(params)));

export const samePeriod = (a: ReportPeriod | null, b: ReportPeriod | null) => (a === null || b === null ? a === b : a.from === b.from && a.to === b.to);

/** The periods offered with one click: the latest run, last month, this month, this year. */
export function quickPeriods(today: string): { key: string; label: string; period: ReportPeriod | null }[] {
  const year = Number(today.slice(0, 4));
  const now = monthOf(today);
  const last = addMonths(now, -1);
  return [
    { key: 'latest', label: 'Latest run', period: null },
    { key: 'last-month', label: 'Last month', period: { from: last, to: last } },
    { key: 'this-month', label: 'This month', period: { from: now, to: now } },
    { key: 'this-year', label: 'This year', period: { from: `${year}-01`, to: `${year}-12` } },
  ];
}

/** How the period was chosen when the address asked for none, in words; null when it was asked for. */
export function defaultedText(view: Pick<VsInsuranceView, 'period' | 'defaulted'>): string | null {
  if (view.defaulted === 'latest_run') return `The latest run, ${monthName(view.period.from)}`;
  if (view.defaulted === 'this_month') return `No payroll run yet: ${monthName(view.period.from)}`;
  return null;
}

// ---------- the columns ----------

/** The whole cycle's columns, in the order the blocks show them. */
export const FIGURE_COLUMNS = VS_INSURANCE_FIGURE_KEYS.map((key) => ({ key, label: VS_INSURANCE_FIGURE_LABELS[key] }));

/** The differences' columns (B − A). */
export const DIFFERENCE_COLUMNS = VS_INSURANCE_DIFFERENCE_KEYS.map((key) => ({ key, label: VS_INSURANCE_FIGURE_LABELS[key] }));

/** The columns of the comparison table: the employee and the month, then the three blocks. */
export const COLUMN_COUNT = 2 + FIGURE_COLUMNS.length * 2 + DIFFERENCE_COLUMNS.length;

// ---------- the figures in words ----------

/** An amount of a cycle: "EGP 12,000.00". */
export const moneyText = (n: number) => formatEgp(n);

/** A difference, signed: "−EGP 1,234.00", "+EGP 50.00"; "EGP 0.00" for none. */
export const differenceText = (n: number) => (n === 0 ? formatEgp(0) : signedEgp(n));

/** Where someone stands with social insurance: "Registered", "Counted as insured (not registered)" … */
export const standingText = (r: Pick<VsInsuranceRow, 'standing'>) => VS_INSURANCE_STANDING_LABELS[r.standing] ?? r.standing;

/** Why someone has no SI cycle; null for someone registered. */
export const standingNote = (r: Pick<VsInsuranceRow, 'standing'>): string | null => VS_INSURANCE_STANDING_NOTES[r.standing] ?? null;

/** A run's status as the report marks it ("Draft: may change"). */
export const statusText = (r: { status: VsInsuranceRow['status'] }) => vsInsuranceStatusText(r.status);

/** Beside a run's status badge: a draft may change, a run with the CEO may still; null once approved or paid. */
export const mayChangeNote = (r: { status: VsInsuranceRow['status'] }): string | null => (r.status === 'draft' ? 'May change' : r.status === 'pending_ceo' ? 'May still change' : null);

/** "1 row", "12 rows": the lines on the report. */
export const rowsLabel = (n: number) => `${n} ${n === 1 ? 'row' : 'rows'}`;

/** Where the employee is: their profile. */
export const profileHref = (r: { employee: { id: string } }) => `/employees/${r.employee.id}`;
