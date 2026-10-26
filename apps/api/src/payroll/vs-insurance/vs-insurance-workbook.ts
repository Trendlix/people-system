import ExcelJS from 'exceljs';
import {
  confidentialExcludedNote,
  LABELS,
  PAY_BASIS_LABELS,
  VS_INSURANCE_DIFFERENCE_KEYS,
  VS_INSURANCE_DIFFERENCE_SIGN,
  VS_INSURANCE_FIGURE_KEYS,
  VS_INSURANCE_FIGURE_LABELS,
  VS_INSURANCE_STANDING_LABELS,
  vsInsuranceCountsText,
  vsInsuranceGroups,
  vsInsurancePlace,
  vsInsuranceRulesText,
  vsInsuranceStatusText,
  vsInsuranceTotals,
  type PayrollVsInsurance,
  type ReportPeriod,
  type VsInsuranceCycle,
  type VsInsuranceRow,
  type VsInsuranceTotals,
} from '@trendlix/shared';
import { dayInCairo, shownDate } from '../../common/date-only.js';
import { addSheet, type Column } from '../../employees/missing-workbook.js';
import { monthName } from '../months.js';

// The Payroll vs Social Insurance report as an Excel workbook (owner, 26 October 2026: "a comparison report between the
// actual payroll run and the social insurance data"), for HR, Finance and the CEO to work with outside the system. Three
// sheets: "Comparison", as on screen: one row per employee and month with the three blocks (the actual run, the SI cycle,
// the differences), the departments and teams as rows of their own with their subtotals and the grand total at the end,
// and under it the period, each run's status and rules, the counts and when it was made; "Actual run", A in full, one row
// per line; "SI cycle", B in full, one row per registered line. Money as numbers with two decimals, the headings bold and
// frozen, the columns' widths fitted to what they hold. Written with the Leave report's and the Missing Details workbook's
// helpers.

const MONEY = '#,##0.00';
const THIN = { style: 'thin' } as const;

/** The name the workbook is saved under, with its period: "Payroll vs social insurance 2026-09.xlsx", or "… 2026-01 to 2026-03.xlsx". */
export const vsInsuranceFileName = (p: ReportPeriod) => (p.from === p.to ? `Payroll vs social insurance ${p.from}.xlsx` : `Payroll vs social insurance ${p.from} to ${p.to}.xlsx`);

/** The time in Cairo, 24-hour: "14:05". */
const cairoTime = (moment: Date) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(moment);

const statusText = (r: Pick<VsInsuranceRow, 'status'>) => vsInsuranceStatusText(r.status);
const standingText = (r: Pick<VsInsuranceRow, 'standing'>) => VS_INSURANCE_STANDING_LABELS[r.standing] ?? r.standing;
const labelOf = (labels: Readonly<Record<string, string>>, value: string) => labels[value] ?? value;

/** Who a line is, in the first columns of every sheet. */
const WHO: readonly Column<VsInsuranceRow>[] = [
  { header: 'Employee code', width: 13, value: (r) => r.employee.employeeCode },
  { header: 'Employee name (English)', width: 24, value: (r) => r.employee.fullNameEn },
  { header: 'Department', width: 14, value: (r) => vsInsurancePlace(r.department).department },
  { header: 'Team', width: 10, value: (r) => vsInsurancePlace(r.department).team },
  { header: 'Month', width: 15, value: (r) => monthName(r.month) },
  { header: 'Run status', width: 16, value: statusText },
  { header: 'Standing', width: 20, value: standingText },
];

/** A cycle's columns in full, for the "Actual run" and "SI cycle" sheets; `pick` says which cycle of the row. */
function cycleColumns(pick: (r: VsInsuranceRow) => VsInsuranceCycle): Column<VsInsuranceRow>[] {
  const money = (header: string, value: (c: VsInsuranceCycle) => number): Column<VsInsuranceRow> => ({ header, width: 15, value: (r) => value(pick(r)), numFmt: MONEY });
  return [
    { header: 'Employment type', width: 15, value: (r) => labelOf(LABELS.employmentType, r.employmentType) },
    { header: 'Pay basis', width: 10, value: (r) => labelOf(PAY_BASIS_LABELS, r.payBasis) },
    { header: 'On hold', width: 8, value: (r) => (r.onHold ? 'Yes' : 'No') },
    { header: 'Days paid', width: 10, value: (r) => pick(r).paidDays, numFmt: 'General' },
    ...VS_INSURANCE_FIGURE_KEYS.map((k) => money(VS_INSURANCE_FIGURE_LABELS[k], (c) => c[k])),
    money('Attendance cut', (c) => c.attendanceCut),
    money('KPI cut', (c) => c.kpiCut),
    money('No-show cut', (c) => c.noShowCut),
    money('Unpaid leave cut', (c) => c.unpaidLeaveCut),
    money('Bonus (days)', (c) => c.bonus),
    money('Penalty (days)', (c) => c.penaltyCut),
    money('Additions (taxed)', (c) => c.additionsTaxed),
    money('Additions (untaxed)', (c) => c.additionsUntaxed),
    money('Other deductions', (c) => c.adjustmentDeductions),
    money('Deductions before tax', (c) => c.beforeTaxDeductions),
    money('Released', (c) => c.released),
    money('Transfer', (c) => c.transfer),
    { header: 'Notes', width: 40, value: (r) => pick(r).warnings.join(' · ') || null, wrap: true },
  ];
}

/** How wide a value reads: money by its digits, with the separators. */
const textWidth = (v: string | number | Date | null) => (v === null ? 0 : typeof v === 'number' ? v.toLocaleString('en-US', { minimumFractionDigits: 2 }).length : v instanceof Date ? 10 : String(v).length);

/** The columns with their widths fitted to the header and the values, from each column's own width up to 48. */
function fitted<T>(columns: readonly Column<T>[], rows: readonly T[]): Column<T>[] {
  return columns.map((c) => ({ ...c, width: Math.min(48, Math.max(c.width, c.header.length + 2, ...rows.map((r) => textWidth(c.value(r)) + 2))) }));
}

/** A line of the Comparison sheet: a group's heading, a row, a subtotal or the grand total. */
type Line =
  | { kind: 'heading'; text: string; level: 'department' | 'team' }
  | { kind: 'row'; row: VsInsuranceRow }
  | { kind: 'total'; text: string; totals: VsInsuranceTotals; grand: boolean };

/** The comparison's lines: each department (its own people, then its teams), the subtotals, and the grand total. */
export function comparisonLines(report: Pick<PayrollVsInsurance, 'rows'>): Line[] {
  const lines: Line[] = [];
  for (const d of vsInsuranceGroups(report.rows)) {
    const name = d.department ?? 'No department';
    lines.push({ kind: 'heading', text: name, level: 'department' });
    for (const t of d.teams) {
      if (t.team !== null) lines.push({ kind: 'heading', text: `${name} › ${t.team}`, level: 'team' });
      for (const row of t.rows) lines.push({ kind: 'row', row });
      if (t.team !== null) lines.push({ kind: 'total', text: `Total · ${t.team}`, totals: t.totals, grand: false });
    }
    lines.push({ kind: 'total', text: `Total · ${name}`, totals: d.totals, grand: false });
  }
  lines.push({ kind: 'total', text: 'Total · everyone', totals: vsInsuranceTotals(report.rows), grand: true });
  return lines;
}

/** The Comparison sheet's headings: who, then the three blocks, each column saying which block it is in. */
export const COMPARISON_HEADS: readonly string[] = [
  ...WHO.map((c) => c.header),
  ...VS_INSURANCE_FIGURE_KEYS.map((k) => `Actual: ${VS_INSURANCE_FIGURE_LABELS[k]}`),
  ...VS_INSURANCE_FIGURE_KEYS.map((k) => `SI cycle: ${VS_INSURANCE_FIGURE_LABELS[k]}`),
  ...VS_INSURANCE_DIFFERENCE_KEYS.map((k) => `Difference: ${VS_INSURANCE_FIGURE_LABELS[k]} (${VS_INSURANCE_DIFFERENCE_SIGN})`),
];

/** The report as an .xlsx: "Comparison" (the groups as rows), "Actual run" (A in full), "SI cycle" (B in full). */
export async function vsInsuranceWorkbook(report: PayrollVsInsurance & { generatedAt: string; confidentialExcluded: number }): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Comparison', { views: [{ state: 'frozen', xSplit: 2, ySplit: 1 }] });
  const heads = COMPARISON_HEADS;
  const lines = comparisonLines(report);
  const who = WHO.length;
  const cells = (line: Line): (string | number | null)[] => {
    if (line.kind === 'heading') return [line.text];
    if (line.kind === 'row') {
      const r = line.row;
      return [
        ...WHO.map((c) => c.value(r) as string | null),
        ...VS_INSURANCE_FIGURE_KEYS.map((k) => r.actual[k]),
        ...VS_INSURANCE_FIGURE_KEYS.map((k) => (r.insurance ? r.insurance[k] : null)),
        ...VS_INSURANCE_DIFFERENCE_KEYS.map((k) => (r.difference ? r.difference[k] : null)),
      ];
    }
    const t = line.totals;
    return [
      line.text,
      ...Array<null>(who - 1).fill(null),
      ...VS_INSURANCE_FIGURE_KEYS.map((k) => t.actual[k]),
      ...VS_INSURANCE_FIGURE_KEYS.map((k) => t.insurance[k]),
      ...VS_INSURANCE_DIFFERENCE_KEYS.map((k) => t.difference[k]),
    ];
  };

  // the widths fitted to the headings and the values
  const width = heads.map((h, i) => Math.min(48, Math.max(i === 1 ? 24 : i === 0 ? 13 : 12, h.length + 2, ...lines.map((l) => (l.kind === 'heading' ? 0 : textWidth(cells(l)[i] ?? null) + 2)))));
  width.forEach((w, i) => (sheet.getColumn(i + 1).width = w));

  const header = sheet.getRow(1);
  heads.forEach((h, i) => {
    const cell = header.getCell(i + 1);
    cell.value = h;
    cell.font = { name: 'Calibri', size: 11, bold: true };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: i < who ? 'FFD9E1F2' : i < who + VS_INSURANCE_FIGURE_KEYS.length ? 'FFE2EFDA' : i < who + 2 * VS_INSURANCE_FIGURE_KEYS.length ? 'FFFFF2CC' : 'FFFCE4D6' } };
    cell.alignment = { vertical: 'middle', wrapText: true };
    cell.border = { left: THIN, right: THIN, top: THIN, bottom: THIN };
  });

  lines.forEach((line, n) => {
    const row = sheet.getRow(n + 2);
    cells(line).forEach((value, i) => {
      const cell = row.getCell(i + 1);
      if (value !== null) cell.value = value;
      // the figures are numbers, who and the words text
      cell.numFmt = i >= who && line.kind !== 'heading' ? MONEY : '@';
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

  // under the table: the period, each run and its rules, what is counted, the C-level people left out if any, and when it was made
  const made = new Date(report.generatedAt);
  const excluded = confidentialExcludedNote(report.confidentialExcluded);
  const notes: [string, string][] = [
    ['Period', report.period.from === report.period.to ? monthName(report.period.from) : `${monthName(report.period.from)} to ${monthName(report.period.to)}`],
    ...report.runs.map((r): [string, string] => [`Run · ${monthName(r.month)}`, `${vsInsuranceStatusText(r.status)}. ${vsInsuranceRulesText(r)}`]),
    ...(report.runs.length ? [] : [['Runs', 'No payroll run in this period'] as [string, string]]),
    ['Counted', vsInsuranceCountsText(report.totals)],
    ['Differences', `${VS_INSURANCE_DIFFERENCE_SIGN}: a figure below 0 means the SI cycle pays or costs less than the actual run`],
    ['SI cycle', 'The same engine on the registered insured wage: no allowances, no amount-based additions; the same days, attendance, leave, bonus and penalty days and deductions'],
    ...(excluded ? [['C-level people left out', excluded] as [string, string]] : []),
    ['Made on', `${shownDate(dayInCairo(made))} ${cairoTime(made)} (Cairo)`],
  ];
  notes.forEach(([item, value], i) => {
    const row = sheet.getRow(lines.length + 3 + i);
    row.getCell(1).value = item;
    row.getCell(1).font = { name: 'Calibri', size: 11, bold: true };
    row.getCell(2).value = value;
  });

  const actualColumns = [...WHO, ...cycleColumns((r) => r.actual)];
  addSheet(wb, 'Actual run', fitted(actualColumns, report.rows), report.rows);
  const registered = report.rows.filter((r) => r.insurance !== null);
  const insuranceColumns = [...WHO, ...cycleColumns((r) => r.insurance!)];
  addSheet(wb, 'SI cycle', fitted(insuranceColumns, registered), registered);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
