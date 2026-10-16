import { monthRange, PAYROLL_FIGURE_KEYS, PAYROLL_FIGURE_LABELS, type MonthStatistics, type PayrollStatistics, type ReportPeriod, type Role } from '@trendlix/shared';
import { hasRole } from '../../../../lib/roles';
import { formatEgp } from '../../employees/[id]/contracts/salary';
import { compactAmount, niceTicks } from '../../employees/[id]/salary-history/salary-history';
import { RAISES_PATH } from './salary-raises/salary-raises';
import { monthName } from '../list';
import { REPORTS_PATH } from '../sections';

// Reports (Statistics) under Payroll (owner, 17 October 2026: "make the Payroll in the side tab a main title below it -
// Overview - Unsettled - Additions / Deductions - Reports (Statistics)"): what the runs the CEO approved paid and cost
// for a period of months (this calendar year unless the address asks for another), month by month with a trend of the
// company cost, by department and team, the average and median gross, and this year to date; and the Salary Raises
// report, linked from here. Plain helpers for the page (no server-only, so they are unit tested): who sees it, the
// addresses that keep the period, the tiles and the chart drawn to scale. Relative imports: the tests run without the
// "@/" alias. Salary data: HR, Finance and the CEO; the API checks it again.

type WithRoles = { roles: readonly Role[] };

/** GET /payroll/statistics: the statistics, as of when they were worked out. */
export type StatisticsView = PayrollStatistics & { generatedAt: string };

export const canSeeReports = (user: WithRoles) => hasRole(user, 'hr', 'finance', 'ceo');

/** The Salary Raises report, a report of its own (it moves under Reports in the sidebar later). */
export const SALARY_RAISES_HREF = RAISES_PATH;

const query = (p: ReportPeriod) => `from=${p.from}&to=${p.to}`;

/** The page's address for a period: plain for this calendar year. */
export function reportsHref(p: ReportPeriod, today: string): string {
  const year = today.slice(0, 4);
  return p.from === `${year}-01` && p.to === `${year}-12` ? REPORTS_PATH : `${REPORTS_PATH}?${query(p)}`;
}

export const apiStatisticsPath = (p: ReportPeriod) => `/payroll/statistics?${query(p)}`;

/** Where the browser downloads the period's workbook (a plain link, never prefetched). */
export const excelHref = (p: ReportPeriod) => `${REPORTS_PATH}/excel?${query(p)}`;

export const apiWorkbookPath = (p: ReportPeriod) => `/payroll/statistics/workbook?${query(p)}`;

// ---------- the tiles ----------

export interface Tile {
  key: string;
  label: string;
  value: string;
  note: string | null;
}

/** The period's figures at the top: the cost, what was paid, the people, the average and median gross. */
export function summaryTiles(s: StatisticsView): Tile[] {
  const t = s.totals;
  const months = `${t.months} ${t.months === 1 ? 'month' : 'months'} approved`;
  return [
    { key: 'companyCost', label: 'Company cost', value: formatEgp(t.companyCost), note: months },
    { key: 'gross', label: 'Gross', value: formatEgp(t.gross), note: 'Earned and allowances' },
    { key: 'net', label: 'Net', value: formatEgp(t.net), note: `${formatEgp(t.transfer)} transferred` },
    { key: 'employees', label: 'Employees paid', value: String(t.employees), note: `${t.personMonths} person-months` },
    { key: 'average', label: 'Average gross', value: t.averageGross === null ? '—' : formatEgp(t.averageGross), note: t.medianGross === null ? null : `Median ${formatEgp(t.medianGross)}` },
  ];
}

/** The figures' columns, in the order the tables show them. */
export const FIGURE_COLUMNS = PAYROLL_FIGURE_KEYS.map((key) => ({ key, label: PAYROLL_FIGURE_LABELS[key] }));

/** "Draft", "With the CEO" or "No run yet": why a month has no figures. */
export const withoutText = (status: string | null) =>
  status === null ? 'No run yet' : status === 'draft' ? 'A draft' : status === 'pending_ceo' ? 'With the CEO' : status;

/** The year to date's span: "January to October 2026". */
export function yearToDateTitle(s: Pick<StatisticsView, 'yearToDate'>): string {
  const y = s.yearToDate;
  return y.from === y.to ? `${monthName(y.from)}` : `${monthName(y.from).split(' ')[0]} to ${monthName(y.to)}`;
}

// ---------- the trend chart ----------

export interface CostBar {
  month: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** "September 2026: EGP 512,300.00", on hover. */
  title: string;
}

export interface CostChart {
  width: number;
  height: number;
  plot: { left: number; right: number; top: number; bottom: number };
  bars: CostBar[];
  yTicks: { y: number; label: string }[];
  xTicks: { x: number; label: string }[];
  /** The chart in words, for screen readers. */
  description: string;
}

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Sep" (and "Jan 27" for January, so the years show). */
function monthTick(month: string): string {
  const m = Number(month.slice(5, 7));
  return m === 1 ? `Jan ${month.slice(2, 4)}` : MONTH_SHORT[m - 1];
}

/**
 * The company cost of each month of the period as bars, drawn to scale from 0 (round ticks), a slot for every month,
 * so a month without an approved run is a gap; a label under every month, or every few when there are many. Null with
 * no month counted.
 */
export function costChart(months: readonly Pick<MonthStatistics, 'month' | 'companyCost'>[], period: ReportPeriod): CostChart | null {
  if (!months.length) return null;
  const all = monthRange(period.from, period.to);
  const width = 720;
  const height = 240;
  const plot = { left: 56, right: width - 12, top: 16, bottom: height - 28 };
  const ticks = niceTicks(Math.max(...months.map((m) => m.companyCost)));
  const top = ticks.at(-1)!;
  const y = (v: number) => plot.bottom - ((plot.bottom - plot.top) * v) / top;
  const slot = (plot.right - plot.left) / all.length;
  const barWidth = Math.max(2, Math.min(40, slot * 0.6));
  const every = Math.ceil(all.length / 12);
  const at = (i: number) => plot.left + slot * i + slot / 2;
  const byMonth = new Map(months.map((m) => [m.month, m]));
  const bars = all.flatMap((month, i) => {
    const m = byMonth.get(month);
    if (!m) return [];
    const barTop = y(m.companyCost);
    return [{ month, x: at(i) - barWidth / 2, y: barTop, width: barWidth, height: plot.bottom - barTop, title: `${monthName(month)}: ${formatEgp(m.companyCost)}` }];
  });
  const counted = months.length;
  const highest = months.reduce((a, b) => (b.companyCost > a.companyCost ? b : a));
  return {
    width,
    height,
    plot,
    bars,
    yTicks: ticks.map((v) => ({ y: y(v), label: compactAmount(v) })),
    xTicks: all.map((month, i) => ({ month, i })).filter(({ i }) => i % every === 0).map(({ month, i }) => ({ x: at(i), label: monthTick(month) })),
    description: `The company cost of ${counted} ${counted === 1 ? 'month' : 'months'} from ${monthName(period.from)} to ${monthName(period.to)}, the highest ${formatEgp(highest.companyCost)} in ${monthName(highest.month)}.`,
  };
}
