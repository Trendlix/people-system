import {
  isReportMonth,
  RAISE_KIND_LABELS,
  RAISE_REASON_LABELS,
  RAISE_REQUEST_STATUS_LABELS,
  requestedPeriod,
  type DepartmentRaises,
  type DueForReviewRow,
  type PayStage,
  type RaiseRequestStatus,
  type RaiseTotals,
  type ReportPeriod,
  type Role,
  type SalaryRaiseRow,
  type SalaryRaisesReport,
} from '@trendlix/shared';
import { departmentName } from '../../../../lib/departments';
import { formatDate, formatDateTime } from '../../../../lib/format';
import { hasRole } from '../../../../lib/roles';
import { addMonths, monthName, monthOf } from '../../payroll/list';
import { prepareRaiseHref } from '../../raise-requests/list';
import { formatEgp } from '../[id]/contracts/salary';
import { changeText, fromToText, monthsAgoText, signedEgp, signedPercent } from '../[id]/salary-history/salary-history';
import { contractHref, employeeRaiseRequestsHref, salaryHistoryHref } from '../tab-list';

// The Salary Raises report (owner's decision, 16 October 2026: the salary raises tracked on each profile's Salary
// History and in a company-wide report), for HR, Finance and the CEO, as salaries. For a period of months (this calendar
// year unless the address asks for another): the totals, the raises by department, every raise that took effect in it,
// and who is due for a salary review after the months set in Payroll Setup → Your Rules. Plain helpers for the page (no
// server-only, so they are unit tested): who sees it, the period read from the address and the links that keep it, and
// each part in words. Relative imports: the tests run without the "@/" alias.

type WithRoles = { roles: readonly Role[] };
type Query = Record<string, string | string[] | undefined>;

/** GET /reports/salary-raises: the report, as of when it was made. */
export type SalaryRaisesView = SalaryRaisesReport & { generatedAt: string };

/** Who sees the report (the Employees page shows them the button): HR, Finance and the CEO, who see salaries. */
export const SALARY_RAISES_ROLES: readonly Role[] = ['hr', 'finance', 'ceo'];

export function canSeeSalaryRaises(user: WithRoles): boolean {
  return hasRole(user, ...SALARY_RAISES_ROLES);
}

/** HR prepares raises and asks for them; Finance and the CEO only read the report. */
export const preparesRaises = (user: WithRoles) => hasRole(user, 'hr');

export const RAISES_PATH = '/employees/raises';

// ---------- the period ----------

const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v.trim() : '');

/**
 * The period in the page's address (?from=&to=, months): this calendar year when neither is there; with one only, that
 * month's year from January or to December, as the API takes it. A month it can't read is left out, as if not chosen;
 * from and to the wrong way round are swapped.
 */
export function readPeriod(query: Query, today: string): ReportPeriod {
  const from = one(query.from);
  const to = one(query.to);
  const p = requestedPeriod({ from: isReportMonth(from) ? from : undefined, to: isReportMonth(to) ? to : undefined }, today);
  return p.from <= p.to ? p : { from: p.to, to: p.from };
}

const query = (p: ReportPeriod) => `from=${p.from}&to=${p.to}`;

/** The page's address for a period: plain for this calendar year, so it is what the Employees page links to. */
export function raisesHref(p: ReportPeriod, today: string): string {
  const year = today.slice(0, 4);
  return p.from === `${year}-01` && p.to === `${year}-12` ? RAISES_PATH : `${RAISES_PATH}?${query(p)}`;
}

/** The API's report for a period. */
export const apiReportPath = (p: ReportPeriod) => `/reports/salary-raises?${query(p)}`;

/** Where the browser downloads the period's workbook (a plain link, never prefetched): the page's period, always written out. */
export const excelHref = (p: ReportPeriod) => `${RAISES_PATH}/excel?${query(p)}`;

/** The API's workbook for the period a download asks for (excel/route.ts), read as the page reads it. */
export const apiExcelPath = (params: URLSearchParams, today: string) =>
  `/reports/salary-raises.xlsx?${query(readPeriod({ from: params.get('from') ?? undefined, to: params.get('to') ?? undefined }, today))}`;

/** The period as the page's heading names it: "2026", "October 2026", "January to June 2026", "November 2025 to October 2026". */
export function periodTitle(p: ReportPeriod): string {
  const [fromYear, toYear] = [p.from.slice(0, 4), p.to.slice(0, 4)];
  if (p.from === p.to) return monthName(p.from);
  if (fromYear === toYear) {
    if (p.from.endsWith('-01') && p.to.endsWith('-12')) return fromYear;
    return `${monthName(p.from).split(' ')[0]} to ${monthName(p.to)}`;
  }
  return `${monthName(p.from)} to ${monthName(p.to)}`;
}

/**
 * The months the period picker offers, newest first: from January five years back to December next year, with the
 * period's own months too when they are outside that.
 */
export function monthChoices(today: string, p: ReportPeriod): { value: string; label: string }[] {
  const year = Number(today.slice(0, 4));
  const months: string[] = [];
  for (let m = `${year + 1}-12`; m >= `${year - 5}-01`; m = addMonths(m, -1)) months.push(m);
  for (const m of [p.from, p.to]) if (!months.includes(m)) months.push(m);
  return months.sort((a, b) => b.localeCompare(a)).map((value) => ({ value, label: monthName(value) }));
}

/** The periods offered with one click: this year, last year, the last 12 months (to this month). */
export function quickPeriods(today: string): { key: string; label: string; period: ReportPeriod }[] {
  const year = Number(today.slice(0, 4));
  const now = monthOf(today);
  return [
    { key: 'this-year', label: 'This year', period: { from: `${year}-01`, to: `${year}-12` } },
    { key: 'last-year', label: 'Last year', period: { from: `${year - 1}-01`, to: `${year - 1}-12` } },
    { key: 'last-12', label: 'Last 12 months', period: { from: addMonths(now, -11), to: now } },
  ];
}

export const samePeriod = (a: ReportPeriod, b: ReportPeriod) => a.from === b.from && a.to === b.to;

// ---------- the totals ----------

/** An increase in money: "+EGP 4,800.00", "−EGP 500.00", or "EGP 0.00" for none. */
export const costText = (amount: number) => (Math.round(amount * 100) === 0 ? formatEgp(0) : signedEgp(amount));

/** A percent with its sign, or a dash when there is none (no raise, or from a gross of 0). */
export const percentText = (percent: number | null) => (percent === null ? '—' : signedPercent(percent));

/** "1 raise", "4 raises". */
export const raisesLabel = (n: number) => `${n} ${n === 1 ? 'raise' : 'raises'}`;

/** "1 person", "3 people". */
export const peopleLabel = (n: number) => `${n} ${n === 1 ? 'person' : 'people'}`;

export interface Tile {
  key: string;
  label: string;
  value: string;
  note: string | null;
}

/** The figures the report opens with: the raises, the people, the average raise, and the monthly and yearly cost. */
export function summaryTiles(t: RaiseTotals): Tile[] {
  return [
    { key: 'raises', label: 'Raises', value: String(t.count), note: null },
    { key: 'people', label: 'People', value: String(t.people), note: 'Someone with two raises counts once' },
    { key: 'average', label: 'Average raise', value: percentText(t.averagePercent), note: t.medianPercent === null ? null : `Median ${signedPercent(t.medianPercent)}` },
    { key: 'monthly', label: 'Monthly cost increase', value: costText(t.monthlyCostIncrease), note: 'Gross and allowances' },
    { key: 'yearly', label: 'Yearly cost increase', value: costText(t.yearlyCostIncrease), note: 'The monthly increase × 12' },
  ];
}

/** A department's name on the report; people not placed are under "No department". */
export const departmentLabel = (d: DepartmentRaises['department']) => d?.nameEn ?? 'No department';

// ---------- the raises ----------

/** Where a person's Salary History is: their Employment tab's Salary sub-tab (#salary-history). */
export { salaryHistoryHref };

export interface RaiseView {
  key: string;
  effective: string;
  /** Signed, to take effect after today. */
  upcoming: boolean;
  kind: string;
  reason: string | null;
  place: string | null;
  jobTitle: string | null;
  /** "Promoted to Senior Accountant, grade G5". */
  promotion: string | null;
  gross: string;
  allowances: string;
  /** The gross's change: "+EGP 2,500.00 (+25%)". */
  change: string;
  /** What it costs a month more, gross and allowances. */
  cost: string;
  /** "Chief Officer, 10/10/2026, 9:00 AM". */
  approved: string | null;
}

export function raiseView(r: SalaryRaiseRow): RaiseView {
  const promotion = r.promotion && [r.promotion.jobTitle, r.promotion.grade && `grade ${r.promotion.grade}`].filter(Boolean).join(', ');
  return {
    key: r.contractId,
    effective: formatDate(r.effectiveDate),
    upcoming: r.upcoming,
    kind: RAISE_KIND_LABELS[r.kind] ?? r.kind,
    reason: r.reason ? (RAISE_REASON_LABELS[r.reason] ?? r.reason) : null,
    place: r.department && departmentName(r.department),
    jobTitle: r.jobTitle,
    promotion: promotion ? `Promoted to ${promotion}` : null,
    gross: fromToText(r.gross.from, r.gross.to),
    allowances: fromToText(r.allowances.from, r.allowances.to),
    change: changeText(r.change) ?? 'No change',
    cost: costText(r.monthlyCost),
    approved: r.approvedAt ? `${r.approvedBy ? `${r.approvedBy}, ` : ''}${formatDateTime(r.approvedAt)}` : r.approvedBy,
  };
}

// ---------- due for review ----------

const OPEN_RAISE_TEXT: Partial<Record<PayStage, string>> = {
  draft: 'A raise HR is preparing',
  returned: 'A raise returned to HR',
  pending_ceo: 'A raise with the CEO',
  approved: 'A raise approved, to be signed',
};

const OPEN_REQUEST_TEXT: Partial<Record<RaiseRequestStatus, string>> = {
  with_hr: 'A raise request with HR',
  with_ceo: 'A raise request with the CEO',
  approved: 'A raise request approved by the CEO',
};

/** What is open for someone now: their raise not signed yet, with its date, else their raise request; null for nothing. */
export function openText(r: Pick<DueForReviewRow, 'openRaise' | 'openRequest'>): string | null {
  if (r.openRaise) return `${OPEN_RAISE_TEXT[r.openRaise.stage] ?? 'A raise'}, from ${formatDate(r.openRaise.effectiveDate)}`;
  if (r.openRequest) return OPEN_REQUEST_TEXT[r.openRequest.status] ?? `A raise request: ${RAISE_REQUEST_STATUS_LABELS[r.openRequest.status] ?? r.openRequest.status}`;
  return null;
}

/** Since when: "Last raise 01/11/2025, 11 months ago", or "No raise since joining on 01/09/2024, 2 years and 1 month ago". */
export function sinceText(r: Pick<DueForReviewRow, 'lastRaise' | 'joinDate' | 'monthsSince'>): string {
  const ago = monthsAgoText(r.monthsSince);
  return r.lastRaise ? `Last raise ${formatDate(r.lastRaise)}, ${ago}` : `No raise since joining on ${formatDate(r.joinDate)}, ${ago}`;
}

export interface ReviewAction {
  key: string;
  label: string;
  href: string;
}

/**
 * What HR may do for someone due for review: carry on with their open raise (the contract on the Employment tab's
 * Details), prepare the raise from their request with HR, see a request further along; with nothing open, prepare a
 * raise (the raise form) or ask for one (their Raise Requests, on the Salary sub-tab). Nothing for Finance and the CEO,
 * who read the report. The API checks it all again.
 */
export function reviewActions(user: WithRoles, r: Pick<DueForReviewRow, 'employee' | 'openRaise' | 'openRequest'>): ReviewAction[] {
  if (!preparesRaises(user)) return [];
  const id = r.employee.id;
  const requests = employeeRaiseRequestsHref(id);
  if (r.openRaise) return [{ key: 'open', label: 'Open the raise', href: contractHref(id) }];
  if (r.openRequest?.status === 'with_hr') return [{ key: 'prepare', label: 'Prepare the raise', href: prepareRaiseHref(id, r.openRequest.id) }];
  if (r.openRequest) return [{ key: 'request', label: 'See the request', href: requests }];
  return [
    { key: 'prepare', label: 'Prepare a raise', href: `/employees/${encodeURIComponent(id)}/contracts/raise` },
    { key: 'request', label: 'Request a raise', href: requests },
  ];
}

/** "Due after 12 months without a raise", "Due after 1 month without a raise". */
export const reviewRuleText = (months: number) => `Due after ${months} ${months === 1 ? 'month' : 'months'} without a raise`;
