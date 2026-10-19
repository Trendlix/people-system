import ExcelJS from 'exceljs';
import { nameKey, parseHours, placeOf, zonedMoment, type ImportedDay } from '@trendlix/shared';
import { cellText, latinDigits, tidyText, type RawCell } from '../payroll/holidays-import.js';
import { readZip, ZipError, type ZipLimits, type ZipProblem } from '../templates/zip.js';

// Reading Zoho People's attendance entries (owner, 19 October 2026: attendance runs in Zoho People today, "Import Zoho now,
// replace it later"): the daily export, an Excel workbook (.xlsx) with the sheets "Attendance(Hours)" and
// "Attendance(Decimal)" and, on the first, a row per person and day under the headings Employee Id, Employee Name, Date
// (01-Sep-2026), First Check-In and Last Check-Out (Excel date-times, Cairo's clock), Check-in Location, Check-out
// Location, Permission (HH:MM), Status (Present, Weekend, Annual Leave …) and more the import doesn't need, then a Total
// row. One file with everyone or a file a person ("one file with everyone, or many files at once"). This is the reading,
// pure and tested: the file checked as an uploaded workbook is (its zip's size and parts), the sheet, the headings in any
// order, each row's day, times, place and status. The check-in's place is office or remote by the office addresses
// (attendance-import.ts placeOf) at once: the address itself never leaves here. Hours aren't Zoho's: the system's shift
// counts them (attendanceMonth).

/** The largest file, and the most files at once (the owner's brief, 19 October 2026). */
export const ZOHO_MAX_MB = 5;
export const ZOHO_MAX_BYTES = ZOHO_MAX_MB * 1024 * 1024;
export const ZOHO_MAX_FILES = 60;
/** The most rows a file may have: a month of a few hundred people. */
export const ZOHO_MAX_ROWS = 20_000;

/** A whole file refused, in words HR act on (the service answers it as a 400, naming the file). */
export class ZohoFileError extends Error {}

export const ZOHO_TOO_LARGE = `Each file must be ${ZOHO_MAX_MB} MB or smaller.`;
const NOT_A_WORKBOOK = "isn't an Excel workbook (.xlsx). Export the attendance entries from Zoho People as Excel (XLSX) and upload that file.";
const OLD_OR_PROTECTED = 'is an old Excel file (.xls) or protected by a password. Export the attendance entries from Zoho People as XLSX and upload that file.';
const DAMAGED = 'is damaged. Export it from Zoho People again and upload the new file.';
const NO_HEADINGS = "doesn't have Zoho's headings (Employee Name, Date, First Check-In, Last Check-Out). Upload Zoho People's attendance entries export as it is.";
const NO_ROWS = 'has no days under its headings.';
const TOO_MANY_ROWS = `has more than ${ZOHO_MAX_ROWS.toLocaleString('en-US')} rows. Export fewer people or days at a time.`;

const ZIP_LIMITS: ZipLimits = { maxBytes: ZOHO_MAX_BYTES, maxEntries: 500, maxExpandedBytes: 60 * 1024 * 1024 };

const ZIP_MESSAGES: Record<ZipProblem, string> = {
  not_zip: NOT_A_WORKBOOK,
  encrypted: OLD_OR_PROTECTED,
  zip64: ZOHO_TOO_LARGE,
  too_large: ZOHO_TOO_LARGE,
  too_many_entries: 'has too many parts for an attendance export.',
  expands_too_much: 'is too large for an attendance export.',
  unsupported_method: "wasn't saved as Excel saves it. Export it from Zoho People again as XLSX.",
  damaged: DAMAGED,
};

const OLE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

/** A person's row of a day as read, the check-in's place already office or remote. */
export interface ZohoRow extends ImportedDay {
  /** Its number in the sheet, as Excel shows it. */
  row: number;
  zohoId: string | null;
  name: string;
}

export interface ZohoReading {
  /** The sheet the rows were read from. */
  sheet: string;
  rows: ZohoRow[];
  /** Rows that couldn't be read (a day that isn't a date, no name), by their number: left out, said. */
  problems: { row: number; message: string }[];
}

type Column = 'id' | 'name' | 'date' | 'checkIn' | 'checkOut' | 'checkInLocation' | 'checkOutLocation' | 'permission' | 'status';

/** The headings each column is known by, as headingKey has them. */
const HEADINGS: Record<Column, readonly string[]> = {
  id: ['employeeid', 'employeeno', 'employeenumber', 'id'],
  name: ['employeename', 'name', 'employee'],
  date: ['date', 'day'],
  checkIn: ['firstcheckin', 'checkin', 'firstin', 'intime'],
  checkOut: ['lastcheckout', 'checkout', 'lastout', 'outtime'],
  checkInLocation: ['checkinlocation'],
  checkOutLocation: ['checkoutlocation'],
  permission: ['permission', 'permissionhhmm', 'permissionhours'],
  status: ['status'],
};

const headingKey = (value: RawCell) =>
  tidyText(cellText(value))
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');

function headingColumns(cells: readonly RawCell[]): Partial<Record<Column, number>> {
  const found: Partial<Record<Column, number>> = {};
  cells.forEach((cell, c) => {
    const key = headingKey(cell);
    const column = (Object.keys(HEADINGS) as Column[]).find((k) => HEADINGS[k].includes(key));
    if (column && found[column] === undefined) found[column] = c;
  });
  return found;
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const pad = (n: number) => String(n).padStart(2, '0');

/** A real day as YYYY-MM-DD, or null. */
function dayOf(y: number, m: number, d: number): string | null {
  if (!(y >= 2000 && y <= 2100 && m >= 1 && m <= 12 && d >= 1)) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCMonth() === m - 1 ? `${y}-${pad(m)}-${pad(d)}` : null;
}

/** An Excel date-time as exceljs gives it: its clock is the sheet's (Cairo's), read off as UTC. */
const fromCell = (d: Date) => ({ day: d.toISOString().slice(0, 10), time: d.toISOString().slice(11, 16) });

/**
 * A row's day: an Excel date, or text as Zoho writes it (01-Sep-2026), as YYYY-MM-DD (2026-09-01) or as DD/MM/YYYY
 * (01/09/2026). Null when it isn't one (the Total row).
 */
export function zohoDay(value: RawCell): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : fromCell(value).day;
  const text = latinDigits(tidyText(cellText(value)));
  let m = /^(\d{1,2})[-\s/]([A-Za-z]{3,4})[-\s/,]+(\d{4})$/.exec(text);
  if (m) return MONTHS[m[2].toLowerCase()] ? dayOf(Number(m[3]), MONTHS[m[2].toLowerCase()], Number(m[1])) : null;
  m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  if (m) return dayOf(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  if (m) return dayOf(Number(m[3]), Number(m[2]), Number(m[1]));
  return null;
}

/** "10:23 AM", "10:23", "22:05" as HH:MM; null when it isn't a time. */
function clockOf(text: string): string | null {
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp][Mm])?$/.exec(text.trim());
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2]);
  if (m[3]) {
    const pm = m[3].toLowerCase() === 'pm';
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (pm ? 12 : 0);
  }
  return h <= 23 && min <= 59 ? `${pad(h)}:${pad(min)}` : null;
}

/**
 * A check-in or check-out as a moment (ISO, UTC), the time being Cairo's (owner's brief, 19 October 2026: "the times are
 * Cairo local"): an Excel date-time, or text as "01-Sep-2026 10:23 AM", "2026-09-01 10:23" or a time alone ("10:23 AM",
 * on the row's day). Null for an empty cell, "-" or anything else.
 */
export function zohoMoment(value: RawCell, rowDay: string): string | null {
  let day: string | null = rowDay;
  let time: string | null = null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    ({ day, time } = fromCell(value));
  } else {
    const text = latinDigits(tidyText(cellText(value)));
    if (!text || text === '-') return null;
    const both = /^(.+?)[\sT]+(\d{1,2}:\d{2}(?::\d{2})?\s*(?:[AaPp][Mm])?)$/.exec(text);
    if (both && zohoDay(both[1])) {
      day = zohoDay(both[1]);
      time = clockOf(both[2]);
    } else time = clockOf(text);
  }
  if (!day || !time) return null;
  const moment = zonedMoment(day, time);
  return Number.isFinite(moment) ? new Date(moment).toISOString() : null;
}

/** Zoho's Permission (HH:MM, or hours as a number on the Decimal sheet) in hours; 0 for none or "-". */
export function zohoHours(value: RawCell): number {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : 0;
  const hours = parseHours(latinDigits(tidyText(cellText(value))));
  return hours !== null && hours > 0 ? hours : 0;
}

/** Text of a cell, or null when empty or "-". */
const textOf = (value: RawCell) => {
  const t = tidyText(cellText(value));
  return t && t !== '-' ? t : null;
};

/**
 * The rows of Zoho's attendance entries in a workbook: its "Attendance(Hours)" sheet, else its first visible one; the
 * headings found in its first rows; each row with a day (the Total row and blank ones left out) as a person's day, its
 * check-in's place office or remote by `officeAddresses`. Throws ZohoFileError for a file that isn't such a workbook
 * (the message goes after the file's name: "attendance.xlsx isn't an Excel workbook …").
 */
export async function readZohoWorkbook(data: Buffer, officeAddresses: readonly string[]): Promise<ZohoReading> {
  if (!data.length || data.subarray(0, ZIP.length).equals(ZIP) === false) {
    throw new ZohoFileError(data.subarray(0, OLE.length).equals(OLE) ? OLD_OR_PROTECTED : NOT_A_WORKBOOK);
  }
  try {
    const zip = readZip(data, ZIP_LIMITS);
    if (!zip.has('[Content_Types].xml') || !zip.has('xl/workbook.xml')) throw new ZohoFileError(NOT_A_WORKBOOK);
    for (const entry of zip.entries) zip.read(entry.name);
  } catch (err) {
    if (err instanceof ZipError) throw new ZohoFileError(ZIP_MESSAGES[err.problem]);
    throw err;
  }
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(data as unknown as ArrayBuffer);
  } catch {
    throw new ZohoFileError(DAMAGED);
  }
  const sheetKey = (name: string) => name.toLowerCase().replace(/[^a-z]/g, '');
  const ws = wb.worksheets.find((s) => sheetKey(s.name) === 'attendancehours') ?? wb.worksheets.find((s) => s.state === 'visible') ?? wb.worksheets[0];
  if (!ws) throw new ZohoFileError(NO_ROWS);

  const rows: { n: number; cells: RawCell[] }[] = [];
  ws.eachRow({ includeEmpty: false }, (row, n) => rows.push({ n, cells: (row.values as RawCell[]).slice(1) }));
  const headingAt = rows.slice(0, 10).findIndex((r) => {
    const c = headingColumns(r.cells);
    return c.name !== undefined && c.date !== undefined && c.checkIn !== undefined && c.checkOut !== undefined;
  });
  if (headingAt < 0) throw new ZohoFileError(NO_HEADINGS);
  const columns = headingColumns(rows[headingAt].cells);
  const at = (cells: readonly RawCell[], c: Column) => (columns[c] === undefined ? undefined : cells[columns[c]!]);

  const out: ZohoRow[] = [];
  const problems: { row: number; message: string }[] = [];
  for (const { n, cells } of rows.slice(headingAt + 1)) {
    const date = zohoDay(at(cells, 'date'));
    const name = textOf(at(cells, 'name'));
    const zohoId = textOf(at(cells, 'id'));
    if (!date) {
      // the Total row, a blank one, or a day that isn't one: said only when the row names someone
      if (name || zohoId) problems.push({ row: n, message: `Row ${n}: the day isn't a date, e.g. 01-Sep-2026. The row is left out.` });
      continue;
    }
    if (!name && !zohoId) {
      problems.push({ row: n, message: `Row ${n}: no employee name or ID. The row is left out.` });
      continue;
    }
    if (out.length === ZOHO_MAX_ROWS) throw new ZohoFileError(TOO_MANY_ROWS);
    out.push({
      row: n,
      zohoId,
      name: name ?? '',
      date,
      checkIn: zohoMoment(at(cells, 'checkIn'), date),
      checkOut: zohoMoment(at(cells, 'checkOut'), date),
      place: placeOf(textOf(at(cells, 'checkInLocation')), textOf(at(cells, 'checkOutLocation')), officeAddresses),
      zohoStatus: textOf(at(cells, 'status')),
      permissionHours: zohoHours(at(cells, 'permission')),
    });
  }
  if (!out.length) throw new ZohoFileError(NO_ROWS);
  return { sheet: ws.name, rows: out, problems };
}

/** Whose a row is: Zoho's Employee Id when it has one, else the name as matched (nameKey). */
export const personKey = (r: Pick<ZohoRow, 'zohoId' | 'name'>) => (r.zohoId ? `id:${r.zohoId}` : `name:${nameKey(r.name)}`);
