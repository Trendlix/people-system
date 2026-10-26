import ExcelJS from 'exceljs';
import {
  confidentialExcludedNote,
  departmentOf,
  LEAVE_REPORT_SOURCE_LABELS,
  leaveReportGroups,
  leaveReportTotals,
  type LeaveReport,
  type LeaveReportLeave,
  type LeaveReportPerson,
  type LeaveReportTotals,
  type ReportDepartment,
  type ReportPeriod,
} from '@trendlix/shared';
import { excelDate, fitted, periodText } from '../contracts/contracts-report-workbook.js';
import { dayInCairo, shownDate } from '../common/date-only.js';
import { addSheet, type Column } from '../employees/missing-workbook.js';

// The Leave report as an Excel workbook (owner, 26 October 2026: "can i get a report for the monthly leaves with all
// types?"; asked, "Both": the summary and the list), for HR and the CEO to work with outside the system. Two sheets:
// "Summary", one row per employee with a column per leave type that has days in the period, then the leave days,
// permission hours, work from home days and the annual balance left, the departments and teams as rows of their own
// with their subtotals and the grand total at the end; "Leaves", one row per leave overlapping the period. Dates are real
// Excel dates shown DD/MM/YYYY as the system shows them, days and hours numbers; the headings bold and frozen, the
// columns' widths fitted to what they hold. Written with the Contracts report's helpers.

const DATE = 'dd/mm/yyyy';
/** Days and hours (halves and tenths), and whole counts. */
const NUMBER = 'General';
const COUNT = '0';

const THIN = { style: 'thin' } as const;

/** The name the workbook is saved under, with its period: "Leave 2026-10.xlsx" for a month, "Leave 2026-01 to 2026-12.xlsx" for a range. */
export const leaveReportFileName = (p: ReportPeriod) => (p.from === p.to ? `Leave ${p.from}.xlsx` : `Leave ${p.from} to ${p.to}.xlsx`);

const departmentText = (d: ReportDepartment | null) => departmentOf(d)?.nameEn ?? null;
const teamText = (d: ReportDepartment | null) => (d?.parent ? d.nameEn : null);

/** The time in Cairo, 24-hour: "14:05". */
const cairoTime = (moment: Date) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(moment);

const LEAVE_COLUMNS: readonly Column<LeaveReportLeave>[] = [
  { header: 'Employee code', width: 13, value: (l) => l.employee.employeeCode },
  { header: 'Employee name (English)', width: 24, value: (l) => l.employee.fullNameEn },
  { header: 'Department', width: 14, value: (l) => departmentText(l.department) },
  { header: 'Team', width: 10, value: (l) => teamText(l.department) },
  { header: 'Leave type', width: 14, value: (l) => l.typeName },
  { header: 'From', width: 11, value: (l) => excelDate(l.startDate), numFmt: DATE },
  { header: 'To', width: 11, value: (l) => excelDate(l.endDate), numFmt: DATE },
  { header: 'Half day', width: 9, value: (l) => (l.halfDay ? 'Yes' : 'No') },
  { header: 'Days in the period', width: 12, value: (l) => l.daysInPeriod, numFmt: NUMBER },
  { header: 'Total days', width: 10, value: (l) => l.days, numFmt: NUMBER },
  { header: 'Recorded as', width: 14, value: (l) => LEAVE_REPORT_SOURCE_LABELS[l.source] ?? l.source },
  { header: 'Reason', width: 30, value: (l) => l.reason, wrap: true },
];

/** A line of the Summary sheet: a group's heading, a person, a subtotal or the grand total. */
type Line =
  | { kind: 'heading'; text: string; level: 'department' | 'team' }
  | { kind: 'person'; person: LeaveReportPerson }
  | { kind: 'total'; text: string; totals: LeaveReportTotals; grand: boolean };

/** The summary's lines: each department (its own people, then its teams), the subtotals, and the grand total. */
export function summaryLines(report: Pick<LeaveReport, 'people' | 'totals'>): Line[] {
  const lines: Line[] = [];
  for (const d of leaveReportGroups(report.people)) {
    const name = d.department ?? 'No department';
    lines.push({ kind: 'heading', text: name, level: 'department' });
    for (const t of d.teams) {
      if (t.team !== null) lines.push({ kind: 'heading', text: `${name} › ${t.team}`, level: 'team' });
      for (const person of t.people) lines.push({ kind: 'person', person });
      if (t.team !== null) lines.push({ kind: 'total', text: `Total · ${t.team}`, totals: t.totals, grand: false });
    }
    lines.push({ kind: 'total', text: `Total · ${name}`, totals: d.totals, grand: false });
  }
  lines.push({ kind: 'total', text: 'Total · everyone', totals: leaveReportTotals(report.people), grand: true });
  return lines;
}

/** The report as an .xlsx: "Summary" (the groups as rows), then "Leaves" (the list). */
export async function leaveReportWorkbook(
  report: Pick<LeaveReport, 'filters' | 'types' | 'people' | 'leaves' | 'totals'> & { generatedAt: string; balanceAsOf: string; confidentialExcluded: number },
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const summary = wb.addWorksheet('Summary', { views: [{ state: 'frozen', xSplit: 2, ySplit: 1 }] });

  const heads = ['Employee code', 'Employee name (English)', 'Department', 'Team', ...report.types.map((t) => t.nameEn), 'Leave days', 'Permission hours', 'Work from home days', 'Annual balance left'];
  const lines = summaryLines(report);
  const typeCell = (totals: Pick<LeaveReportPerson, 'days'>, id: string) => totals.days?.[id] ?? 0;
  const cells = (line: Line): (string | number | null)[] => {
    if (line.kind === 'heading') return [line.text];
    if (line.kind === 'person') {
      const p = line.person;
      return [p.employee.employeeCode, p.employee.fullNameEn, departmentText(p.department), teamText(p.department), ...report.types.map((t) => typeCell(p, t.id)), p.leaveDays, p.permissionHours, p.wfhDays, p.annualLeft];
    }
    const t = line.totals;
    return [line.text, null, null, null, ...report.types.map((ty) => t.byType[ty.id] ?? 0), t.leaveDays, t.permissionHours, t.wfhDays, null];
  };

  // the widths fitted to the headings and the values
  const width = heads.map((h, i) => Math.min(48, Math.max(i === 1 ? 24 : i === 0 ? 13 : 9, h.length + 2, ...lines.map((l) => (l.kind === 'heading' ? 0 : String(cells(l)[i] ?? '').length + 2)))));
  width.forEach((w, i) => (summary.getColumn(i + 1).width = w));

  const header = summary.getRow(1);
  heads.forEach((h, i) => {
    const cell = header.getCell(i + 1);
    cell.value = h;
    cell.font = { name: 'Calibri', size: 11, bold: true };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } };
    cell.alignment = { vertical: 'middle', wrapText: true };
    cell.border = { left: THIN, right: THIN, top: THIN, bottom: THIN };
  });

  lines.forEach((line, n) => {
    const row = summary.getRow(n + 2);
    cells(line).forEach((value, i) => {
      const cell = row.getCell(i + 1);
      if (value !== null) cell.value = value;
      // the figures are numbers, the codes and names text
      cell.numFmt = i >= 4 && line.kind !== 'heading' ? (i === heads.length - 2 ? COUNT : NUMBER) : '@';
      cell.alignment = { vertical: 'top' };
    });
    if (line.kind === 'heading') {
      row.getCell(1).font = { name: 'Calibri', size: 11, bold: true };
      for (let i = 1; i <= heads.length; i++) row.getCell(i).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: line.level === 'department' ? 'FFEDEDED' : 'FFF7F7F7' } };
    } else if (line.kind === 'total') {
      for (let i = 1; i <= heads.length; i++) {
        const cell = row.getCell(i);
        cell.font = { name: 'Calibri', size: 11, bold: true };
        cell.border = { top: THIN, ...(line.grand && { bottom: { style: 'double' as const } }) };
      }
    }
  });

  // under the table: what is counted, the C-level people left out if any, and when it was made
  const made = new Date(report.generatedAt);
  const excluded = confidentialExcludedNote(report.confidentialExcluded, 'leave');
  const notes: [string, string][] = [
    ['Period', periodText(report.filters.period)],
    ['Counted', 'Approved leave only; a leave crossing the period counts its days inside it'],
    ['Annual balance left', `On ${shownDate(report.balanceAsOf)}`],
    ...(report.filters.department ? [['Department or team', report.filters.department.nameEn] as [string, string]] : []),
    ...(report.filters.employee ? [['Employee', `${report.filters.employee.fullNameEn} (${report.filters.employee.employeeCode})`] as [string, string]] : []),
    ...(excluded ? [['C-level people left out', excluded] as [string, string]] : []),
    ['Made on', `${shownDate(dayInCairo(made))} ${cairoTime(made)} (Cairo)`],
  ];
  notes.forEach(([item, value], i) => {
    const row = summary.getRow(lines.length + 3 + i);
    row.getCell(1).value = item;
    row.getCell(1).font = { name: 'Calibri', size: 11, bold: true };
    row.getCell(2).value = value;
  });

  addSheet(wb, 'Leaves', fitted(LEAVE_COLUMNS, report.leaves), report.leaves);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
