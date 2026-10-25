import ExcelJS from 'exceljs';
import { STANDING_LABELS, type Standing } from '@trendlix/shared';
import { departmentName } from '../contracts/views.js';
import type { Missing } from './completeness.js';

// The Missing Details report as an Excel workbook (owner's request, 16 October 2026: "a report with the missing personal
// profile fields and documents"), for HR to follow up outside the system. Two sheets: one row per person with something
// missing, and one row per missing item, so HR can filter by the item in Excel (who still lacks a criminal record …).
// Written like the payroll register (payroll/register.ts): bold, frozen headers, column widths, an autofilter.

/** What the workbook shows of a person on the report (a row of GET /employees/missing). */
export interface MissingDetailsRow {
  employeeCode: string;
  fullNameEn: string;
  fullNameAr: string;
  standing: Standing;
  /** The current employment's department, or its team with the department; null when not employed or not placed. */
  department: { nameEn: string; parent: { nameEn: string } | null } | null;
  jobTitle: { titleEn: string } | null;
  percent: number;
  missing: readonly Missing[];
}

/** Each part of the checklist as the report names it, in the order of the profile's tabs. */
export const SECTION_LABELS: Record<Missing['tab'], string> = {
  basic: 'Basic data',
  education: 'Education',
  employment: 'Employment',
  documents: 'Documents',
};

const PERSONAL_SECTIONS = ['basic', 'education', 'employment'] as const satisfies readonly Missing['tab'][];

/** The missing personal details grouped by section: "Basic data: Mobile, City · Education: Faculty"; empty when none. */
export function personalDetailsText(missing: readonly Missing[]): string {
  return PERSONAL_SECTIONS.map((tab) => ({ tab, labels: missing.filter((m) => m.tab === tab).map((m) => m.label) }))
    .filter((s) => s.labels.length > 0)
    .map((s) => `${SECTION_LABELS[s.tab]}: ${s.labels.join(', ')}`)
    .join(' · ');
}

/** The missing papers: "Criminal record certificate, Personal photo"; empty when none. */
export function documentsText(missing: readonly Missing[]): string {
  return missing
    .filter((m) => m.tab === 'documents')
    .map((m) => m.label)
    .join(', ');
}

/** The name the workbook is saved under: "Missing details 2026-10-16.xlsx", with the day (Cairo) it was made. */
export const missingDetailsFileName = (today: string) => `Missing details ${today}.xlsx`;

/**
 * A column of a sheet: its header, width and each row's value. The Salary Raises and Contracts workbooks are written with
 * these too; a Date is a real Excel date (the Contracts report's, 25 October 2026), shown by its `numFmt`.
 */
export interface Column<T> {
  header: string;
  width: number;
  value: (row: T) => string | number | Date | null;
  /** A number format; text otherwise. */
  numFmt?: string;
  /** Long text, wrapped in its cell. */
  wrap?: boolean;
}

/** A missing item with its person, for the second sheet. */
interface ItemRow {
  person: MissingDetailsRow;
  item: Missing;
}

const PEOPLE_COLUMNS: readonly Column<MissingDetailsRow>[] = [
  { header: 'Code', width: 11, value: (r) => r.employeeCode },
  { header: 'Name (English)', width: 30, value: (r) => r.fullNameEn },
  { header: 'Name (Arabic)', width: 30, value: (r) => r.fullNameAr },
  { header: 'Department', width: 28, value: (r) => departmentName(r.department) },
  { header: 'Job title', width: 26, value: (r) => r.jobTitle?.titleEn ?? null },
  { header: 'Standing', width: 15, value: (r) => STANDING_LABELS[r.standing] },
  { header: 'Complete', width: 10, value: (r) => r.percent / 100, numFmt: '0%' },
  { header: 'Missing personal details', width: 70, value: (r) => personalDetailsText(r.missing) || null, wrap: true },
  { header: 'Missing documents', width: 50, value: (r) => documentsText(r.missing) || null, wrap: true },
];

const ITEM_COLUMNS: readonly Column<ItemRow>[] = [
  { header: 'Code', width: 11, value: (r) => r.person.employeeCode },
  { header: 'Name', width: 30, value: (r) => r.person.fullNameEn },
  { header: 'Section', width: 14, value: (r) => SECTION_LABELS[r.item.tab] },
  { header: 'Item', width: 36, value: (r) => r.item.label },
];

const THIN = { style: 'thin' } as const;

/** A sheet of `rows` under `columns`: the header bold and frozen, an autofilter over the header and the rows. */
export function addSheet<T>(wb: ExcelJS.Workbook, name: string, columns: readonly Column<T>[], rows: readonly T[]): ExcelJS.Worksheet {
  const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', xSplit: 0, ySplit: 1 }] });
  columns.forEach((c, i) => (ws.getColumn(i + 1).width = c.width));

  const header = ws.getRow(1);
  columns.forEach((c, i) => {
    const cell = header.getCell(i + 1);
    cell.value = c.header;
    cell.font = { name: 'Calibri', size: 11, bold: true };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } };
    cell.alignment = { vertical: 'middle', wrapText: true };
    cell.border = { left: THIN, right: THIN, top: THIN, bottom: THIN };
  });

  rows.forEach((row, i) => {
    const line = ws.getRow(i + 2);
    columns.forEach((c, j) => {
      const cell = line.getCell(j + 1);
      const value = c.value(row);
      if (value !== null) cell.value = value;
      cell.numFmt = c.numFmt ?? '@';
      cell.alignment = { vertical: 'top', ...(c.wrap && { wrapText: true }) };
    });
  });

  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: rows.length + 1, column: columns.length } };
  return ws;
}

/**
 * The report as an .xlsx: "Missing Details", one row per person with something missing (complete profiles are left
 * out), in the report's order (least complete first); "Each Missing Item", one row per missing item.
 */
export async function missingDetailsWorkbook(rows: readonly MissingDetailsRow[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const incomplete = rows.filter((r) => r.missing.length > 0);
  addSheet(wb, 'Missing Details', PEOPLE_COLUMNS, incomplete);
  addSheet(wb, 'Each Missing Item', ITEM_COLUMNS, incomplete.flatMap((person) => person.missing.map((item) => ({ person, item }))));
  return Buffer.from(await wb.xlsx.writeBuffer());
}
