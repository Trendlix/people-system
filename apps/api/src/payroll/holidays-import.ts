import { createHash } from 'node:crypto';
import ExcelJS from 'exceljs';
import { addDays, fromDateOnly, isDateOnly, shownDate, toDateOnly } from '../common/date-only.js';
import { detectPaperworkType } from '../paperwork/paperwork-file.js';
import { readZip, ZipError, type ZipLimits, type ZipProblem } from '../templates/zip.js';
import { HOLIDAY_YEARS } from './holidays.dto.js';

// Importing the year's holidays from a file (owner's request, 16 October 2026: "allow me to import yearly holiday
// list"), on Organization → Holidays. HR fills in the template (holidays-import-template.ts), or any sheet with its
// headings, as an Excel workbook (.xlsx) or a CSV file, and imports it in two steps: the file is read and each day shown
// with what would happen to it, nothing saved; then, confirmed, the new ones are added. This is the reading, pure and
// tested: the file's kind by its content (never its name), its rows under the headings, each row's dates (Excel dates,
// YYYY-MM-DD or DD/MM/YYYY, Arabic-Indic digits too) and names, a holiday of several days (Until) turned into one
// holiday a day (as holidays are kept), and each day set against the holidays already on file.

/** The most rows of holidays one file can have (blank rows aren't counted): a year has a few dozen at most. */
export const IMPORT_MAX_ROWS = 500;
/** The longest holiday one row can give (Date to Until): Eid holidays run a few days, never two weeks. */
export const IMPORT_MAX_RANGE_DAYS = 14;
/** The largest file: a year's holidays take a few kilobytes, even as a workbook. */
export const IMPORT_MAX_MB = 1;
export const IMPORT_MAX_BYTES = IMPORT_MAX_MB * 1024 * 1024;
/** The longest name, in either language (as a holiday added by hand). */
export const IMPORT_NAME_MAX = 100;

/** The template's headings, in its order. Until and Name (Arabic) may be left empty. */
export const IMPORT_HEADINGS = ['Date', 'Until', 'Name (English)', 'Name (Arabic)'] as const;

/** A whole file refused, in words HR act on (the service answers it as a 400). */
export class ImportFileError extends Error {}

export const CHOOSE_FILE = 'Choose the file to import: the template filled in, as an Excel workbook (.xlsx) or a CSV file (.csv).';
export const TOO_LARGE = `The file must be ${IMPORT_MAX_MB} MB or smaller.`;
const NOT_A_SHEET = "This file isn't an Excel workbook (.xlsx) or a CSV file (.csv). Fill in the template and import it again.";
const OLD_OR_PROTECTED =
  'This is an old Excel file (.xls) or one protected by a password. Remove any password, save it as an Excel workbook (.xlsx) and import it again.';
const NO_HEADINGS = `The file doesn't have the template's headings (${IMPORT_HEADINGS.join(', ')}) above the holidays. Download the template, fill it in and import it again.`;
const NO_ROWS = 'The file has no holidays under its headings. Add a row for each holiday and import it again.';
const TOO_MANY_ROWS = `The file has more than ${IMPORT_MAX_ROWS} rows of holidays. Import at most ${IMPORT_MAX_ROWS} at a time.`;
const DAMAGED = 'This Excel file is damaged. Open it in Excel, save it again as an Excel workbook (.xlsx) and import it again.';

// A workbook comes from outside, so before the Excel library opens it, the zip it is is checked as an uploaded Word
// file is (templates/zip.ts): its size, its number of parts and what they unpack to are capped, and each part is
// unpacked once, so none holds more than its header says.
const ZIP_LIMITS: ZipLimits = { maxBytes: IMPORT_MAX_BYTES, maxEntries: 500, maxExpandedBytes: 20 * 1024 * 1024 };

const ZIP_MESSAGES: Record<ZipProblem, string> = {
  not_zip: NOT_A_SHEET,
  encrypted: OLD_OR_PROTECTED,
  zip64: TOO_LARGE,
  too_large: TOO_LARGE,
  too_many_entries: 'This workbook has too many parts for a list of holidays. Copy the holidays into the template and import that.',
  expands_too_much: 'This workbook is too large for a list of holidays. Copy the holidays into the template and import that.',
  unsupported_method: "This file wasn't saved by Excel. Open it in Excel, save it as an Excel workbook (.xlsx) and import it again.",
  damaged: DAMAGED,
};

// ---------- the file ----------

/** A cell as read: exceljs's value from a workbook, the text from a CSV file. */
export type RawCell = ExcelJS.CellValue | undefined;

/** A row of the sheet: its number as Excel shows it, and its cells from column A. */
export interface SheetRow {
  row: number;
  cells: readonly RawCell[];
}

/** A row under the headings: the template's four columns. */
export interface HolidayRow {
  row: number;
  date: RawCell;
  until: RawCell;
  nameEn: RawCell;
  nameAr: RawCell;
}

export type ImportFileKind = 'xlsx' | 'csv';

const OLE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

/**
 * What the file is, by its first bytes: a zip is taken for a workbook (and checked as one when read), an old .xls or a
 * file protected by a password (both OLE files) or a PDF or a picture is refused; anything else is read as CSV text.
 */
export function importFileKind(data: Buffer): ImportFileKind {
  if (!data.length) throw new ImportFileError(CHOOSE_FILE);
  if (data.subarray(0, OLE.length).equals(OLE)) throw new ImportFileError(OLD_OR_PROTECTED);
  if (data.subarray(0, ZIP.length).equals(ZIP)) return 'xlsx';
  if (detectPaperworkType(data)) throw new ImportFileError(NOT_A_SHEET);
  return 'csv';
}

/** The file's fingerprint (SHA-256, hex): the import is confirmed with it, so what is imported is what was previewed. */
export const fingerprintOf = (data: Buffer) => createHash('sha256').update(data).digest('hex');

/** A workbook's rows: those of its "Holidays" sheet, else of its first visible one. Throws ImportFileError. */
export async function workbookRows(data: Buffer): Promise<{ rows: SheetRow[]; date1904: boolean }> {
  try {
    const zip = readZip(data, ZIP_LIMITS);
    if (!zip.has('[Content_Types].xml') || !zip.has('xl/workbook.xml')) throw new ImportFileError(NOT_A_SHEET);
    for (const entry of zip.entries) zip.read(entry.name);
  } catch (err) {
    if (err instanceof ZipError) throw new ImportFileError(ZIP_MESSAGES[err.problem]);
    throw err;
  }
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(data as unknown as ArrayBuffer);
  } catch {
    throw new ImportFileError(DAMAGED);
  }
  const sheets = wb.worksheets;
  const ws = sheets.find((s) => s.name.trim().toLowerCase() === 'holidays') ?? sheets.find((s) => s.state === 'visible') ?? sheets[0];
  if (!ws) throw new ImportFileError(NO_ROWS);
  const rows: SheetRow[] = [];
  ws.eachRow({ includeEmpty: false }, (row, n) => rows.push({ row: n, cells: (row.values as RawCell[]).slice(1) }));
  return { rows, date1904: wb.properties.date1904 === true };
}

/** Whether text has a control character other than the tab and line breaks, which no text file has. */
function hasControl(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if ((code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) || code === 0x7f) return true;
  }
  return false;
}

/**
 * A CSV file's text: UTF-8 (Excel's "CSV UTF-8", with or without its byte order mark), UTF-16 with its byte order mark
 * (Excel's "Unicode Text"), else Windows Arabic (windows-1256, Excel's plain "CSV" on an Arabic Windows). Throws
 * ImportFileError for a file that isn't text.
 */
export function csvText(data: Buffer): string {
  let text: string;
  if (data[0] === 0xff && data[1] === 0xfe) text = new TextDecoder('utf-16le').decode(data);
  else if (data[0] === 0xfe && data[1] === 0xff) text = new TextDecoder('utf-16be').decode(data);
  else {
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(data);
    } catch {
      text = new TextDecoder('windows-1256').decode(data);
    }
  }
  if (hasControl(text)) throw new ImportFileError(NOT_A_SHEET);
  return text;
}

/** The separator a CSV file uses: a comma, a semicolon (Excel in much of Europe) or a tab, whichever its start has most of. */
function csvSeparator(text: string): string {
  const start = text.slice(0, 4000).replace(/"[^"]*"/g, '');
  const counts = [',', ';', '\t'].map((sep) => ({ sep, n: start.split(sep).length - 1 }));
  return counts.reduce((best, c) => (c.n > best.n ? c : best)).sep;
}

/**
 * A CSV file's rows (RFC 4180: quoted fields, "" for a quote, line breaks within quotes), each numbered as Excel numbers
 * it when the file is opened there.
 */
export function csvRows(text: string): SheetRow[] {
  const sep = csvSeparator(text);
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let quoted = false;
  let started = false; // something on the line, so a last line without a line break is still a row
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch !== '"') field += ch;
      else if (text[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = false;
      continue;
    }
    if (ch === '"' && field === '') {
      quoted = true;
      started = true;
    } else if (ch === sep) {
      record.push(field);
      field = '';
      started = true;
    } else if (ch === '\r' || ch === '\n') {
      record.push(field);
      records.push(record);
      record = [];
      field = '';
      started = false;
      if (ch === '\r' && text[i + 1] === '\n') i++;
    } else {
      field += ch;
      started = true;
    }
  }
  if (started) {
    record.push(field);
    records.push(record);
  }
  return records.map((cells, i) => ({ row: i + 1, cells }));
}

// ---------- the headings and the rows under them ----------

type Column = 'date' | 'until' | 'nameEn' | 'nameAr';

// The headings each column is known by, as headingKey has them: the template's, and the usual other ways of putting
// them, in English and Arabic.
const HEADINGS: Record<Column, readonly string[]> = {
  date: ['date', 'from', 'startdate', 'firstday', 'التاريخ', 'من'],
  until: ['until', 'to', 'enddate', 'lastday', 'إلى', 'الى', 'حتى'],
  nameEn: ['nameenglish', 'nameinenglish', 'englishname', 'nameen', 'name', 'holiday', 'holidayname', 'الاسمبالإنجليزية', 'الاسمبالانجليزية'],
  nameAr: ['namearabic', 'nameinarabic', 'arabicname', 'namear', 'الاسمبالعربية', 'الاسمبالعربي', 'الاسم'],
};

/** A heading as compared: letters and digits only, lower case, without "optional" ("Name (Arabic, optional)" → "namearabic"). */
const headingKey = (value: RawCell) =>
  tidyText(cellText(value))
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '')
    .replace(/optional$/, '');

/** How many of the first rows are looked at for the headings (a title or a note may be above them). */
const HEADING_ROWS = 10;

/** The columns a row names by its headings (the first of each), by their index. */
function headingColumns(r: SheetRow): Partial<Record<Column, number>> {
  const found: Partial<Record<Column, number>> = {};
  r.cells.forEach((cell, c) => {
    const key = headingKey(cell);
    const column = (Object.keys(HEADINGS) as Column[]).find((k) => HEADINGS[k].includes(key));
    if (column && found[column] === undefined) found[column] = c;
  });
  return found;
}

/**
 * The rows under the headings, blank ones left out: the headings are looked for in the first rows (Date and Name
 * (English) needed; Until and Name (Arabic) optional; in any order). Throws ImportFileError when there are none, when
 * there are no rows under them, or more than IMPORT_MAX_ROWS.
 */
export function holidayRows(rows: readonly SheetRow[]): HolidayRow[] {
  const headingIndex = rows.slice(0, HEADING_ROWS).findIndex((r) => {
    const found = headingColumns(r);
    return found.date !== undefined && found.nameEn !== undefined;
  });
  if (headingIndex < 0) throw new ImportFileError(NO_HEADINGS);
  const columns = headingColumns(rows[headingIndex]);

  const at = (r: SheetRow, column: Column) => {
    const c = columns[column];
    return c === undefined ? undefined : r.cells[c];
  };
  const out: HolidayRow[] = [];
  for (const r of rows.slice(headingIndex + 1)) {
    const row = { row: r.row, date: at(r, 'date'), until: at(r, 'until'), nameEn: at(r, 'nameEn'), nameAr: at(r, 'nameAr') };
    if ([row.date, row.until, row.nameEn, row.nameAr].every((v) => tidyText(cellText(v)) === '')) continue;
    if (out.length === IMPORT_MAX_ROWS) throw new ImportFileError(TOO_MANY_ROWS);
    out.push(row);
  }
  if (!out.length) throw new ImportFileError(NO_ROWS);
  return out;
}

// ---------- each row's dates and names ----------

/** Western digits for Arabic-Indic ones (U+0660 to U+0669, and the Persian forms U+06F0 to U+06F9). */
export const latinDigits = (text: string) =>
  Array.from(text, (ch) => {
    const code = ch.charCodeAt(0);
    if (code >= 0x0660 && code <= 0x0669) return String(code - 0x0660);
    if (code >= 0x06f0 && code <= 0x06f9) return String(code - 0x06f0);
    return ch;
  }).join('');

/** The invisible marks a cell can carry: control characters, direction marks typed with Arabic, a byte order mark. */
function isHidden(code: number): boolean {
  return (
    code < 0x20 ||
    (code >= 0x7f && code <= 0x9f) ||
    (code >= 0x200b && code <= 0x200f) ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069) ||
    code === 0x061c ||
    code === 0xfeff
  );
}

/** Text as kept: any run of spaces or line breaks one space, invisible marks taken out, trimmed. */
export const tidyText = (text: string) =>
  Array.from(text.replace(/\s+/g, ' '))
    .filter((ch) => !isHidden(ch.codePointAt(0)!))
    .join('')
    .replace(/ {2,}/g, ' ')
    .trim();

/** A cell's text as Excel shows it: a formula's result, a link's text, rich text run together; '' for an empty cell. */
export function cellText(value: RawCell): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : fromDateOnly(dayOf(value));
  if ('richText' in value) return value.richText.map((r) => r.text).join('');
  if ('result' in value) return cellText(value.result as RawCell);
  if ('formula' in value || 'sharedFormula' in value) return '';
  if ('text' in value) return cellText(value.text);
  if ('error' in value) return value.error;
  return '';
}

const DAY_MS = 86_400_000;
/** The day a date cell holds, at midnight UTC (exceljs reads Excel's dates as UTC); a time on it is dropped. */
const dayOf = (d: Date) => new Date(Math.floor(d.getTime() / DAY_MS) * DAY_MS);

// Excel keeps a date as a number of days: from 30 December 1899, or from 1 January 1904 in a workbook made with the
// 1904 date system (old Mac Excel).
const EXCEL_EPOCH = Date.UTC(1899, 11, 30);
const EXCEL_1904_EPOCH = Date.UTC(1904, 0, 1);
/** Beyond the last year a holiday can be in, whichever date system. */
const SERIAL_MAX = (Date.UTC(HOLIDAY_YEARS.to + 1, 0, 1) - EXCEL_EPOCH) / DAY_MS;

/** Whether a day (YYYY-MM-DD) is in the years a holiday can be in. */
const inYears = (date: string) => {
  const year = Number(date.slice(0, 4));
  return year >= HOLIDAY_YEARS.from && year <= HOLIDAY_YEARS.to;
};

const YMD = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/;
const DMY = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/;
// a time after the day, as a CSV saved from Excel can have it: "16/05/2027 00:00", "2027-05-16T00:00:00Z"
const TIME = /[ T]\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?: ?[AaPp][Mm])?Z?$/;

/** A cell read as a day: the day (YYYY-MM-DD), or why it isn't one with the text as given; null for an empty cell. */
export type DateReading = { date: string } | { problem: 'not_date' | 'not_real'; text: string };

const pad = (n: string) => n.padStart(2, '0');

/**
 * A cell as a day: an Excel date (also a formula giving one, or the bare number of a date in the years a holiday can be
 * in), or text written YYYY-MM-DD or DD/MM/YYYY (also with "-" or "." and single digits, Arabic-Indic digits too).
 * "not_real" for one written as a date that isn't a day (31/02/2027), "not_date" for anything else.
 */
export function readDate(value: RawCell, date1904 = false): DateReading | null {
  if (value !== null && typeof value === 'object' && !(value instanceof Date) && 'result' in value) return readDate(value.result as RawCell, date1904);
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? { problem: 'not_date', text: '' } : { date: fromDateOnly(dayOf(value)) };
  if (typeof value === 'number') {
    // only the days of the years a holiday can be in: any other number is no date (2027 is a year, not 19 July 1905)
    if (!Number.isFinite(value) || value < 0 || value > SERIAL_MAX) return { problem: 'not_date', text: String(value) };
    const date = fromDateOnly(dayOf(new Date((date1904 ? EXCEL_1904_EPOCH : EXCEL_EPOCH) + value * DAY_MS)));
    return inYears(date) ? { date } : { problem: 'not_date', text: String(value) };
  }
  const text = tidyText(latinDigits(cellText(value)).replace(/\u060d/g, '/'));
  if (text === '') return null;
  const bare = text.replace(TIME, '');
  const ymd = YMD.exec(bare);
  const dmy = ymd ? null : DMY.exec(bare);
  if (!ymd && !dmy) return { problem: 'not_date', text };
  const date = ymd ? `${ymd[1]}-${pad(ymd[2])}-${pad(ymd[3])}` : `${dmy![3]}-${pad(dmy![2])}-${pad(dmy![1])}`;
  return isDateOnly(date) ? { date } : { problem: 'not_real', text };
}

/** A day the file gives a holiday on: its row, the day (YYYY-MM-DD) and the names. */
export interface ImportedDay {
  row: number;
  date: string;
  nameEn: string;
  nameAr: string | null;
}

/** A row that can't be imported, and why: "Row 4: the date 31/02/2027 isn't a real day." */
export interface ImportProblem {
  row: number;
  message: string;
}

/** The days from `from` to `to`, both included (YYYY-MM-DD); empty when `to` is before `from`. */
function daysFrom(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** How many days from `from` to `to`, both included (YYYY-MM-DD). */
const spanOf = (from: string, to: string) => Math.round((toDateOnly(to).getTime() - toDateOnly(from).getTime()) / DAY_MS) + 1;

/**
 * Each row's days and names, and each row's problems with its row number: a date that isn't one or isn't a real day,
 * Until before the date or more than IMPORT_MAX_RANGE_DAYS after it, a day outside HOLIDAY_YEARS, no English name, a
 * name over IMPORT_NAME_MAX characters. A row with a problem gives no day; one with Until gives one day for each day
 * from its date to Until, each with the row's names.
 */
export function readHolidayRows(rows: readonly HolidayRow[], date1904 = false): { days: ImportedDay[]; problems: ImportProblem[] } {
  const days: ImportedDay[] = [];
  const problems: ImportProblem[] = [];
  for (const r of rows) {
    const found: string[] = [];
    const day = (value: RawCell, under: 'Date' | 'Until'): string | null => {
      const reading = readDate(value, date1904);
      if (reading === null) {
        if (under === 'Date') found.push("enter the holiday's date under Date.");
        return null;
      }
      if ('problem' in reading) {
        found.push(
          reading.problem === 'not_real'
            ? `the ${under === 'Date' ? 'date' : 'Until date'} ${reading.text} isn't a real day.`
            : `"${reading.text}" under ${under} isn't a date. Write it as DD/MM/YYYY, e.g. 25/04/2027.`,
        );
        return null;
      }
      if (!inYears(reading.date)) {
        found.push(`${shownDate(reading.date)} is outside the years a holiday can be in (${HOLIDAY_YEARS.from} to ${HOLIDAY_YEARS.to}).`);
        return null;
      }
      return reading.date;
    };
    const from = day(r.date, 'Date');
    const until = day(r.until, 'Until');
    if (from && until && until < from) found.push(`Until (${shownDate(until)}) is before the date (${shownDate(from)}).`);
    const span = from && until && until >= from ? spanOf(from, until) : 1;
    if (span > IMPORT_MAX_RANGE_DAYS) {
      found.push(`a holiday runs ${IMPORT_MAX_RANGE_DAYS} days at most; this one runs ${span} days, ${shownDate(from!)} to ${shownDate(until!)}.`);
    }
    const nameEn = tidyText(cellText(r.nameEn));
    const nameAr = tidyText(cellText(r.nameAr));
    if (!nameEn) found.push("enter the holiday's name in English.");
    else if (nameEn.length > IMPORT_NAME_MAX) found.push(`keep the English name to ${IMPORT_NAME_MAX} characters or fewer.`);
    if (nameAr.length > IMPORT_NAME_MAX) found.push(`keep the Arabic name to ${IMPORT_NAME_MAX} characters or fewer.`);

    if (found.length) problems.push(...found.map((text) => ({ row: r.row, message: `Row ${r.row}: ${text}` })));
    else for (const date of daysFrom(from!, until ?? from!)) days.push({ row: r.row, date, nameEn, nameAr: nameAr || null });
  }
  return { days, problems };
}

// ---------- each day against the holidays on file ----------

/**
 * What happens to a day on import: added (new); skipped as already on file (a holiday that day with the same English
 * name); not imported as a clash (a holiday that day with another name, which HR changes or removes first if the file
 * is right); or skipped as a duplicate (the same day given again further down the file: the first one counts).
 */
export type ImportStatus = 'new' | 'on_file' | 'clash' | 'duplicate';

export interface ImportDay extends ImportedDay {
  status: ImportStatus;
  /** The holiday on file that day (on_file and clash). */
  onFile?: { nameEn: string; nameAr: string | null };
  /** The row that gives the day first (duplicate). */
  firstRow?: number;
}

/** Whether two English names are the same holiday's: the same once spaces and capitals are set aside. */
export const sameName = (a: string, b: string) => tidyText(a).toLocaleLowerCase('en') === tidyText(b).toLocaleLowerCase('en');

/** Each day of the file, in the file's order, with what happens to it against the holidays on file on those days. */
export function classifyDays(days: readonly ImportedDay[], onFile: readonly { date: string; nameEn: string; nameAr: string | null }[]): ImportDay[] {
  const held = new Map(onFile.map((h) => [h.date, h]));
  const first = new Map<string, number>();
  return days.map((d): ImportDay => {
    const earlier = first.get(d.date);
    if (earlier !== undefined) return { ...d, status: 'duplicate', firstRow: earlier };
    first.set(d.date, d.row);
    const holiday = held.get(d.date);
    if (!holiday) return { ...d, status: 'new' };
    return { ...d, status: sameName(holiday.nameEn, d.nameEn) ? 'on_file' : 'clash', onFile: { nameEn: holiday.nameEn, nameAr: holiday.nameAr } };
  });
}

// ---------- all together ----------

/** A file read: its fingerprint, how many rows of holidays it has, their days, and the rows' problems. */
export interface ImportReading {
  fingerprint: string;
  rows: number;
  days: ImportedDay[];
  problems: ImportProblem[];
}

/** Reads an uploaded holiday list (.xlsx or .csv, by its content). Throws ImportFileError for a file it can't take. */
export async function readImportFile(data: Buffer): Promise<ImportReading> {
  if (data.length > IMPORT_MAX_BYTES) throw new ImportFileError(TOO_LARGE);
  const sheet = importFileKind(data) === 'xlsx' ? await workbookRows(data) : { rows: csvRows(csvText(data)), date1904: false };
  const rows = holidayRows(sheet.rows);
  return { fingerprint: fingerprintOf(data), rows: rows.length, ...readHolidayRows(rows, sheet.date1904) };
}
