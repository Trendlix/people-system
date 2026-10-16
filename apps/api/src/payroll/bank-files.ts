import ExcelJS from 'exceljs';
import { monthArabic, monthName, monthShort } from './months.js';

// The two bank files salaries are paid with (owner's decisions, 16 October 2026). The bank takes only its own layouts,
// so each is built cell by cell as the owner's files have them (measured from "CIB MAR 2026 Salaries Batch 2" and
// "ACH Salaries Batch MAR 2026"): sheet names, headers, which cells are text and which numbers, number formats, fonts,
// fills, borders and column widths. The totals are formulas, each with its result already worked out, so they show
// without recalculating.

type Sheet = ExcelJS.Worksheet;
type Cell = ExcelJS.Cell;

const CALIBRI = { name: 'Calibri', family: 2, scheme: 'minor' } as const;
const thin = { style: 'thin' } as const;
const hair = { style: 'hair' } as const;
const medium = { style: 'medium' } as const;
const ALL_THIN: Partial<ExcelJS.Borders> = { left: thin, right: thin, top: thin, bottom: thin };
const centred: Partial<ExcelJS.Alignment> = { horizontal: 'center', vertical: 'middle' };
const solid = (fgColor: Partial<ExcelJS.Color>): ExcelJS.Fill => ({ type: 'pattern', pattern: 'solid', fgColor, bgColor: { indexed: 64 } as Partial<ExcelJS.Color> });

/** The CIB file's colours: the header row's green, the amounts' orange, and black over the cells a row leaves empty. */
export const CIB_GREEN = 'FF92D050';
export const CIB_ORANGE = 'FFFFC000';
const BLACK: Partial<ExcelJS.Color> = { theme: 1 };

export const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Sets a cell's value and style in one go. */
function put(
  cell: Cell,
  value: ExcelJS.CellValue,
  style: { numFmt?: string; font?: Partial<ExcelJS.Font>; fill?: ExcelJS.Fill; alignment?: Partial<ExcelJS.Alignment>; border?: Partial<ExcelJS.Borders> },
) {
  if (value !== null && value !== undefined) cell.value = value;
  if (style.numFmt) cell.numFmt = style.numFmt;
  cell.font = style.font ?? { ...CALIBRI, size: 11 };
  if (style.fill) cell.fill = style.fill;
  if (style.alignment) cell.alignment = style.alignment;
  if (style.border) cell.border = style.border;
}

function widths(ws: Sheet, columns: Record<string, number>) {
  for (const [key, width] of Object.entries(columns)) ws.getColumn(key).width = width;
}

/** Amounts are summed in piasters, so the totals are exact. */
const total = (amounts: readonly number[]) => amounts.reduce((cents, a) => cents + Math.round(a * 100), 0) / 100;

/** A date as the CIB file writes it: text, month first (their March file made on 6 April reads 04/06/2026). */
export const cibDate = (ymd: string) => `${ymd.slice(5, 7)}/${ymd.slice(8, 10)}/${ymd.slice(0, 4)}`;

// ---------- CIB Payroll System ----------

export interface CibLine {
  /** The employee's 12-digit CIB account. */
  account: string;
  /** The account holder, as the bank has the name. */
  name: string;
  amount: number;
}

export interface CibFile {
  /** The day the file is made, and the day the bank pays it: YYYY-MM-DD. */
  fileDate: string;
  valueDate: string;
  /** The payroll month, YYYY-MM. */
  month: string;
  /** The company's CIB account the salaries are paid from (12 digits), and its name as CIB has it. */
  debitAccount: string;
  debitAccountName: string;
  lines: readonly CibLine[];
}

export const CIB_HEADERS = ['File_Date', 'Value_Date', 'Narrative', 'Currency', 'Creditor_BIC_Code', 'Account_Number', 'Account_Name', 'Debit_Amount', 'Credit_Amount'];
const CIB_HEADER_FORMATS = ['General', 'General', 'General', 'General', '@', '00000', '@', '#,##0.00', '#,##0.00'];
const CIB_BIC = 'CIBEEGCXXXX';

/**
 * CIB's payroll system file, sheet "Payroll": the headers, the company's debit (row 2), one credit row per employee,
 * and a check row (how many were paid, the debit and the credits' total). The account numbers are numbers, the dates
 * and names text.
 */
export async function cibWorkbook(f: CibFile): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Payroll', { views: [{ showGridLines: false, zoomScale: 110 }] });
  widths(ws, { A: 10.6640625, B: 12.1640625, C: 10.33203125, D: 9.6640625, E: 19.5, F: 30.6640625, G: 51.1640625, H: 15.5, I: 18.1640625, J: 3.6640625 });

  const header = ws.getRow(1);
  header.height = 17;
  CIB_HEADERS.forEach((text, i) => {
    put(header.getCell(i + 1), text, { numFmt: CIB_HEADER_FORMATS[i], font: { ...CALIBRI, size: 12, bold: true }, fill: solid({ argb: CIB_GREEN }), alignment: centred, border: ALL_THIN });
  });

  const first = 3;
  const check = first + f.lines.length; // the check row
  const last = check - 1;
  const credits = total(f.lines.map((l) => l.amount));
  const bold = { ...CALIBRI, size: 11, bold: true };

  const debit = ws.getRow(2);
  debit.height = 16;
  put(debit.getCell('A'), cibDate(f.fileDate), { numFmt: '@', font: bold, fill: solid({ argb: CIB_ORANGE }), alignment: centred, border: ALL_THIN });
  put(debit.getCell('B'), cibDate(f.valueDate), { numFmt: '@', font: bold, fill: solid({ argb: CIB_ORANGE }), alignment: centred, border: ALL_THIN });
  // the narrative is text, under the date format their template gives the column
  put(debit.getCell('C'), `${monthShort(f.month)} Salary`, { numFmt: 'mm-dd-yy', alignment: centred, border: ALL_THIN });
  put(debit.getCell('D'), 'egp', { numFmt: 'General', alignment: centred, border: ALL_THIN });
  put(debit.getCell('E'), null, { numFmt: '@', fill: solid(BLACK), alignment: centred, border: ALL_THIN });
  put(debit.getCell('F'), Number(f.debitAccount), { numFmt: '0', font: bold, alignment: centred, border: ALL_THIN });
  put(debit.getCell('G'), f.debitAccountName, { numFmt: '@', font: bold, alignment: centred, border: { left: thin, top: thin, bottom: thin } });
  put(debit.getCell('H'), { formula: `I${check}`, result: credits }, { numFmt: '#,##0.00', alignment: centred, border: { left: medium, right: medium, top: medium, bottom: medium } });
  put(debit.getCell('I'), null, { numFmt: '#,##0.00', fill: solid(BLACK), alignment: centred, border: { right: thin, top: thin, bottom: thin } });

  f.lines.forEach((line, i) => {
    const row = ws.getRow(first + i);
    put(row.getCell('E'), CIB_BIC, { numFmt: '@', alignment: centred, border: ALL_THIN });
    put(row.getCell('F'), Number(line.account), { numFmt: '0', alignment: centred, border: { left: hair, right: hair, top: hair, bottom: hair } });
    put(row.getCell('G'), line.name, { numFmt: 'General', alignment: { vertical: 'middle' }, border: { left: hair, right: hair, top: hair, bottom: hair } });
    put(row.getCell('H'), null, { numFmt: '#,##0.00', font: bold, fill: solid(BLACK), alignment: centred });
    put(row.getCell('I'), line.amount, { numFmt: '#,##0.00', font: bold, fill: solid({ argb: CIB_ORANGE }), alignment: centred, border: { right: thin, top: thin, bottom: thin } });
  });

  const totals = ws.getRow(check);
  put(totals.getCell('G'), { formula: `COUNTA(G${first}:G${last})`, result: f.lines.length }, { numFmt: 'General', fill: solid({ argb: CIB_ORANGE }), alignment: centred, border: ALL_THIN });
  put(totals.getCell('H'), { formula: 'H2', result: credits }, { numFmt: '#,##0.00', alignment: centred, border: { left: thin, right: thin, bottom: thin } });
  put(totals.getCell('I'), { formula: `SUM(I${first}:I${last})`, result: credits }, { numFmt: '#,##0.00', alignment: centred, border: ALL_THIN });

  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ---------- ACH ----------

export interface AchLine {
  /** The account holder, as the bank has the name. */
  name: string;
  /** The IBAN when there is one, else the account number. */
  account: string;
  /** The bank's short code on the EG-ACH list, e.g. QNB. */
  bankShort: string;
  amount: number;
}

export interface AchFile {
  month: string;
  /** TransactionPurpose (the settings': CASH). */
  purpose: string;
  lines: readonly AchLine[];
}

export const ACH_HEADERS = [
  'TransactionID',
  'CreditorName',
  'CreditorAccountNumber',
  'CreditorBank',
  'CreditorBankBranch',
  'TransactionAmount',
  'TransactionPurpose',
  'Comments',
  'ReceiverEmail',
  'SMSMobileNumber',
];
const ACH_HEADER_FORMATS = ['@', '@', '@', '@', '0', '0.00', '@', '@', '@', '@'];
/** Excel's accounting format, as the owner's file has the amounts. */
export const ACH_AMOUNT_FORMAT = '_(* #,##0.00_);_(* \\(#,##0.00\\);_(* "-"??_);_(@_)';

/**
 * The ACH file: one sheet named after the month in Arabic ("سبتمبر 2026"), the headers, then one row per employee with
 * borders on every column and no total. The transaction number, the account and the bank are text; the amount a number.
 */
export async function achWorkbook(f: AchFile): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(monthArabic(f.month), { views: [{ zoomScale: 115 }] });
  widths(ws, { A: 13.5, B: 45.1640625, C: 32.5, D: 12.5, E: 19.1640625, F: 19.33203125, G: 17.6640625, H: 50.5, I: 13.6640625, J: 20 });

  const header = ws.getRow(1);
  header.height = 15.75;
  ACH_HEADERS.forEach((text, i) => {
    put(header.getCell(i + 1), text, {
      numFmt: ACH_HEADER_FORMATS[i],
      font: { ...CALIBRI, size: 11, bold: true },
      alignment: { horizontal: i === 5 ? 'left' : 'center' },
      border: ALL_THIN,
    });
  });

  const comment = `${monthName(f.month)} Salary`;
  f.lines.forEach((line, i) => {
    const row = ws.getRow(2 + i);
    put(row.getCell('A'), String(i + 1), { numFmt: '@', font: { name: 'Arial', family: 2, size: 11 }, alignment: { horizontal: 'center' }, border: ALL_THIN });
    put(row.getCell('B'), line.name, { numFmt: '@', alignment: centred, border: ALL_THIN });
    put(row.getCell('C'), line.account, { numFmt: '@', alignment: centred, border: ALL_THIN });
    put(row.getCell('D'), line.bankShort, { numFmt: '@', alignment: centred, border: ALL_THIN });
    put(row.getCell('E'), null, { border: ALL_THIN });
    put(row.getCell('F'), line.amount, { numFmt: ACH_AMOUNT_FORMAT, border: ALL_THIN });
    put(row.getCell('G'), f.purpose, { numFmt: '@', border: ALL_THIN });
    put(row.getCell('H'), comment, { numFmt: '@', border: ALL_THIN });
    put(row.getCell('I'), null, { border: ALL_THIN });
    put(row.getCell('J'), null, { border: ALL_THIN });
  });

  return Buffer.from(await wb.xlsx.writeBuffer());
}
