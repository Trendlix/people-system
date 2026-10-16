import ExcelJS from 'exceljs';
import {
  PAYROLL_STATUS_LABELS,
  type GroupStatistics,
  type MonthStatistics,
  type PayrollFigures,
  type PayrollStatistics,
  type PeriodStatistics,
  type ReportPeriod,
} from '@trendlix/shared';
import { addSheet, type Column } from '../../employees/missing-workbook.js';
import { monthName } from '../months.js';

// The payroll statistics as an Excel workbook (owner, 17 October 2026: "Reports (Statistics)" under Payroll), for HR,
// Finance and the CEO to work with outside the system. Three sheets: "By Month", a row per month with an approved or
// paid run and the period's totals below; "By Department", each department's figures with its teams under it; and
// "Summary", the period's and this year's to date. Written like the Salary Raises workbook (bold, frozen headers,
// column widths, an autofilter), money with two decimals.

const MONEY = '#,##0.00';
const COUNT = '0';

/** The name the workbook is saved under, with its period: "Payroll statistics 2026-01 to 2026-12.xlsx". */
export const statisticsFileName = (p: ReportPeriod) => `Payroll statistics ${p.from} to ${p.to}.xlsx`;

/** The money columns, in the order the page shows them. */
function moneyColumns<T extends PayrollFigures>(): Column<T>[] {
  return [
    { header: 'Gross', width: 15, value: (r) => r.gross, numFmt: MONEY },
    { header: 'Net', width: 15, value: (r) => r.net, numFmt: MONEY },
    { header: 'Transfer', width: 15, value: (r) => r.transfer, numFmt: MONEY },
    { header: 'Salary tax', width: 14, value: (r) => r.salaryTax, numFmt: MONEY },
    { header: 'Employee insurance', width: 18, value: (r) => r.employeeInsurance, numFmt: MONEY },
    { header: 'Company insurance', width: 18, value: (r) => r.companyInsurance, numFmt: MONEY },
    { header: "Martyrs' Fund", width: 14, value: (r) => r.martyrsFund, numFmt: MONEY },
    { header: 'Company cost', width: 16, value: (r) => r.companyCost, numFmt: MONEY },
  ];
}

/** A month's row, or the period's totals at the foot ("Total", no status). */
type MonthRow = Omit<MonthStatistics, 'runId' | 'status'> & { label: string; status: string | null };

const MONTH_COLUMNS: readonly Column<MonthRow>[] = [
  { header: 'Month', width: 18, value: (r) => r.label },
  { header: 'Status', width: 10, value: (r) => r.status },
  { header: 'Employees', width: 11, value: (r) => r.employees, numFmt: COUNT },
  { header: 'On hold', width: 9, value: (r) => r.held, numFmt: COUNT },
  ...moneyColumns<MonthRow>(),
  { header: 'Average gross', width: 15, value: (r) => r.averageGross, numFmt: MONEY },
  { header: 'Median gross', width: 15, value: (r) => r.medianGross, numFmt: MONEY },
];

/** A department's row, or one of its teams' under it. */
type DepartmentRow = GroupStatistics & { department: string; team: string | null };

const DEPARTMENT_COLUMNS: readonly Column<DepartmentRow>[] = [
  { header: 'Department', width: 28, value: (r) => r.department },
  { header: 'Team', width: 24, value: (r) => r.team },
  { header: 'Employees', width: 11, value: (r) => r.employees, numFmt: COUNT },
  { header: 'Person-months', width: 14, value: (r) => r.personMonths, numFmt: COUNT },
  ...moneyColumns<DepartmentRow>(),
  { header: 'Average gross', width: 15, value: (r) => r.averageGross, numFmt: MONEY },
];

type SummaryRow = PeriodStatistics & { label: string };

const SUMMARY_COLUMNS: readonly Column<SummaryRow>[] = [
  { header: 'Period', width: 32, value: (r) => r.label },
  { header: 'Months', width: 9, value: (r) => r.months, numFmt: COUNT },
  { header: 'Employees', width: 11, value: (r) => r.employees, numFmt: COUNT },
  { header: 'Person-months', width: 14, value: (r) => r.personMonths, numFmt: COUNT },
  ...moneyColumns<SummaryRow>(),
  { header: 'Average gross', width: 15, value: (r) => r.averageGross, numFmt: MONEY },
  { header: 'Median gross', width: 15, value: (r) => r.medianGross, numFmt: MONEY },
];

/** "January 2026 to December 2026", or the one month. */
const periodText = (p: ReportPeriod) => (p.from === p.to ? monthName(p.from) : `${monthName(p.from)} to ${monthName(p.to)}`);

export async function statisticsWorkbook(s: PayrollStatistics): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const months: MonthRow[] = s.months.map((m) => ({ ...m, label: monthName(m.month), status: PAYROLL_STATUS_LABELS[m.status] ?? m.status }));
  const total: MonthRow = {
    ...s.totals,
    month: '',
    label: 'Total',
    status: null,
    employees: s.totals.employees,
    held: s.months.reduce((n, m) => n + m.held, 0),
  };
  const byMonth = addSheet(wb, 'By Month', MONTH_COLUMNS, s.months.length ? [...months, total] : []);
  if (s.months.length) byMonth.getRow(months.length + 2).font = { name: 'Calibri', size: 11, bold: true };

  const departments: DepartmentRow[] = s.byDepartment.flatMap((d) => [
    { ...d, department: d.name, team: null },
    ...d.teams.map((t) => ({ ...t, department: d.name, team: t.name })),
  ]);
  addSheet(wb, 'By Department', DEPARTMENT_COLUMNS, departments);

  addSheet(wb, 'Summary', SUMMARY_COLUMNS, [
    { ...s.totals, label: periodText(s.period) },
    { ...s.yearToDate, label: `${s.yearToDate.year} to date (${periodText({ from: s.yearToDate.from, to: s.yearToDate.to })})` },
  ]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
