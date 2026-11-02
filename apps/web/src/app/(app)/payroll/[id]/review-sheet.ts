import ExcelJS from 'exceljs';
import { PAYROLL_STATUS_LABELS } from '@trendlix/shared';
import { shownCode } from '@/lib/hidden';
import { groupByPlace, peopleCount, placeOrder, showsDepartment, type PlaceRef } from '@/lib/place-groups';
import type { PayrollLineView, PayrollRunView, PayrollTotals } from '@/lib/types';
import { runTitle } from '../list';
import { hiddenRowLabel } from './access';
import { breakdown, cutsMark, payCuts, waivedByCeo } from './breakdown';

// The run's Pay table as a spreadsheet to review (owner, 2 November 2026: "i want to export this to review as a super
// admin only"): what the run page's Pay shows, as the caller sees it. The first sheet is the table: departments, then
// their teams, in Organization's order, each line's eight amounts (what is taken off as a minus, as on the page), its
// marks, and a blank Notes column for the review; the C-level row hidden from the caller, then the totals. The second
// sheet is every line's breakdown, as "Open every breakdown" shows it, with its warnings and comments. Made on the web
// from the same functions as the page, so the file reads as the screen does.

export const REVIEW_COLUMNS = ['Employee', 'ID', 'Job title', 'Marks', 'Earned', 'Allowances', 'Social Ins.', 'Tax', 'Martyrs’', 'Deductions', 'Net', 'Transfer', 'Notes'] as const;

const FONT = 'Calibri';
const MONEY = '#,##0.00;-#,##0.00';
const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } };
const GROUP_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } };
const CUT_COLOR = { argb: 'FFC00000' };
const MUTED = { argb: 'FF666666' };

type Amounts = Pick<PayrollTotals, 'earned' | 'allowances' | 'employeeInsurance' | 'monthlyTax' | 'martyrsFund' | 'deductions' | 'net' | 'transfer'>;

/** The eight amounts in the table's order: what is taken off as a minus, as the page says "−EGP 1,837.00". */
export function reviewAmounts(v: Amounts): number[] {
  const cut = (n: number) => (n === 0 ? 0 : -Math.abs(n));
  return [v.earned, v.allowances, cut(v.employeeInsurance), cut(v.monthlyTax), cut(v.martyrsFund), cut(v.deductions), v.net, v.transfer];
}

/** A line's marks, as its row shows them: C-level, on hold, waived by the CEO, warnings, and its deductions mark. */
export function reviewMarks(l: PayrollLineView): string {
  const warnings = l.result.warnings.length;
  return [
    l.confidential && 'C-level',
    l.onHold && 'On hold',
    waivedByCeo(l) && 'Waived by the CEO',
    warnings > 0 && `${warnings} ${warnings === 1 ? 'warning' : 'warnings'}`,
    cutsMark(payCuts(l.result)).text,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** The file's name: "November 2026 Payroll (draft) - review.xlsx". */
export const reviewFileName = (run: Pick<PayrollRunView, 'month' | 'status'>) => `${runTitle(run.month)}${run.status === 'draft' ? ' (draft)' : ''} - review.xlsx`;

/** The workbook, `exportedOn` saying when (Cairo's date and time, as words). */
export async function reviewWorkbook(run: PayrollRunView, places: readonly PlaceRef[], exportedOn: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Trendlix People';
  const groups = groupByPlace(run.lines, (l) => l.department, placeOrder(places));
  const ordered = groups.flatMap((g) => g.teams.flatMap((t) => t.rows));
  const status = PAYROLL_STATUS_LABELS[run.status] ?? run.status;
  const title = `${runTitle(run.month)} — for review`;
  const about = `${status} · exported ${exportedOn} · as the run's Pay shows it`;

  // ---------- the table ----------
  const pay = wb.addWorksheet('Pay', { views: [{ state: 'frozen', xSplit: 1, ySplit: 4 }] });
  const last = REVIEW_COLUMNS.length;
  pay.columns = [{ width: 34 }, { width: 11 }, { width: 26 }, { width: 34 }, ...Array.from({ length: 8 }, () => ({ width: 14 })), { width: 40 }];
  pay.getCell('A1').value = title;
  pay.getCell('A1').font = { name: FONT, size: 14, bold: true, ...(run.status === 'draft' && { color: CUT_COLOR }) };
  pay.getCell('A2').value = about;
  pay.getCell('A2').font = { name: FONT, size: 11, italic: true, color: MUTED };
  const header = pay.getRow(4);
  REVIEW_COLUMNS.forEach((h, i) => {
    const cell = header.getCell(i + 1);
    cell.value = i >= 4 && i < 12 ? `${h} (EGP)` : h;
    cell.font = { name: FONT, size: 11, bold: true };
    cell.fill = HEADER_FILL;
    cell.alignment = { vertical: 'middle', horizontal: i >= 4 && i < 12 ? 'right' : 'left', wrapText: true };
  });

  const heading = (text: string, level: 'department' | 'team') => {
    const row = pay.addRow([level === 'team' ? `   ${text}` : text]);
    pay.mergeCells(row.number, 1, row.number, last);
    row.getCell(1).font = { name: FONT, size: 11, bold: level === 'department', italic: level === 'team' };
    row.getCell(1).fill = GROUP_FILL;
  };
  const amounts = (row: ExcelJS.Row, v: Amounts, bold = false) => {
    reviewAmounts(v).forEach((n, i) => {
      const cell = row.getCell(5 + i);
      cell.value = n;
      cell.numFmt = MONEY;
      cell.font = { name: FONT, size: 11, bold, ...(n < 0 && { color: CUT_COLOR }) };
    });
  };

  for (const g of groups) {
    if (showsDepartment(groups, g)) heading(`${g.department ?? 'No department'} · ${peopleCount(g.count)}`, 'department');
    for (const t of g.teams) {
      if (t.team !== null) heading(`${t.team} · ${peopleCount(t.rows.length)}`, 'team');
      for (const l of t.rows) {
        const row = pay.addRow([l.name, shownCode(l.employeeCode) ?? '', l.jobTitle ?? '', reviewMarks(l)]);
        [1, 2, 3, 4].forEach((c) => (row.getCell(c).font = { name: FONT, size: 11 }));
        row.getCell(4).alignment = { wrapText: true, vertical: 'top' };
        amounts(row, l.result);
        row.getCell(last).font = { name: FONT, size: 11 };
      }
    }
  }
  const hidden = hiddenRowLabel(run);
  if (hidden) {
    const row = pay.addRow([hidden]);
    row.getCell(1).font = { name: FONT, size: 11, italic: true, color: MUTED };
  }
  const total = pay.addRow([`Total · ${peopleCount(run.totals.employees)}`]);
  total.getCell(1).font = { name: FONT, size: 11, bold: true };
  amounts(total, run.totals, true);
  total.eachCell({ includeEmpty: true }, (cell) => (cell.border = { top: { style: 'thin' } }));

  // ---------- every line's breakdown ----------
  const steps = wb.addWorksheet('Breakdowns', { views: [{ state: 'frozen', ySplit: 2 }] });
  steps.columns = [{ width: 44 }, { width: 22 }, { width: 70 }];
  steps.getCell('A1').value = `${title}: every breakdown`;
  steps.getCell('A1').font = { name: FONT, size: 14, bold: true, ...(run.status === 'draft' && { color: CUT_COLOR }) };
  steps.getCell('A2').value = about;
  steps.getCell('A2').font = { name: FONT, size: 11, italic: true, color: MUTED };
  for (const l of ordered) {
    steps.addRow([]);
    const who = steps.addRow([[l.name, shownCode(l.employeeCode), l.department].filter(Boolean).join(' · ')]);
    steps.mergeCells(who.number, 1, who.number, 3);
    who.getCell(1).font = { name: FONT, size: 12, bold: true };
    who.getCell(1).fill = GROUP_FILL;
    const marks = reviewMarks(l);
    if (marks) steps.addRow([marks]).getCell(1).font = { name: FONT, size: 10, italic: true, color: MUTED };
    for (const w of l.result.warnings) {
      const row = steps.addRow([`Warning: ${w}`]);
      steps.mergeCells(row.number, 1, row.number, 3);
      row.getCell(1).font = { name: FONT, size: 11, color: { argb: 'FF9C5700' } };
      row.getCell(1).alignment = { wrapText: true };
    }
    for (const s of breakdown(l, run.rules, run.lawRates, run.month)) {
      const row = steps.addRow([s.label, s.value, s.note ?? '']);
      row.getCell(1).font = { name: FONT, size: 11, bold: s.kind === 'total', ...(s.kind === 'info' && { color: MUTED }) };
      row.getCell(2).font = { name: FONT, size: 11, bold: s.kind === 'total', ...(s.kind === 'cut' && { color: CUT_COLOR }), ...(s.kind === 'info' && { color: MUTED }) };
      row.getCell(2).alignment = { horizontal: 'right' };
      row.getCell(3).font = { name: FONT, size: 10, color: MUTED };
      row.getCell(3).alignment = { wrapText: true, vertical: 'top' };
      if (s.kind === 'total') row.getCell(2).border = { top: { style: 'thin' } };
    }
    if (l.comments) {
      const row = steps.addRow([`Comments: ${l.comments}`]);
      steps.mergeCells(row.number, 1, row.number, 3);
      row.getCell(1).font = { name: FONT, size: 11 };
      row.getCell(1).alignment = { wrapText: true };
    }
  }
  if (hidden) {
    steps.addRow([]);
    steps.addRow([hidden]).getCell(1).font = { name: FONT, size: 11, italic: true, color: MUTED };
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}
