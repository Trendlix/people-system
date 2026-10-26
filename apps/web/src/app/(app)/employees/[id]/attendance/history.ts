import {
  clockText,
  HISTORY_FILTER_LABELS,
  HISTORY_FILTERS,
  HISTORY_PERIOD_LABELS,
  HISTORY_PERIODS,
  isHistoryFilter,
  isHistoryPeriod,
  percentText,
  type HistoryBin,
  type HistoryFigures,
  type HistoryFilter,
  type HistoryPeriod,
  type HistoryTrendPoint,
  type HistoryWeekday,
  type Role,
} from '@trendlix/shared';
import type { AttendanceHistoryView } from '../../../../../lib/attendance-history-types';
import { formatDate, parseDate } from '../../../../../lib/format';
import { hasRole } from '../../../../../lib/roles';
import { hoursText, personHref } from '../../../attendance/attendance';
import { profileHref } from '../../tab-list';

// A person's attendance history on their profile's Attendance tab (owner, 23 October 2026: "Attendance history on the
// profile. Since joining: on-time %, average check-in time, late days by weekday and trends; an Excel export"; asked who
// sees it, "HR, CEO and Finance only", the Super Admin too; packages/shared attendance-history.ts): the tab's address
// with its period, the log's filter and page; the API's and the Excel's addresses; the figures as tiles with their
// definitions; and the three charts drawn to scale (the on-time trend, the check-in times by 15 minutes, the late days
// by weekday), as the salary history's chart is drawn (salary-history.ts stepChart): inline SVG, the theme's colours.
// Pure code, tested; relative imports, as vitest doesn't know the @/ paths.

type WithRoles = { roles: readonly Role[] };
type Query = Record<string, string | string[] | undefined>;

const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v : '');
const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Who sees the tab (owner, 23 October 2026: "HR, CEO and Finance only"; the Super Admin too): the API decides C-level. */
export const seesAttendanceHistory = (user: WithRoles) => hasRole(user, 'hr', 'ceo', 'finance', 'super_admin');

// ---------- the addresses ----------

/** The tab's period, the log's filter and page, as the address has them. */
export interface HistoryQuery {
  period: HistoryPeriod;
  /** A custom range's days (YYYY-MM-DD); null for the other periods. */
  from: string | null;
  to: string | null;
  only: HistoryFilter | null;
  page: number;
}

/** A date from the address or the custom range's fields: YYYY-MM-DD, or DD/MM/YYYY as typed; null for anything else. */
function dateOf(raw: string): string | null {
  const s = raw.trim();
  if (ISO.test(s)) return parseDate(`${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`) || null;
  return parseDate(s) || null;
}

/**
 * The tab's query (?period=&from=&to=&only=&page=): this month without a period; a custom range needs both its days (as
 * typed, DD/MM/YYYY, or YYYY-MM-DD), in either order, else it is this month; the first page without one.
 */
export function readHistoryQuery(query: Query): HistoryQuery {
  const asked = one(query.period);
  let period: HistoryPeriod = isHistoryPeriod(asked) ? asked : 'this_month';
  let from: string | null = null;
  let to: string | null = null;
  if (period === 'custom') {
    from = dateOf(one(query.from));
    to = dateOf(one(query.to));
    if (!from || !to) [period, from, to] = ['this_month', null, null];
    else if (to < from) [from, to] = [to, from];
  }
  const only = one(query.only);
  const page = Number(one(query.page));
  return { period, from, to, only: isHistoryFilter(only) ? only : null, page: Number.isInteger(page) && page > 1 ? page : 1 };
}

/** The query's parameters, as each address takes them (this month, no filter and the first page left out). */
function params(q: Partial<HistoryQuery>, keep: { only?: boolean; page?: boolean } = { only: true, page: true }): URLSearchParams {
  const p = new URLSearchParams();
  const period = q.period ?? 'this_month';
  if (period !== 'this_month') p.set('period', period);
  if (period === 'custom' && q.from && q.to) {
    p.set('from', q.from);
    p.set('to', q.to);
  }
  if (keep.only && q.only) p.set('only', q.only);
  if (keep.page && q.page && q.page > 1) p.set('page', String(q.page));
  return p;
}

/** The tab with its period, filter and page: /employees/<id>?tab=attendance&period=last_3_months&only=late. */
export function historyHref(employeeId: string, q: Partial<HistoryQuery> = {}): string {
  const qs = params(q).toString();
  const tab = profileHref(employeeId, 'attendance');
  return qs ? `${tab}&${qs}` : tab;
}

/** The API's: GET /attendance/employees/<id>/history?period=&from=&to=&only=&page=. */
export function historyApiPath(employeeId: string, q: Partial<HistoryQuery> = {}): string {
  const qs = params(q).toString();
  const path = `/attendance/employees/${encodeURIComponent(employeeId)}/history`;
  return qs ? `${path}?${qs}` : path;
}

/** The Excel through the website (the whole period, every day): /attendance/<id>/history/excel?period=. */
export function historyExcelHref(employeeId: string, q: Partial<HistoryQuery> = {}): string {
  const qs = params(q, {}).toString();
  const path = `/attendance/${encodeURIComponent(employeeId)}/history/excel`;
  return qs ? `${path}?${qs}` : path;
}

/** The API's Excel: GET /attendance/employees/<id>/history.xlsx?period=&from=&to=. */
export function historyApiExcelPath(employeeId: string, q: Partial<HistoryQuery> = {}): string {
  const qs = params(q, {}).toString();
  const path = `/attendance/employees/${encodeURIComponent(employeeId)}/history.xlsx`;
  return qs ? `${path}?${qs}` : path;
}

/** The month page of a period's last month, the day by day view with corrections (attendance/[employeeId]). */
export const historyMonthHref = (employeeId: string, range: { to: string }) => personHref(employeeId, range.to.slice(0, 7));

/** The period chips: each preset, then the custom range. */
export const HISTORY_PERIOD_CHOICES = HISTORY_PERIODS.map((p) => ({ value: p, label: HISTORY_PERIOD_LABELS[p] }));

/** The log's filter chips, each with how many days the period has of it (the figures'). */
export function historyFilterChoices(f: HistoryFigures): { value: HistoryFilter | null; label: string; count: number | null }[] {
  const counts: Record<HistoryFilter, number> = { late: f.lateDays, wfh: f.wfhDays, od: f.odDays, leave: f.leaveDays + f.zohoLeaveDays, absent: f.absences };
  return [{ value: null, label: 'Every day', count: f.daysOnRecord }, ...HISTORY_FILTERS.map((v) => ({ value: v, label: HISTORY_FILTER_LABELS[v], count: counts[v] }))];
}

// ---------- in words ----------

/** The period's days: "01/08/2026 to 23/10/2026". */
export const rangeText = (r: { from: string; to: string }) => (r.from === r.to ? formatDate(r.from) : `${formatDate(r.from)} to ${formatDate(r.to)}`);

/** Late minutes: 25 → "25 min", 65 → "1 h 05 min"; 0 → "" (on time, or not measured). */
export function lateText(minutes: number): string {
  if (!(minutes > 0)) return '';
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} min`;
}

/** "1 day", "3 days". */
const days = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`;

/**
 * Whether the period has employments with a gap between them (a rehire): since joining is from the first join date,
 * the days between two employments left out.
 */
export const hasRehireGap = (v: Pick<AttendanceHistoryView, 'employments'>): boolean => v.employments.length > 1;

/** A figure as its tile shows it: its value, a note under it, its one-line definition (on hover and below), its tone. */
export interface HistoryTile {
  key: string;
  label: string;
  value: string;
  note: string | null;
  definition: string;
  tone: 'danger' | 'warn' | null;
}

/**
 * What the Exempt days tile means (owner, 25 October 2026: "trat them as if they achived their full working hours"), when
 * the API sends no definition of it.
 */
export const COMPENSATORY_DAYS_DEFINITION = 'Working days off in exchange for a rest day or an official holiday worked: full paid days, never late, short or absent.';

export const EXEMPT_DAYS_DEFINITION = 'Working days exempt from check-in: counted as full hours, never late or absent; any presses are kept for reference.';

/** The period's figures as tiles (the brief's list), in order, each with the API's definition of it. */
export function historyTiles(v: Pick<AttendanceHistoryView, 'figures' | 'definitions'>): HistoryTile[] {
  const f = v.figures;
  const d = v.definitions;
  return [
    { key: 'rate', label: 'Attendance rate', value: percentText(f.attendanceRate), note: `${f.attendedDays} of ${days(f.expectedDays)} expected`, definition: d.attendanceRate, tone: null },
    { key: 'ontime', label: 'On time', value: percentText(f.onTimeRate), note: `${f.onTimeDays} of ${days(f.measuredDays)}`, definition: d.onTimeRate, tone: null },
    { key: 'checkin', label: 'Average check-in', value: f.averageCheckIn === null ? '—' : clockText(f.averageCheckIn), note: null, definition: d.averageCheckIn, tone: null },
    { key: 'hours', label: 'Average hours a day', value: hoursText(f.averageHours), note: f.daysCounted ? `Over ${days(f.daysCounted)} counted` : null, definition: d.averageHours, tone: null },
    { key: 'late', label: 'Late days', value: String(f.lateDays), note: f.lateMinutes > 0 ? `${lateText(f.lateMinutes)} late in all` : null, definition: d.lateDays, tone: f.lateDays > 0 ? 'warn' : null },
    { key: 'absent', label: 'Absences', value: String(f.absences), note: null, definition: d.absences, tone: f.absences > 0 ? 'danger' : null },
    { key: 'leave', label: 'Leave days', value: String(f.leaveDays), note: f.zohoLeaveDays > 0 ? `And ${days(f.zohoLeaveDays)} of leave in Zoho only` : null, definition: d.leaveDays, tone: null },
    { key: 'wfh', label: 'Work from home days', value: String(f.wfhDays), note: null, definition: d.wfhDays, tone: null },
    { key: 'od', label: 'Official duty days', value: String(f.odDays), note: null, definition: d.odDays, tone: null },
    // exempt from check-in (owner, 25 October 2026): only with exempt days; an API from before them has none
    ...((f.exemptDays ?? 0) > 0
      ? [{ key: 'exempt', label: 'Exempt days', value: String(f.exemptDays), note: null, definition: (d as Partial<Record<string, string>>).exemptDays ?? EXEMPT_DAYS_DEFINITION, tone: null }]
      : []),
    // compensatory days off (owner, 26 October 2026): only with some; an API from before them has none
    ...((f.compensatoryDays ?? 0) > 0
      ? [{ key: 'compensatory', label: 'Compensatory days off', value: String(f.compensatoryDays), note: null, definition: COMPENSATORY_DAYS_DEFINITION, tone: null }]
      : []),
    { key: 'extra', label: 'Overtime (extra time)', value: hoursText(f.extraHours), note: f.offDaysWorked > 0 ? `${days(f.offDaysWorked)} worked on a rest day or holiday` : null, definition: d.extraHours, tone: null },
  ];
}

// ---------- the charts ----------

/** A chart's size and its plot, as the salary history's (salary-history.ts): 640 × 220, room for the axes. */
export const CHART_SIZE = { width: 640, height: 220 };
const MARGIN = { left: 44, right: 16, top: 20, bottom: 28 };

export interface ChartPlot {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** A mark's hover and focus words, and where its tooltip points (the top of the mark). */
export interface ChartTip {
  key: string;
  text: string;
  x: number;
  y: number;
}

/** A chart's frame: its size, plot, the axes' ticks, and the chart in words for screen readers. */
interface ChartFrame {
  width: number;
  height: number;
  plot: ChartPlot;
  yTicks: { y: number; label: string }[];
  xTicks: { x: number; label: string }[];
  description: string;
}

/** The on-time trend: a line broken where a month (or quarter) has no day measured, with a dot on each measured one. */
export interface TrendChart extends ChartFrame {
  paths: string[];
  points: (ChartTip & { last: boolean })[];
  /** The latest point's value, labelled at its dot (the line's end). */
  endLabel: { x: number; y: number; text: string } | null;
}

/**
 * A column chart: each column's rounded-top path (4px, square at the baseline), its tooltip, and its hover and focus
 * area: its whole band, the full height of the plot (bigger than the mark).
 */
export interface ColumnChart extends ChartFrame {
  bars: (ChartTip & { d: string; label: string | null; labelY: number; hit: { x: number; width: number } })[];
}

const round = (v: number) => Math.round(v * 10) / 10;
const plotOf = (size: { width: number; height: number }): ChartPlot => ({ left: MARGIN.left, top: MARGIN.top, right: size.width - MARGIN.right, bottom: size.height - MARGIN.bottom });

/** Every `step`-th label of `n` (the first and every step after), so a long axis doesn't crowd: at most `most`. */
const thinned = (n: number, most: number) => {
  const step = Math.max(1, Math.ceil(n / most));
  return (i: number) => i % step === 0;
};

/** Round count ticks from 0 for a largest value: 0, 2, 4 … (whole numbers, at most 5 steps). */
export function countTicks(max: number): number[] {
  if (!(max > 0)) return [0, 1];
  const step = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000].find((s) => max / s <= 4) ?? Math.ceil(max / 4);
  const top = Math.ceil(max / step) * step;
  const out: number[] = [];
  for (let t = 0; t <= top; t += step) out.push(t);
  return out;
}

/** A column's outline: a 4px rounded top (the data end), square at the baseline (marks-and-anatomy). None when 0 high. */
export function columnPath(x: number, y: number, w: number, h: number, r = 4): string {
  if (!(h > 0) || !(w > 0)) return '';
  const k = Math.min(r, w / 2, h);
  return `M${round(x)} ${round(y + h)} V${round(y + k)} Q${round(x)} ${round(y)} ${round(x + k)} ${round(y)} H${round(x + w - k)} Q${round(x + w)} ${round(y)} ${round(x + w)} ${round(y + k)} V${round(y + h)} Z`;
}

/**
 * The on-time trend (the brief: "by month, or by quarter when the period is a year or more"): each point of the period
 * on its own band, y from 0% to 100%; null when no point has a day measured.
 */
export function trendChart(points: readonly HistoryTrendPoint[], by: 'month' | 'quarter', size = CHART_SIZE): TrendChart | null {
  const measured = points.filter((p) => p.onTimeRate !== null);
  if (!measured.length) return null;
  const plot = plotOf(size);
  const band = (plot.right - plot.left) / points.length;
  const x = (i: number) => round(plot.left + (i + 0.5) * band);
  const y = (rate: number) => round(plot.bottom - rate * (plot.bottom - plot.top));
  const paths: string[] = [];
  let run: string[] = [];
  points.forEach((p, i) => {
    if (p.onTimeRate === null) {
      if (run.length > 1) paths.push(run.join(' '));
      run = [];
      return;
    }
    run.push(`${run.length ? 'L' : 'M'}${x(i)} ${y(p.onTimeRate)}`);
  });
  if (run.length > 1) paths.push(run.join(' '));
  const lastMeasured = measured.at(-1)!;
  const tipOf = (p: HistoryTrendPoint) => `${p.label}: ${percentText(p.onTimeRate)} on time (${p.onTimeDays} of ${days(p.measuredDays)})`;
  const shown = thinned(points.length, 12);
  const pts = points.flatMap((p, i) => (p.onTimeRate === null ? [] : [{ key: p.key, x: x(i), y: y(p.onTimeRate), text: tipOf(p), last: p === lastMeasured }]));
  const end = pts.find((p) => p.last)!;
  const rates = measured.map((p) => p.onTimeRate!);
  const unit = by === 'quarter' ? 'quarter' : 'month';
  return {
    width: size.width,
    height: size.height,
    plot,
    yTicks: [0, 0.25, 0.5, 0.75, 1].map((r) => ({ y: y(r), label: `${r * 100}%` })),
    xTicks: points.flatMap((p, i) => (shown(i) ? [{ x: x(i), label: p.label }] : [])),
    paths,
    points: pts,
    endLabel: { x: end.x, y: end.y, text: percentText(lastMeasured.onTimeRate) },
    description:
      measured.length === 1
        ? `On-time share for ${lastMeasured.label}: ${percentText(lastMeasured.onTimeRate)}.`
        : `On-time share by ${unit}, ${points[0].label} to ${points.at(-1)!.label}: from ${percentText(Math.min(...rates))} to ${percentText(Math.max(...rates))}, ${percentText(lastMeasured.onTimeRate)} in ${lastMeasured.label}.`,
  };
}

/** Columns on bands across the plot: at most 24px wide with at least a 2px gap between them (marks-and-anatomy). */
function columns<T>(
  items: readonly T[],
  value: (t: T) => number,
  size: { width: number; height: number },
): { plot: ChartPlot; ticks: number[]; y: (v: number) => number; at: (i: number) => { x: number; w: number; centre: number; hit: { x: number; width: number } } } {
  const plot = plotOf(size);
  const ticks = countTicks(Math.max(0, ...items.map(value)));
  const top = ticks.at(-1)!;
  const band = (plot.right - plot.left) / Math.max(1, items.length);
  const w = Math.max(2, Math.min(24, band - 2));
  return {
    plot,
    ticks,
    y: (v: number) => round(plot.bottom - (v / top) * (plot.bottom - plot.top)),
    at: (i: number) => {
      const x = plot.left + i * band + (band - w) / 2;
      return { x: round(x), w: round(w), centre: round(x + w / 2), hit: { x: round(plot.left + i * band), width: round(band) } };
    },
  };
}

/**
 * The check-in time distribution (the brief: "15-minute bins"): a column a bin, the hours labelled on the axis where
 * their first bin starts (every second or third one on a long day); the busiest bin labelled with its count. Null with
 * no check-in.
 */
export function binsChart(bins: readonly HistoryBin[], size = CHART_SIZE): ColumnChart | null {
  const total = bins.reduce((s, b) => s + b.count, 0);
  if (!bins.length || !total) return null;
  const c = columns(bins, (b) => b.count, size);
  const busiest = bins.reduce((m, b) => (b.count > m.count ? b : m), bins[0]);
  const hours = bins.filter((b) => b.from % 60 === 0).length;
  const every = hours > 12 ? 3 : hours > 7 ? 2 : 1;
  const hourLabel = (minutes: number) => clockText(minutes).replace(':00', '');
  return {
    width: size.width,
    height: size.height,
    plot: c.plot,
    yTicks: c.ticks.map((t) => ({ y: c.y(t), label: String(t) })),
    xTicks: bins.flatMap((b, i) => (b.from % 60 === 0 && Math.floor(b.from / 60) % every === 0 ? [{ x: c.at(i).hit.x, label: hourLabel(b.from) }] : [])),
    bars: bins.map((b, i) => {
      const { x, w, centre, hit } = c.at(i);
      const y = c.y(b.count);
      const until = clockText(b.from + 14);
      return {
        key: String(b.from),
        hit,
        x: centre,
        y,
        d: columnPath(x, y, w, c.plot.bottom - y),
        text: `${b.label}–${until}: ${b.count} ${b.count === 1 ? 'check-in' : 'check-ins'}`,
        label: b === busiest ? String(b.count) : null,
        labelY: y - 6,
      };
    }),
    description: `First check-ins by 15 minutes, ${bins[0].label} to ${clockText(bins.at(-1)!.from + 14)}: ${total} in all, most at ${busiest.label} (${busiest.count}).`,
  };
}

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Late days by weekday (the brief: "Sun–Thu, or the company's working days"): a column a weekday, each labelled with its
 * late days (a handful of columns: each is read). Null when no day was measured.
 */
export function weekdayChart(weekdays: readonly HistoryWeekday[], size = CHART_SIZE): ColumnChart | null {
  if (!weekdays.length || !weekdays.some((w) => w.measuredDays > 0)) return null;
  const c = columns(weekdays, (w) => w.lateDays, size);
  const late = weekdays.reduce((s, w) => s + w.lateDays, 0);
  const most = weekdays.reduce((m, w) => (w.lateDays > m.lateDays ? w : m), weekdays[0]);
  return {
    width: size.width,
    height: size.height,
    plot: c.plot,
    yTicks: c.ticks.map((t) => ({ y: c.y(t), label: String(t) })),
    xTicks: weekdays.map((w, i) => ({ x: c.at(i).centre, label: w.label })),
    bars: weekdays.map((w, i) => {
      const { x, w: width, centre, hit } = c.at(i);
      const y = c.y(w.lateDays);
      return {
        key: String(w.weekday),
        hit,
        x: centre,
        y,
        d: columnPath(x, y, width, c.plot.bottom - y),
        text: `${WEEKDAY_NAMES[w.weekday]}: ${w.lateDays} late of ${days(w.measuredDays)} measured`,
        label: String(w.lateDays),
        labelY: y - 6,
      };
    }),
    description: late
      ? `Late days by weekday: ${late} in all, most on ${WEEKDAY_NAMES[most.weekday]} (${most.lateDays}).`
      : 'Late days by weekday: none late in this period.',
  };
}

/** A trend point's on-time share for its table: "85% (17 of 20)", or "No day measured". */
export const trendCell = (p: Pick<HistoryTrendPoint, 'onTimeRate' | 'onTimeDays' | 'measuredDays'>) =>
  p.onTimeRate === null ? 'No day measured' : `${percentText(p.onTimeRate)} (${p.onTimeDays} of ${p.measuredDays})`;

/** The date of a log row: "Sun 18/10/2026". */
export const logDateText = (d: { date: string; weekday: number }) => `${WEEKDAY_NAMES[d.weekday].slice(0, 3)} ${formatDate(d.date)}`;
