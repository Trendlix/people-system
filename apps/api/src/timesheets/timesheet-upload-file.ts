import ExcelJS from 'exceljs';
import { headingKey, importDate, readHours, TIMESHEET_TEMPLATE_SHEETS, TIMESHEET_UPLOAD_MAX_MB, TIMESHEET_UPLOAD_MAX_ROWS } from '@trendlix/shared';
import { cellText, tidyText, type RawCell } from '../payroll/holidays-import.js';
import { readZip, ZipError, type ZipLimits, type ZipProblem } from '../templates/zip.js';

// Reading a file of hours (owner, 5 November 2026: "how to upload a bulk time log?"; asked, "Our own Excel template"):
// the file checked as an uploaded workbook is (its zip's size and parts, as the leave import does), its heading row found
// (the template's Hours sheet, else the first sheet with a date, hours and a client or task heading, headings written
// in other words too: "Day", "Duration", "Description"), and each row read into plain values: the day (an Excel date,
// DD/MM/YYYY, YYYY-MM-DD or 21-Oct-2026), the employee's code, the client and task as written, the hours (a number, "7.5",
// "7:45", or a time typed in a time-formatted cell) and the note. Pure of the database: the upload checks the rows
// (timesheet-upload.service.ts).

export const TIMESHEET_UPLOAD_MAX_BYTES = TIMESHEET_UPLOAD_MAX_MB * 1024 * 1024;

/** A whole file refused, in words people act on (the service answers it as a 400). */
export class TimesheetFileError extends Error {}

export const CHOOSE_HOURS_FILE = 'Choose the file to upload: the timesheet template filled in, as an Excel workbook (.xlsx).';
export const HOURS_FILE_TOO_LARGE = `The file must be ${TIMESHEET_UPLOAD_MAX_MB} MB or smaller.`;
const NOT_A_WORKBOOK = 'This file isn’t an Excel workbook (.xlsx). Fill in the timesheet template and upload that.';
const OLD_OR_PROTECTED = 'This is an old Excel file (.xls) or one protected by a password. Remove any password, save it as an Excel workbook (.xlsx) and upload it again.';
const DAMAGED = 'This Excel file is damaged. Open it in Excel, save it again as an Excel workbook (.xlsx) and upload it again.';
const NO_HEADINGS = `The file has no heading row with Date, Hours and Client or Task. Download the template, fill in its ${TIMESHEET_TEMPLATE_SHEETS.hours} sheet and upload it.`;
const NO_ROWS = 'The file has no hours under its headings. Add a row for each day’s work and upload it again.';
const TOO_MANY_ROWS = `The file has more than ${TIMESHEET_UPLOAD_MAX_ROWS.toLocaleString('en-US')} rows. Upload at most ${TIMESHEET_UPLOAD_MAX_ROWS.toLocaleString('en-US')} at a time.`;

const ZIP_LIMITS: ZipLimits = { maxBytes: TIMESHEET_UPLOAD_MAX_BYTES, maxEntries: 500, maxExpandedBytes: 60 * 1024 * 1024 };

const ZIP_MESSAGES: Record<ZipProblem, string> = {
  not_zip: NOT_A_WORKBOOK,
  encrypted: OLD_OR_PROTECTED,
  zip64: HOURS_FILE_TOO_LARGE,
  too_large: HOURS_FILE_TOO_LARGE,
  too_many_entries: 'This workbook has too many parts for a file of hours. Copy the rows into the template and upload that.',
  expands_too_much: 'This workbook is too large for a file of hours. Copy the rows into the template and upload that.',
  unsupported_method: 'This file wasn’t saved as Excel saves it. Open it in Excel, save it as an Excel workbook (.xlsx) and upload it again.',
  damaged: DAMAGED,
};

const OLE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

/** A row as read: plain values, nothing checked against the system yet. */
export interface ReadHoursRow {
  /** Its number in the sheet, as Excel shows it. */
  row: number;
  date: string | null;
  dateText: string;
  code: string | null;
  client: string | null;
  task: string | null;
  hours: number | null;
  hoursText: string;
  note: string | null;
}

const COLUMNS = {
  date: ['date', 'day', 'workdate', 'workday'],
  code: ['employeecode', 'code', 'employeeno', 'employeenumber', 'employeeid'],
  client: ['client', 'clientaccount', 'clientname', 'clientcode', 'account'],
  task: ['task', 'activity', 'work', 'taskname'],
  hours: ['hours', 'hoursworked', 'duration', 'hrs', 'time', 'timespent'],
  note: ['note', 'notes', 'description', 'comment', 'comments'],
} as const;
type Column = keyof typeof COLUMNS;

type Rows = { n: number; cells: RawCell[] }[];

/** Text of a cell, tidied; '' when empty or "-". */
const textOf = (value: RawCell) => {
  const t = tidyText(cellText(value));
  return t === '-' ? '' : t;
};
const orNull = (t: string) => (t ? t : null);
const isFormula = (value: RawCell): value is ExcelJS.CellFormulaValue => value !== null && typeof value === 'object' && !(value instanceof Date) && 'result' in value;

const DAY_MS = 86_400_000;
const EXCEL_EPOCH = Date.UTC(1899, 11, 30);
const EXCEL_1904_EPOCH = Date.UTC(1904, 0, 1);

/** A cell as a day: an Excel date (or its serial number, 2000 to 2100), else its text read as one. */
function cellDate(value: RawCell, date1904: boolean): { date: string | null; text: string } {
  if (isFormula(value)) return cellDate(value.result as RawCell, date1904);
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return { date: null, text: '' };
    const date = new Date(Math.floor(value.getTime() / DAY_MS) * DAY_MS).toISOString().slice(0, 10);
    return { date, text: date };
  }
  if (typeof value === 'number') {
    const date = new Date((date1904 ? EXCEL_1904_EPOCH : EXCEL_EPOCH) + Math.floor(value) * DAY_MS).toISOString().slice(0, 10);
    const year = Number(date.slice(0, 4));
    return year >= 2000 && year <= 2100 ? { date, text: String(value) } : { date: null, text: String(value) };
  }
  const text = textOf(value);
  return { date: text ? importDate(text) : null, text };
}

/**
 * A cell as hours: a number of hours; a time typed in a time-formatted cell (Excel keeps 7:45 as a time of day); else its
 * text ("7.5", "7,5", "7:45"). Null unless quarter hours from 0.25 to 24 (readHours).
 */
function cellHours(value: RawCell): { hours: number | null; text: string } {
  if (isFormula(value)) return cellHours(value.result as RawCell);
  if (value instanceof Date) {
    const minutes = value.getUTCHours() * 60 + value.getUTCMinutes();
    const text = `${value.getUTCHours()}:${String(value.getUTCMinutes()).padStart(2, '0')}`;
    return { hours: readHours(text), text: minutes ? text : '0:00' };
  }
  if (typeof value === 'number') return { hours: Number.isFinite(value) ? readHours(String(Math.round(value * 10_000) / 10_000)) : null, text: String(value) };
  const text = textOf(value);
  return { hours: text ? readHours(text) : null, text };
}

function sheetRows(ws: ExcelJS.Worksheet): Rows {
  const rows: Rows = [];
  ws.eachRow({ includeEmpty: false }, (row, n) => rows.push({ n, cells: (row.values as RawCell[]).slice(1) }));
  return rows;
}

/** A heading row's columns: each known heading's index, the first of each. */
function columnsOf(cells: readonly RawCell[]): Partial<Record<Column, number>> {
  const found: Partial<Record<Column, number>> = {};
  cells.forEach((cell, i) => {
    const key = headingKey(textOf(cell));
    const column = (Object.keys(COLUMNS) as Column[]).find((c) => (COLUMNS[c] as readonly string[]).includes(key));
    if (column && found[column] === undefined) found[column] = i;
  });
  return found;
}

const enough = (c: Partial<Record<Column, number>>) => c.date !== undefined && c.hours !== undefined && (c.client !== undefined || c.task !== undefined);

/** The heading row among a sheet's first rows, and its columns. */
function headingRow(rows: Rows): { at: number; columns: Partial<Record<Column, number>> } | null {
  const at = rows.slice(0, 10).findIndex((r) => enough(columnsOf(r.cells)));
  return at < 0 ? null : { at, columns: columnsOf(rows[at].cells) };
}

/** The workbook loaded, after its zip was checked. Throws TimesheetFileError. */
async function loadWorkbook(data: Buffer): Promise<ExcelJS.Workbook> {
  if (!data.length) throw new TimesheetFileError(CHOOSE_HOURS_FILE);
  if (data.subarray(0, OLE.length).equals(OLE)) throw new TimesheetFileError(OLD_OR_PROTECTED);
  if (!data.subarray(0, ZIP.length).equals(ZIP)) throw new TimesheetFileError(NOT_A_WORKBOOK);
  try {
    const zip = readZip(data, ZIP_LIMITS);
    if (!zip.has('[Content_Types].xml') || !zip.has('xl/workbook.xml')) throw new TimesheetFileError(NOT_A_WORKBOOK);
    for (const entry of zip.entries) zip.read(entry.name);
  } catch (err) {
    if (err instanceof ZipError) throw new TimesheetFileError(ZIP_MESSAGES[err.problem]);
    throw err;
  }
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(data as unknown as ArrayBuffer);
  } catch {
    throw new TimesheetFileError(DAMAGED);
  }
  return wb;
}

/** The file's rows: the template's Hours sheet (by its name, else the first sheet with the headings); blank rows left out. */
export async function readHoursFile(data: Buffer): Promise<ReadHoursRow[]> {
  const wb = await loadWorkbook(data);
  const date1904 = wb.properties.date1904 === true;
  const visible = wb.worksheets.filter((s) => s.state === 'visible');
  const sheets = visible.length ? visible : wb.worksheets;
  const named = sheets.find((s) => headingKey(s.name) === headingKey(TIMESHEET_TEMPLATE_SHEETS.hours));
  const ordered = named ? [named, ...sheets.filter((s) => s !== named)] : sheets;
  for (const ws of ordered) {
    const rows = sheetRows(ws);
    const heading = headingRow(rows);
    if (!heading) continue;
    const at = (cells: readonly RawCell[], c: Column) => (heading.columns[c] === undefined ? undefined : cells[heading.columns[c]!]);
    const out: ReadHoursRow[] = [];
    for (const { n, cells } of rows.slice(heading.at + 1)) {
      const date = cellDate(at(cells, 'date'), date1904);
      const code = textOf(at(cells, 'code'));
      const client = textOf(at(cells, 'client'));
      const task = textOf(at(cells, 'task'));
      const hours = cellHours(at(cells, 'hours'));
      const note = textOf(at(cells, 'note'));
      // the name alone (the template's look-up from a code not typed) is no row
      if (!date.text && !client && !task && !hours.text && !note) continue;
      out.push({
        row: n,
        date: date.date,
        dateText: date.text,
        code: orNull(code),
        client: orNull(client),
        task: orNull(task),
        hours: hours.hours,
        hoursText: hours.text,
        note: orNull(note),
      });
    }
    if (!out.length) throw new TimesheetFileError(NO_ROWS);
    if (out.length > TIMESHEET_UPLOAD_MAX_ROWS) throw new TimesheetFileError(TOO_MANY_ROWS);
    return out;
  }
  throw new TimesheetFileError(NO_HEADINGS);
}
