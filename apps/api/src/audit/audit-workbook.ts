import ExcelJS from 'exceljs';
import { addSheet, type Column } from '../employees/missing-workbook.js';
import { changeText, type AuditEntryView } from './audit-view.js';

// The Audit Log as an Excel workbook (owner, 19 October 2026: "an Audit Log page showing who changed what and when"),
// with the page's filters, newest first, up to EXPORT_LIMIT entries: one row per entry, its changes one per line in a
// cell. Written like the other reports (missing-workbook.ts): bold, frozen headers, an autofilter. A second sheet says
// what was asked and how many entries there were, and when the workbook leaves the oldest out.

/** The most entries one workbook holds: the newest, when more match. */
export const EXPORT_LIMIT = 10_000;

const COLUMNS: readonly Column<AuditEntryView>[] = [
  { header: 'When', width: 21, value: (e) => e.when },
  { header: 'Who', width: 32, value: (e) => e.who.text },
  { header: 'Email', width: 30, value: (e) => e.who.user?.email ?? null },
  { header: 'Action', width: 28, value: (e) => e.actionLabel },
  { header: 'Record', width: 24, value: (e) => e.entityLabel },
  { header: 'Reference', width: 22, value: (e) => e.reference },
  { header: 'Employee code', width: 14, value: (e) => e.employee?.employeeCode ?? null },
  { header: 'Employee', width: 28, value: (e) => e.employee?.fullNameEn ?? null },
  { header: 'Changes', width: 80, value: (e) => e.changes.map(changeText).join('\n') || null, wrap: true },
  { header: 'Action key', width: 20, value: (e) => e.action },
  { header: 'Record type', width: 22, value: (e) => e.entityType },
  { header: 'Record ID', width: 38, value: (e) => e.entityId },
  { header: 'Entry', width: 10, value: (e) => Number(e.id) },
];

/** A filter as the About sheet says it. */
export interface FilterLine {
  label: string;
  value: string;
}

/** "Audit log 2026-10-19.xlsx", with the day (Cairo) it was made. */
export const auditLogFileName = (today: string) => `Audit log ${today}.xlsx`;

/** The workbook: the entries (newest first), then what was asked, as of when (`made`, already in words). */
export async function auditLogWorkbook(entries: readonly AuditEntryView[], total: number, filters: readonly FilterLine[], made: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  addSheet(wb, 'Audit Log', COLUMNS, entries);
  const about: FilterLine[] = [
    { label: 'Made', value: made },
    { label: 'Entries', value: entries.length < total ? `The newest ${entries.length.toLocaleString('en-US')} of ${total.toLocaleString('en-US')}` : String(total) },
    ...(filters.length ? filters : [{ label: 'Filters', value: 'None: every entry' }]),
  ];
  addSheet(
    wb,
    'About',
    [
      { header: 'What', width: 18, value: (l: FilterLine) => l.label },
      { header: 'Value', width: 70, value: (l: FilterLine) => l.value, wrap: true },
    ],
    about,
  );
  return Buffer.from(await wb.xlsx.writeBuffer());
}
