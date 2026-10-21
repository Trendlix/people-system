import ExcelJS from 'exceljs';
import {
  headingKey,
  importDate,
  importNumber,
  isZohoLeaveHeadings,
  LEAVE_IMPORT_MAX_MB,
  LEAVE_IMPORT_MAX_ROWS,
  LEAVE_IMPORT_SHEETS,
  ZOHO_LEAVE_COLUMNS,
  zohoApproval,
  zohoEmployee,
  zohoLeaveDays,
  type LeaveImportSource,
  type ZohoApproval,
  type ZohoLeaveColumn,
  type ZohoLeaveDay,
} from '@trendlix/shared';
import { cellText, tidyText, type RawCell } from '../payroll/holidays-import.js';
import { readZip, ZipError, type ZipLimits, type ZipProblem } from '../templates/zip.js';

// Reading a leave file (owner, 21 October 2026: "how to import bulk leaves?"; "Our Excel template", and Zoho People's
// leave export as it is): the file checked as an uploaded workbook is (its zip's size and parts, as holidays-import.ts
// does), told apart by its headings (Zoho's Leave type, Approval Status and ZOHO_LINK_ID; else the template's sheets
// Leaves taken and Balances), each row read into plain values: the person's code and name (Zoho's "<name> <number>"), the
// type as written, the days, the figure and the dates (Excel dates, DD/MM/YYYY, YYYY-MM-DD or Zoho's 21-Oct-2026). Pure
// of the database: the review checks the rows (leave-import.service.ts) by packages/shared leave-import.ts.

export const LEAVE_IMPORT_MAX_BYTES = LEAVE_IMPORT_MAX_MB * 1024 * 1024;

/** A whole file refused, in words HR act on (the service answers it as a 400). */
export class LeaveImportFileError extends Error {}

export const CHOOSE_LEAVE_FILE = 'Choose the file to import: the leave template filled in, or Zoho People’s leave export, as an Excel workbook (.xlsx).';
export const LEAVE_FILE_TOO_LARGE = `The file must be ${LEAVE_IMPORT_MAX_MB} MB or smaller.`;
const NOT_A_WORKBOOK = 'This file isn’t an Excel workbook (.xlsx). Fill in the leave template, or export the leave from Zoho People as Excel (XLSX), and upload that.';
const OLD_OR_PROTECTED = 'This is an old Excel file (.xls) or one protected by a password. Remove any password, save it as an Excel workbook (.xlsx) and upload it again.';
const DAMAGED = 'This Excel file is damaged. Open it in Excel, save it again as an Excel workbook (.xlsx) and upload it again.';
const NO_HEADINGS = `The file has neither the template’s sheets (${LEAVE_IMPORT_SHEETS.leaves}, ${LEAVE_IMPORT_SHEETS.balances}) with their headings nor Zoho People’s leave export headings (Employee ID, Leave type, From, To, Approval Status). Download the template, fill it in and upload it, or upload Zoho’s export as it is.`;
const NO_ROWS = 'The file has no leave or balances under its headings. Add a row for each and upload it again.';
const TOO_MANY_ROWS = `The file has more than ${LEAVE_IMPORT_MAX_ROWS.toLocaleString('en-US')} rows. Import at most ${LEAVE_IMPORT_MAX_ROWS.toLocaleString('en-US')} at a time.`;

const ZIP_LIMITS: ZipLimits = { maxBytes: LEAVE_IMPORT_MAX_BYTES, maxEntries: 500, maxExpandedBytes: 60 * 1024 * 1024 };

const ZIP_MESSAGES: Record<ZipProblem, string> = {
  not_zip: NOT_A_WORKBOOK,
  encrypted: OLD_OR_PROTECTED,
  zip64: LEAVE_FILE_TOO_LARGE,
  too_large: LEAVE_FILE_TOO_LARGE,
  too_many_entries: 'This workbook has too many parts for a leave file. Copy the rows into the template and upload that.',
  expands_too_much: 'This workbook is too large for a leave file. Copy the rows into the template and upload that.',
  unsupported_method: 'This file wasn’t saved as Excel saves it. Open it in Excel, save it as an Excel workbook (.xlsx) and upload it again.',
  damaged: DAMAGED,
};

const OLE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

/** A row of Leaves taken (or of Zoho's export) as read: plain values, nothing checked against the system yet. */
export interface ReadLeaveRow {
  sheet: 'leaves';
  /** Its number in the sheet, as Excel shows it. */
  row: number;
  code: string | null;
  name: string;
  /** Zoho's number ending the Employee ID: their Zoho Employee Id. */
  zohoId: string | null;
  /** A number inside Zoho's Employee ID that doesn't end it ("<name> 10023 - …"): shown, not matched by. */
  zohoHint: string | null;
  typeText: string;
  from: string | null;
  fromText: string;
  to: string | null;
  toText: string;
  /** The days the file gives (the template's Days, Zoho's day details, else its Days/Hours Taken). */
  fileDays: number | null;
  daysText: string;
  notes: string | null;
  /** Zoho's own: the row's ZOHO_LINK_ID, its Approval Status, its Unit and each day's duration. */
  linkId: string | null;
  approval: ZohoApproval | null;
  approvalText: string | null;
  unit: string | null;
  details: ZohoLeaveDay[] | null;
}

/** A row of Balances as read. */
export interface ReadBalanceRow {
  sheet: 'balances';
  row: number;
  code: string | null;
  name: string;
  typeText: string;
  balance: number | null;
  balanceText: string;
  asOf: string | null;
  asOfText: string;
}

export interface LeaveFileReading {
  source: LeaveImportSource;
  leaves: ReadLeaveRow[];
  balances: ReadBalanceRow[];
}

/** Text of a cell, tidied; '' when empty or "-". */
const textOf = (value: RawCell) => {
  const t = tidyText(cellText(value));
  return t === '-' ? '' : t;
};
const orNull = (t: string) => (t ? t : null);

const DAY_MS = 86_400_000;
const EXCEL_EPOCH = Date.UTC(1899, 11, 30);
const EXCEL_1904_EPOCH = Date.UTC(1904, 0, 1);

/** A cell as a day: an Excel date (or its serial number, 2000 to 2100), else its text read as one (importDate). */
function cellDate(value: RawCell, date1904: boolean): { date: string | null; text: string } {
  if (value !== null && typeof value === 'object' && !(value instanceof Date) && 'result' in value) return cellDate(value.result as RawCell, date1904);
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return { date: null, text: '' };
    return { date: new Date(Math.floor(value.getTime() / DAY_MS) * DAY_MS).toISOString().slice(0, 10), text: value.toISOString().slice(0, 10) };
  }
  if (typeof value === 'number') {
    const date = new Date((date1904 ? EXCEL_1904_EPOCH : EXCEL_EPOCH) + Math.floor(value) * DAY_MS).toISOString().slice(0, 10);
    const year = Number(date.slice(0, 4));
    return year >= 2000 && year <= 2100 ? { date, text: String(value) } : { date: null, text: String(value) };
  }
  const text = textOf(value);
  return { date: text ? importDate(text) : null, text };
}

/** A cell as a number: a number, or its text read as one (importNumber). */
function cellNumber(value: RawCell): { n: number | null; text: string } {
  if (value !== null && typeof value === 'object' && !(value instanceof Date) && 'result' in value) return cellNumber(value.result as RawCell);
  if (typeof value === 'number') return { n: Number.isFinite(value) ? value : null, text: String(value) };
  const text = textOf(value);
  return { n: text ? importNumber(text) : null, text };
}

type Rows = { n: number; cells: RawCell[] }[];

function sheetRows(ws: ExcelJS.Worksheet): Rows {
  const rows: Rows = [];
  ws.eachRow({ includeEmpty: false }, (row, n) => rows.push({ n, cells: (row.values as RawCell[]).slice(1) }));
  return rows;
}

/** The columns of a heading row: each known heading's index, the first of each. */
function columnsOf<C extends string>(cells: readonly RawCell[], headings: Record<C, readonly string[]>): Partial<Record<C, number>> {
  const found: Partial<Record<C, number>> = {};
  cells.forEach((cell, i) => {
    const key = headingKey(textOf(cell));
    const column = (Object.keys(headings) as C[]).find((c) => headings[c].includes(key));
    if (column && found[column] === undefined) found[column] = i;
  });
  return found;
}

const LEAVE_COLUMNS = {
  code: ['employeecode', 'code', 'employeeno', 'employeenumber'],
  name: ['employeename', 'name', 'employee'],
  type: ['leavetype', 'type'],
  from: ['from', 'fromdate', 'firstday', 'startdate'],
  to: ['to', 'todate', 'lastday', 'enddate'],
  days: ['days', 'daystaken'],
  notes: ['notes', 'note', 'reason'],
} as const;
type LeaveColumn = keyof typeof LEAVE_COLUMNS;

const BALANCE_COLUMNS = {
  code: ['employeecode', 'code', 'employeeno', 'employeenumber'],
  name: ['employeename', 'name', 'employee'],
  type: ['leavetype', 'type'],
  balance: ['balanceindays', 'balance', 'days'],
  asOf: ['asof', 'asofdate', 'date'],
} as const;
type BalanceColumn = keyof typeof BALANCE_COLUMNS;

/** The heading row among a sheet's first rows that has `needed`, and its columns. */
function headingRow<C extends string>(rows: Rows, headings: Record<C, readonly string[]>, needed: (c: Partial<Record<C, number>>) => boolean) {
  const at = rows.slice(0, 10).findIndex((r) => needed(columnsOf(r.cells, headings)));
  return at < 0 ? null : { at, columns: columnsOf(rows[at].cells, headings) };
}

/** The workbook loaded, after its zip was checked. Throws LeaveImportFileError. */
async function loadWorkbook(data: Buffer): Promise<ExcelJS.Workbook> {
  if (!data.length) throw new LeaveImportFileError(CHOOSE_LEAVE_FILE);
  if (data.subarray(0, OLE.length).equals(OLE)) throw new LeaveImportFileError(OLD_OR_PROTECTED);
  if (!data.subarray(0, ZIP.length).equals(ZIP)) throw new LeaveImportFileError(NOT_A_WORKBOOK);
  try {
    const zip = readZip(data, ZIP_LIMITS);
    if (!zip.has('[Content_Types].xml') || !zip.has('xl/workbook.xml')) throw new LeaveImportFileError(NOT_A_WORKBOOK);
    for (const entry of zip.entries) zip.read(entry.name);
  } catch (err) {
    if (err instanceof ZipError) throw new LeaveImportFileError(ZIP_MESSAGES[err.problem]);
    throw err;
  }
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(data as unknown as ArrayBuffer);
  } catch {
    throw new LeaveImportFileError(DAMAGED);
  }
  return wb;
}

/**
 * The file's rows: Zoho People's leave export when a sheet has its headings (its first visible one), else the
 * template's Leaves taken and Balances (by their names, else any sheet with their headings). Blank rows are left out.
 */
export async function readLeaveFile(data: Buffer): Promise<LeaveFileReading> {
  const wb = await loadWorkbook(data);
  const date1904 = wb.properties.date1904 === true;
  const sheets = wb.worksheets.filter((s) => s.state === 'visible');
  const all = sheets.length ? sheets : wb.worksheets;

  for (const ws of all) {
    const rows = sheetRows(ws);
    const at = rows.slice(0, 5).findIndex((r) => isZohoLeaveHeadings(r.cells.map((c) => textOf(c))));
    if (at >= 0) return { source: 'zoho', leaves: zohoRows(rows, at, date1904), balances: [] };
  }

  const named = (name: string) => all.find((s) => headingKey(s.name) === headingKey(name));
  const leaveSheet = named(LEAVE_IMPORT_SHEETS.leaves) ?? all.find((s) => headingRow(sheetRows(s), LEAVE_COLUMNS, leaveNeeds));
  const balanceSheet = named(LEAVE_IMPORT_SHEETS.balances) ?? all.find((s) => s !== leaveSheet && headingRow(sheetRows(s), BALANCE_COLUMNS, balanceNeeds));
  const leaves = leaveSheet ? templateLeaveRows(sheetRows(leaveSheet), date1904) : null;
  const balances = balanceSheet ? templateBalanceRows(sheetRows(balanceSheet), date1904) : null;
  if (!leaves && !balances) throw new LeaveImportFileError(NO_HEADINGS);
  if (!leaves?.length && !balances?.length) throw new LeaveImportFileError(NO_ROWS);
  if ((leaves?.length ?? 0) + (balances?.length ?? 0) > LEAVE_IMPORT_MAX_ROWS) throw new LeaveImportFileError(TOO_MANY_ROWS);
  return { source: 'template', leaves: leaves ?? [], balances: balances ?? [] };
}

const leaveNeeds = (c: Partial<Record<LeaveColumn, number>>) => (c.code !== undefined || c.name !== undefined) && c.type !== undefined && c.from !== undefined && c.to !== undefined;
const balanceNeeds = (c: Partial<Record<BalanceColumn, number>>) => (c.code !== undefined || c.name !== undefined) && c.balance !== undefined && c.asOf !== undefined;

function templateLeaveRows(rows: Rows, date1904: boolean): ReadLeaveRow[] | null {
  const heading = headingRow(rows, LEAVE_COLUMNS, leaveNeeds);
  if (!heading) return null;
  const at = (cells: readonly RawCell[], c: LeaveColumn) => (heading.columns[c] === undefined ? undefined : cells[heading.columns[c]!]);
  const out: ReadLeaveRow[] = [];
  for (const { n, cells } of rows.slice(heading.at + 1)) {
    const code = textOf(at(cells, 'code'));
    const typeText = textOf(at(cells, 'type'));
    const from = cellDate(at(cells, 'from'), date1904);
    const to = cellDate(at(cells, 'to'), date1904);
    const days = cellNumber(at(cells, 'days'));
    const notes = textOf(at(cells, 'notes'));
    // the name alone (the template's name looked up from a code not typed) is no row
    if (!code && !typeText && !from.text && !to.text && !days.text && !notes) continue;
    out.push({
      sheet: 'leaves',
      row: n,
      code: orNull(code),
      name: textOf(at(cells, 'name')),
      zohoId: null,
      zohoHint: null,
      typeText,
      from: from.date,
      fromText: from.text,
      to: to.date,
      toText: to.text,
      fileDays: days.n,
      daysText: days.text,
      notes: orNull(notes.slice(0, 500)),
      linkId: null,
      approval: null,
      approvalText: null,
      unit: null,
      details: null,
    });
    if (out.length > LEAVE_IMPORT_MAX_ROWS) throw new LeaveImportFileError(TOO_MANY_ROWS);
  }
  return out;
}

function templateBalanceRows(rows: Rows, date1904: boolean): ReadBalanceRow[] | null {
  const heading = headingRow(rows, BALANCE_COLUMNS, balanceNeeds);
  if (!heading) return null;
  const at = (cells: readonly RawCell[], c: BalanceColumn) => (heading.columns[c] === undefined ? undefined : cells[heading.columns[c]!]);
  const out: ReadBalanceRow[] = [];
  for (const { n, cells } of rows.slice(heading.at + 1)) {
    const code = textOf(at(cells, 'code'));
    const typeText = textOf(at(cells, 'type'));
    const balance = cellNumber(at(cells, 'balance'));
    const asOf = cellDate(at(cells, 'asOf'), date1904);
    if (!code && !typeText && !balance.text && !asOf.text) continue;
    out.push({ sheet: 'balances', row: n, code: orNull(code), name: textOf(at(cells, 'name')), typeText, balance: balance.n, balanceText: balance.text, asOf: asOf.date, asOfText: asOf.text });
    if (out.length > LEAVE_IMPORT_MAX_ROWS) throw new LeaveImportFileError(TOO_MANY_ROWS);
  }
  return out;
}

/**
 * Zoho People's leave export (the owner's sample, 21 October 2026): a row a leave under ZOHO_LINK_ID, Employee ID ("<name>
 * <Zoho number>"), Leave type, From, To, Days/Hours Taken, Reason for leave, Unit, Approval Status and "Date - Duration
 * and Session" (each day: a full day, a half, or a holiday or weekend), among others not needed.
 */
function zohoRows(rows: Rows, headingAt: number, date1904: boolean): ReadLeaveRow[] {
  const columns = columnsOf(rows[headingAt].cells, ZOHO_LEAVE_COLUMNS);
  const at = (cells: readonly RawCell[], c: ZohoLeaveColumn) => (columns[c] === undefined ? undefined : cells[columns[c]!]);
  const out: ReadLeaveRow[] = [];
  for (const { n, cells } of rows.slice(headingAt + 1)) {
    const employee = textOf(at(cells, 'employee'));
    const typeText = textOf(at(cells, 'type'));
    const from = cellDate(at(cells, 'from'), date1904);
    const to = cellDate(at(cells, 'to'), date1904);
    if (!employee && !typeText && !from.text && !to.text) continue;
    const person = zohoEmployee(employee);
    const details = zohoLeaveDays(textOf(at(cells, 'details')));
    const taken = cellNumber(at(cells, 'days'));
    const approvalText = textOf(at(cells, 'status'));
    out.push({
      sheet: 'leaves',
      row: n,
      code: null,
      name: person.name,
      zohoId: person.zohoId,
      zohoHint: person.hint,
      typeText,
      from: from.date,
      fromText: from.text,
      to: to.date,
      toText: to.text,
      // the days from each day's duration (half days 0.5, holidays and weekends 0), else Zoho's Days/Hours Taken
      fileDays: details ? Math.round(details.reduce((sum, d) => sum + d.portion, 0) * 10) / 10 : taken.n,
      daysText: taken.text,
      notes: orNull(textOf(at(cells, 'reason')).slice(0, 500)),
      linkId: orNull(textOf(at(cells, 'linkId'))),
      approval: zohoApproval(approvalText),
      approvalText: orNull(approvalText),
      unit: orNull(textOf(at(cells, 'unit'))),
      details,
    });
    if (out.length > LEAVE_IMPORT_MAX_ROWS) throw new LeaveImportFileError(TOO_MANY_ROWS);
  }
  if (!out.length) throw new LeaveImportFileError(NO_ROWS);
  return out;
}
