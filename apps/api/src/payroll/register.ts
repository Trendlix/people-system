import ExcelJS from 'exceljs';
import { measuredExpectedHours, PAY_BASIS_LABELS, PAYROLL_STATUS_LABELS, type PayBasis, type PayrollInputs, type PayrollResult, type PayrollStatus, type PayrollTerms } from '@trendlix/shared';
import { shownDate } from '../common/date-only.js';
import type { BankFileKind } from './bank.js';
import { monthName } from './months.js';
import { byDepartment } from './roster.js';

// The payroll register (owner's decisions, 16 October 2026): the run as a spreadsheet, like the owner's payroll sheet,
// one row per employee grouped by department, every step of the pay, and a totals row. A draft says so in its title.
// No Medical column: there is no medical subscription any more (owner's decision, 16 October 2026). A run approved
// before then keeps its results as they were, so its net and transfer may still have one taken off. The Expected hours
// are those attendance was measured on, as the inputs grid shows them (owner, 17 October 2026: "dont count abcent days
// or leave days, as they already have their own deduction and fields"): HR's, else the shift's less the no-show and
// leave days, which have their own columns; on a line worked out before then, the hours typed or the shift's less the
// no-show days' hours it took out (they had a column of their own until then). So the Attendance % reads as the worked
// hours over the Expected hours on every line. A month split between two contracts (17 October 2026) shows its sums.

export interface RegisterLine {
  department: string | null;
  employeeCode: string;
  name: string;
  jobTitle: string | null;
  payBasis: PayBasis;
  terms: PayrollTerms;
  inputs: PayrollInputs;
  result: PayrollResult;
  bankFile: BankFileKind | null;
  onHold: boolean;
  comments: string | null;
}

export interface RegisterRun {
  month: string;
  status: PayrollStatus;
  paidOn: string | null;
  lines: readonly RegisterLine[];
}

const MONEY = '#,##0.00';
const PERCENT = '0.00%';
const HOURS = '#,##0.00';
const DAYS = '0.0';

type Kind = 'text' | 'money' | 'percent' | 'hours' | 'days' | 'count';

interface Column {
  header: string;
  kind: Kind;
  width: number;
  value: (l: RegisterLine, n: number) => string | number | null;
}

const pct = (v: number | null) => (v === null ? null : v / 100);

export const REGISTER_COLUMNS: readonly Column[] = [
  { header: '#', kind: 'count', width: 5, value: (_l, n) => n },
  { header: 'Department', kind: 'text', width: 24, value: (l) => l.department },
  { header: 'ID', kind: 'text', width: 11, value: (l) => l.employeeCode },
  { header: 'Name', kind: 'text', width: 30, value: (l) => l.name },
  { header: 'Title', kind: 'text', width: 24, value: (l) => l.jobTitle },
  { header: 'Pay basis', kind: 'text', width: 15, value: (l) => PAY_BASIS_LABELS[l.payBasis] },
  { header: 'Gross salary', kind: 'money', width: 14, value: (l) => l.terms.gross },
  { header: 'Fixed', kind: 'money', width: 13, value: (l) => l.result.fixed },
  { header: 'Variable', kind: 'money', width: 13, value: (l) => l.result.variable },
  { header: 'Paid days', kind: 'days', width: 9, value: (l) => l.terms.paidDays },
  { header: 'Worked hours', kind: 'hours', width: 11, value: (l) => l.inputs.workedHours },
  // those attendance was measured on: HR's, else the shift's less the no-show and leave days (17 October 2026)
  { header: 'Expected hours', kind: 'hours', width: 11, value: (l) => measuredExpectedHours(l) },
  { header: 'Attendance %', kind: 'percent', width: 11, value: (l) => l.result.attendanceRatio },
  { header: 'Soft skills %', kind: 'percent', width: 11, value: (l) => pct(l.inputs.softSkills) },
  { header: 'Performance %', kind: 'percent', width: 12, value: (l) => pct(l.inputs.performance) },
  { header: 'Client satisfaction %', kind: 'percent', width: 12, value: (l) => pct(l.inputs.clientSatisfaction) },
  { header: 'KPI %', kind: 'percent', width: 9, value: (l) => l.result.kpiScore },
  { header: 'No-show days', kind: 'days', width: 9, value: (l) => l.inputs.noShowDays },
  // paid leave (17 October 2026): none on inputs saved before then
  { header: 'Leave days', kind: 'days', width: 9, value: (l) => l.inputs.leaveDays ?? null },
  { header: 'Penalty days', kind: 'days', width: 9, value: (l) => l.inputs.penaltyDays },
  { header: 'Attendance cut', kind: 'money', width: 12, value: (l) => l.result.attendanceCut },
  { header: 'KPI cut', kind: 'money', width: 12, value: (l) => l.result.kpiCut },
  { header: 'No-show cut', kind: 'money', width: 12, value: (l) => l.result.noShowCut },
  { header: 'Overtime', kind: 'money', width: 12, value: (l) => l.result.overtime },
  { header: 'Bonus days', kind: 'days', width: 9, value: (l) => l.inputs.bonusDays },
  { header: 'Bonus', kind: 'money', width: 12, value: (l) => l.result.bonus },
  { header: 'Commission', kind: 'money', width: 12, value: (l) => l.result.commission },
  { header: 'Settlements', kind: 'money', width: 12, value: (l) => l.result.settlements },
  { header: 'Allowances', kind: 'money', width: 12, value: (l) => l.result.allowances },
  { header: 'Earned', kind: 'money', width: 14, value: (l) => l.result.earned },
  { header: 'Social insurance (employee)', kind: 'money', width: 14, value: (l) => l.result.employeeInsurance },
  { header: 'Income tax', kind: 'money', width: 12, value: (l) => l.result.monthlyTax },
  { header: "Martyrs' fund", kind: 'money', width: 11, value: (l) => l.result.martyrsFund },
  { header: 'Penalties', kind: 'money', width: 12, value: (l) => l.result.penaltyCut },
  { header: 'Net', kind: 'money', width: 14, value: (l) => l.result.net },
  { header: 'Released', kind: 'money', width: 12, value: (l) => l.result.released },
  { header: 'Transfer', kind: 'money', width: 14, value: (l) => l.result.transfer },
  { header: 'Bank file', kind: 'text', width: 9, value: (l) => (l.bankFile === 'cib' ? 'CIB' : l.bankFile === 'ach' ? 'ACH' : '—') },
  { header: 'On hold', kind: 'text', width: 8, value: (l) => (l.onHold ? 'Yes' : null) },
  { header: 'Company insurance', kind: 'money', width: 14, value: (l) => l.result.employerInsurance },
  { header: 'Company cost', kind: 'money', width: 14, value: (l) => l.result.companyCost },
  { header: 'Comments', kind: 'text', width: 40, value: (l) => l.comments },
];

const FORMATS: Record<Kind, string> = { text: '@', money: MONEY, percent: PERCENT, hours: HOURS, days: DAYS, count: '0' };

/** The column's letter, A … AP. */
function letter(n: number): string {
  let s = '';
  for (let i = n; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
  return s;
}

/** The register's title: "Payroll — September 2026", with DRAFT for a run not sent to the CEO yet. */
export const registerTitle = (run: Pick<RegisterRun, 'month' | 'status'>) => `Payroll — ${monthName(run.month)}${run.status === 'draft' ? ' — DRAFT' : ''}`;

const HEADER_ROW = 4;

/** The register as an .xlsx: a title and status, the headers (frozen with the names), the lines by department, the totals. */
export async function registerWorkbook(run: RegisterRun): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Payroll', { views: [{ state: 'frozen', xSplit: 4, ySplit: HEADER_ROW }] });
  REGISTER_COLUMNS.forEach((c, i) => (ws.getColumn(i + 1).width = c.width));

  ws.getCell('A1').value = registerTitle(run);
  ws.getCell('A1').font = { name: 'Calibri', size: 14, bold: true, ...(run.status === 'draft' && { color: { argb: 'FFC00000' } }) };
  ws.getCell('A2').value = `Status: ${PAYROLL_STATUS_LABELS[run.status]}${run.paidOn ? `, on ${shownDate(run.paidOn)}` : ''}`;
  ws.getCell('A2').font = { name: 'Calibri', size: 11, italic: true };

  const header = ws.getRow(HEADER_ROW);
  header.height = 32;
  REGISTER_COLUMNS.forEach((c, i) => {
    const cell = header.getCell(i + 1);
    cell.value = c.header;
    cell.font = { name: 'Calibri', size: 11, bold: true };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = { left: { style: 'thin' }, right: { style: 'thin' }, top: { style: 'thin' }, bottom: { style: 'thin' } };
  });

  // grouped by department (none last), then by name
  const lines = [...run.lines].sort((a, b) => byDepartment(a.department, b.department) || a.name.localeCompare(b.name));
  lines.forEach((line, i) => {
    const row = ws.getRow(HEADER_ROW + 1 + i);
    REGISTER_COLUMNS.forEach((c, j) => {
      const cell = row.getCell(j + 1);
      const value = c.value(line, i + 1);
      if (value !== null) cell.value = value;
      cell.numFmt = FORMATS[c.kind];
    });
  });

  // the totals: every amount summed, with its result already worked out
  const first = HEADER_ROW + 1;
  const last = HEADER_ROW + lines.length;
  const totals = ws.getRow(last + 1);
  totals.getCell(2).value = 'Total';
  totals.getCell(4).value = `${lines.length} employee${lines.length === 1 ? '' : 's'}`;
  REGISTER_COLUMNS.forEach((c, j) => {
    const cell = totals.getCell(j + 1);
    if (c.kind === 'money' && lines.length) {
      const sum = lines.reduce((cents, l) => cents + Math.round(Number(c.value(l, 0) ?? 0) * 100), 0) / 100;
      cell.value = { formula: `SUM(${letter(j + 1)}${first}:${letter(j + 1)}${last})`, result: sum };
      cell.numFmt = MONEY;
    }
    cell.font = { name: 'Calibri', size: 11, bold: true };
    cell.border = { top: { style: 'thin' }, bottom: { style: 'double' } };
  });

  return Buffer.from(await wb.xlsx.writeBuffer());
}
