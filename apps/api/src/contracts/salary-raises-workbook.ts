import ExcelJS from 'exceljs';
import {
  PAY_STAGE_LABELS,
  RAISE_KIND_LABELS,
  RAISE_REASON_LABELS,
  RAISE_REQUEST_STATUS_LABELS,
  type DepartmentRaises,
  type DueForReviewRow,
  type RaiseTotals,
  type ReportPeriod,
  type SalaryRaiseRow,
  type SalaryRaisesReport,
} from '@trendlix/shared';
import { dayInCairo, shownDate } from '../common/date-only.js';
import { addSheet, type Column } from '../employees/missing-workbook.js';
import { departmentName } from './views.js';

// The Salary Raises report as an Excel workbook (owner's decision, 16 October 2026: the salary raises tracked in a
// company-wide report as well as on each profile's Salary History), for HR, Finance and the CEO to work with outside the
// system. Three sheets: "Raises", one row per raise that took effect in the period; "By Department", each department's
// raises in total, with every department's below them; "Due for Review", who has had no raise for the setting's months
// or more, or none since joining. Written like the Missing Details workbook (bold, frozen headers, column widths, an
// autofilter), money with two decimals, percents to one decimal, dates DD/MM/YYYY.

const MONEY = '#,##0.00';
const PERCENT = '0.0%';
const COUNT = '0';

/** The name the workbook is saved under, with its period: "Salary raises 2026-01 to 2026-12.xlsx". */
export const salaryRaisesFileName = (p: ReportPeriod) => `Salary raises ${p.from} to ${p.to}.xlsx`;

/** 25 (percent) → 0.25, as Excel keeps a percent. */
const fraction = (percent: number | null) => (percent === null ? null : Math.round(percent * 10) / 1000);
const date = (ymd: string | null) => (ymd ? shownDate(ymd) : null);

/** "Senior Accountant, grade G5"; null without a promotion. */
export function promotionText(p: SalaryRaiseRow['promotion']): string | null {
  if (!p) return null;
  return [p.jobTitle, p.grade && `grade ${p.grade}`].filter(Boolean).join(', ') || null;
}

/** "CON-2026-0007-A1 · With the CEO · from 01/12/2026"; null without one. */
export function openRaiseText(r: DueForReviewRow['openRaise']): string | null {
  return r && `${r.number} · ${PAY_STAGE_LABELS[r.stage] ?? r.stage} · from ${shownDate(r.effectiveDate)}`;
}

const RAISE_COLUMNS: readonly Column<SalaryRaiseRow>[] = [
  { header: 'Code', width: 11, value: (r) => r.employee.employeeCode },
  { header: 'Name (English)', width: 30, value: (r) => r.employee.fullNameEn },
  { header: 'Name (Arabic)', width: 30, value: (r) => r.employee.fullNameAr },
  { header: 'Department', width: 28, value: (r) => departmentName(r.department) },
  { header: 'Job title', width: 26, value: (r) => r.jobTitle },
  { header: 'Promotion', width: 28, value: (r) => promotionText(r.promotion) },
  { header: 'Effective date', width: 13, value: (r) => date(r.effectiveDate) },
  { header: 'In force', width: 9, value: (r) => (r.upcoming ? 'Not yet' : 'Yes') },
  { header: 'Kind', width: 20, value: (r) => RAISE_KIND_LABELS[r.kind] ?? r.kind },
  { header: 'Reason', width: 15, value: (r) => (r.reason ? (RAISE_REASON_LABELS[r.reason] ?? r.reason) : null) },
  { header: 'Gross before', width: 14, value: (r) => r.gross.from, numFmt: MONEY },
  { header: 'Gross after', width: 14, value: (r) => r.gross.to, numFmt: MONEY },
  { header: 'Change', width: 13, value: (r) => r.change.amount, numFmt: MONEY },
  { header: 'Change %', width: 10, value: (r) => fraction(r.change.percent), numFmt: PERCENT },
  { header: 'Allowances before', width: 17, value: (r) => r.allowances.from, numFmt: MONEY },
  { header: 'Allowances after', width: 16, value: (r) => r.allowances.to, numFmt: MONEY },
  { header: 'Monthly cost increase', width: 20, value: (r) => r.monthlyCost, numFmt: MONEY },
  { header: 'Approved by', width: 26, value: (r) => r.approvedBy },
  { header: 'Approved on', width: 13, value: (r) => (r.approvedAt ? shownDate(dayInCairo(new Date(r.approvedAt))) : null) },
  { header: 'Signed on', width: 13, value: (r) => date(r.signedOn) },
  { header: 'Contract', width: 20, value: (r) => r.number },
];

/** The totals' columns, after the department's name: on each department's row and on every department's. */
const TOTAL_COLUMNS: readonly Column<RaiseTotals>[] = [
  { header: 'Raises', width: 9, value: (t) => t.count, numFmt: COUNT },
  { header: 'People', width: 9, value: (t) => t.people, numFmt: COUNT },
  { header: 'Average change %', width: 17, value: (t) => fraction(t.averagePercent), numFmt: PERCENT },
  { header: 'Median change %', width: 16, value: (t) => fraction(t.medianPercent), numFmt: PERCENT },
  { header: 'Monthly cost increase', width: 20, value: (t) => t.monthlyCostIncrease, numFmt: MONEY },
  { header: 'Yearly cost increase', width: 20, value: (t) => t.yearlyCostIncrease, numFmt: MONEY },
];

const DEPARTMENT_COLUMNS: readonly Column<DepartmentRaises>[] = [
  { header: 'Department', width: 30, value: (d) => d.department?.nameEn ?? 'No department' },
  ...TOTAL_COLUMNS,
];

const REVIEW_COLUMNS: readonly Column<DueForReviewRow>[] = [
  { header: 'Code', width: 11, value: (r) => r.employee.employeeCode },
  { header: 'Name (English)', width: 30, value: (r) => r.employee.fullNameEn },
  { header: 'Name (Arabic)', width: 30, value: (r) => r.employee.fullNameAr },
  { header: 'Department', width: 28, value: (r) => departmentName(r.department) },
  { header: 'Job title', width: 26, value: (r) => r.jobTitle },
  { header: 'Joined', width: 12, value: (r) => date(r.joinDate) },
  { header: 'Last raise', width: 12, value: (r) => date(r.lastRaise) },
  { header: 'Months since', width: 13, value: (r) => r.monthsSince, numFmt: COUNT },
  { header: 'Current gross', width: 14, value: (r) => r.currentGross, numFmt: MONEY },
  { header: 'Open raise', width: 40, value: (r) => openRaiseText(r.openRaise) },
  { header: 'Open raise request', width: 18, value: (r) => (r.openRequest ? (RAISE_REQUEST_STATUS_LABELS[r.openRequest.status] ?? r.openRequest.status) : null) },
];

/**
 * The report as an .xlsx: "Raises" in the report's order (oldest first); "By Department", by name, then a bold row of
 * every department's totals below the filtered rows; "Due for Review", longest waiting first.
 */
export async function salaryRaisesWorkbook(report: Pick<SalaryRaisesReport, 'raises' | 'totals' | 'byDepartment' | 'dueForReview'>): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  addSheet(wb, 'Raises', RAISE_COLUMNS, report.raises);

  const departments = addSheet(wb, 'By Department', DEPARTMENT_COLUMNS, report.byDepartment);
  const total = departments.getRow(report.byDepartment.length + 2);
  const name = total.getCell(1);
  name.value = 'All departments';
  name.font = { name: 'Calibri', size: 11, bold: true };
  TOTAL_COLUMNS.forEach((c, i) => {
    const cell = total.getCell(i + 2);
    const value = c.value(report.totals);
    if (value !== null) cell.value = value;
    cell.numFmt = c.numFmt ?? '@';
    cell.font = { name: 'Calibri', size: 11, bold: true };
  });

  addSheet(wb, 'Due for Review', REVIEW_COLUMNS, report.dueForReview);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
