import ExcelJS from 'exceljs';
import {
  confidentialExcludedNote,
  CONTRACT_FORM_LABELS,
  CONTRACT_VERSION_KIND_LABELS,
  CONTRACTS_REPORT_SHOW_LABELS,
  CONTRACTS_REPORT_STATUS_FILTER_LABELS,
  CONTRACTS_REPORT_STATUS_LABELS,
  departmentOf,
  EMPLOYEE_STANDING_LABELS,
  LABELS,
  type ContractsReport,
  type ContractsReportFiltersUsed,
  type ContractsReportRow,
  type ReportDepartment,
  type ReportPeriod,
} from '@trendlix/shared';
import { dayInCairo, shownDate } from '../common/date-only.js';
import { addSheet, type Column } from '../employees/missing-workbook.js';
import { departmentName } from './views.js';

// The Contracts report as an Excel workbook (owner, 25 October 2026: "if i want to export a contracts report, status,
// start and end dates, how?"; "A report under Reports", "Dates and status": no salary or allowances in it), for HR,
// Finance and the CEO to work with outside the system. Two sheets: "Contracts", one row per contract version on the
// report, in its order, its dates real Excel dates shown DD/MM/YYYY as the system shows them; "Summary", the totals and
// the filters used. Written with the Missing Details workbook's sheets (bold, frozen headers, an autofilter), the
// columns' widths fitted to what they hold.

const DATE = 'dd/mm/yyyy';
const COUNT = '0';
/** The narrowest and widest a fitted column is, in characters. */
const MIN_WIDTH = 8;
const MAX_WIDTH = 48;

/** The name the workbook is saved under, with its period: "Contracts 2026-01 to 2026-12.xlsx". */
export const contractsReportFileName = (p: ReportPeriod) => `Contracts ${p.from} to ${p.to}.xlsx`;

/** A day (YYYY-MM-DD) as a real Excel date: midnight UTC, which ExcelJS writes as that day; null for none. */
export const excelDate = (ymd: string | null): Date | null => (ymd ? new Date(`${ymd}T00:00:00.000Z`) : null);

/** Days left as the column has it: the days for a signed contract in force with an end (negative once past), "Ended" for an ended one. */
export function daysLeftCell(r: Pick<ContractsReportRow, 'status' | 'daysLeft'>): number | string | null {
  return r.status === 'ended' ? 'Ended' : r.daysLeft;
}

/** The department a place is in (a team's own department), and the team when it is one. */
const departmentText = (d: ReportDepartment | null) => departmentOf(d)?.nameEn ?? null;
const teamText = (d: ReportDepartment | null) => (d?.parent ? d.nameEn : null);
const labelOf = (labels: Readonly<Record<string, string>>, value: string) => labels[value] ?? value;

const CONTRACT_COLUMNS: readonly Column<ContractsReportRow>[] = [
  { header: 'Employee code', width: 13, value: (r) => r.employee.employeeCode },
  { header: 'Employee name (English)', width: 24, value: (r) => r.employee.fullNameEn },
  { header: 'Department', width: 14, value: (r) => departmentText(r.department) },
  { header: 'Team', width: 10, value: (r) => teamText(r.department) },
  { header: 'Job title', width: 12, value: (r) => r.jobTitle },
  { header: 'Contract number', width: 15, value: (r) => r.number },
  { header: 'Version', width: MIN_WIDTH, value: (r) => r.version, numFmt: COUNT },
  { header: 'Kind', width: MIN_WIDTH, value: (r) => CONTRACT_VERSION_KIND_LABELS[r.kind] ?? r.kind },
  { header: 'Employment type', width: 15, value: (r) => labelOf(LABELS.employmentType, r.employmentType) },
  { header: 'Length', width: MIN_WIDTH, value: (r) => labelOf(CONTRACT_FORM_LABELS, r.form) },
  { header: 'Start date', width: 11, value: (r) => excelDate(r.startDate), numFmt: DATE },
  { header: 'End date', width: 11, value: (r) => excelDate(r.endDate), numFmt: DATE },
  { header: 'Days left', width: 10, value: daysLeftCell, numFmt: COUNT },
  { header: 'Status', width: MIN_WIDTH, value: (r) => CONTRACTS_REPORT_STATUS_LABELS[r.status] ?? r.status },
  { header: 'Signed on', width: 11, value: (r) => excelDate(r.signedOn), numFmt: DATE },
  { header: 'Probation end', width: 13, value: (r) => excelDate(r.probationEnd), numFmt: DATE },
  { header: 'Employee status', width: 15, value: (r) => EMPLOYEE_STANDING_LABELS[r.employeeStatus] ?? r.employeeStatus },
];

/** How wide a value reads: a date as DD/MM/YYYY, a number by its digits. */
const textWidth = (v: string | number | Date | null) => (v === null ? 0 : v instanceof Date ? 10 : String(v).length);

/** The columns with their widths fitted to the header and the values, from each column's own width up to MAX_WIDTH. */
export function fitted<T>(columns: readonly Column<T>[], rows: readonly T[]): Column<T>[] {
  return columns.map((c) => ({ ...c, width: Math.min(MAX_WIDTH, Math.max(c.width, c.header.length + 2, ...rows.map((r) => textWidth(c.value(r)) + 2))) }));
}

/** A line of the Summary: what it is, and its value (a count, or a filter in words); a line with neither is a gap. */
interface SummaryLine {
  item: string | null;
  value: string | number | null;
}

const SUMMARY_COLUMNS: readonly Column<SummaryLine>[] = [
  { header: 'Summary', width: 30, value: (l) => l.item },
  // a count as a number, a filter as text
  { header: 'Value', width: 14, value: (l) => l.value, numFmt: 'General' },
];

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** "2026-01" → "January 2026". */
const monthText = (month: string) => `${MONTH_NAMES[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;

/** The period in words: "January 2026 to December 2026", or one month alone. */
export const periodText = (p: ReportPeriod) => (p.from === p.to ? monthText(p.from) : `${monthText(p.from)} to ${monthText(p.to)}`);

/** The time in Cairo, 24-hour: "14:05". */
const cairoTime = (moment: Date) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(moment);

/** The filters used, in words, as the page's filters name them. */
export function filterLines(f: ContractsReportFiltersUsed): SummaryLine[] {
  return [
    { item: 'Period', value: periodText(f.period) },
    { item: 'Status', value: CONTRACTS_REPORT_STATUS_FILTER_LABELS[f.status] ?? f.status },
    { item: 'Show', value: CONTRACTS_REPORT_SHOW_LABELS[f.show] ?? f.show },
    { item: 'Employment type', value: f.employmentType ? labelOf(LABELS.employmentType, f.employmentType) : 'All types' },
    { item: 'Contract length', value: f.form ? labelOf(CONTRACT_FORM_LABELS, f.form) : 'Any length' },
    { item: 'Department or team', value: f.department ? departmentName(f.department) : 'Everyone' },
    { item: 'Ending within', value: f.endingWithin === null ? 'Any time' : `${f.endingWithin} ${f.endingWithin === 1 ? 'day' : 'days'}` },
    { item: 'Search', value: f.q ?? 'None' },
  ];
}

/** The totals, in the order of the page's tiles. */
export function totalLines(t: ContractsReport['totals']): SummaryLine[] {
  return [
    { item: 'Contracts', value: t.contracts },
    { item: 'People', value: t.people },
    { item: CONTRACTS_REPORT_STATUS_LABELS.active, value: t.byStatus.active },
    { item: 'Drafts', value: t.byStatus.draft },
    { item: CONTRACTS_REPORT_STATUS_LABELS.ended, value: t.byStatus.ended },
    { item: CONTRACTS_REPORT_STATUS_LABELS.superseded, value: t.byStatus.superseded },
    ...t.endingIn.map((e) => ({ item: `Ending in the next ${e.days} days`, value: e.count })),
    { item: 'Ended in the period, not renewed', value: t.notRenewed },
    { item: 'Renewals signed in the period', value: t.renewalsSigned },
  ];
}

/**
 * The report as an .xlsx: "Contracts" in the report's order, then "Summary" (the totals, the filters used, the C-level
 * people left out if any, and when it was made).
 */
export async function contractsReportWorkbook(
  report: Pick<ContractsReport, 'filters' | 'rows' | 'totals'> & { generatedAt: string; confidentialExcluded: number },
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  addSheet(wb, 'Contracts', fitted(CONTRACT_COLUMNS, report.rows), report.rows);

  const made = new Date(report.generatedAt);
  const excluded = confidentialExcludedNote(report.confidentialExcluded, 'contracts');
  const gap = { item: null, value: null };
  const lines: SummaryLine[] = [
    ...totalLines(report.totals),
    gap,
    ...filterLines(report.filters),
    gap,
    ...(excluded ? [{ item: 'C-level people left out', value: report.confidentialExcluded }, { item: excluded, value: null }] : []),
    { item: 'Made on', value: `${shownDate(dayInCairo(made))} ${cairoTime(made)} (Cairo)` },
  ];
  const summary = addSheet(wb, 'Summary', fitted(SUMMARY_COLUMNS, lines), lines);
  // a list of figures, not a table to filter
  summary.autoFilter = undefined;
  return Buffer.from(await wb.xlsx.writeBuffer());
}
