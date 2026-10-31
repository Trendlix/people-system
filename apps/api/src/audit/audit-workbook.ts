import ExcelJS from 'exceljs';
import { addSheet, type Column } from '../employees/missing-workbook.js';
import type { SignInView } from './audit-sign-ins.js';
import { changeText, type AuditEntryView, type AuditFrom } from './audit-view.js';

// The Audit Log as an Excel workbook (owner, 19 October 2026: "an Audit Log page showing who changed what and when"),
// with the page's filters, newest first, up to EXPORT_LIMIT entries: one row per entry, its changes one per line in a
// cell. Written like the other reports (missing-workbook.ts): bold, frozen headers, an autofilter. A second sheet says
// what was asked and how many entries there were, and when the workbook leaves the oldest out.

/** The most entries one workbook holds: the newest, when more match. */
export const EXPORT_LIMIT = 10_000;

/**
 * Where an entry came from (owner, 31 October 2026: "with location and ip capture"), as columns: the address, the place,
 * the browser or app, and the phone's position from the app (its latitude and longitude, accuracy and whether the
 * phone said it was made up).
 */
function fromColumns<T>(from: (row: T) => AuditFrom): Column<T>[] {
  return [
    { header: 'IP address', width: 18, value: (r) => from(r).ip },
    { header: 'Address from', width: 14, value: (r) => (from(r).ipSource === 'website' ? 'Website (signed)' : from(r).ipSource === 'connection' ? 'Connection' : null) },
    { header: 'Location', width: 24, value: (r) => from(r).place },
    { header: 'Region', width: 10, value: (r) => from(r).region },
    { header: 'Browser or app', width: 30, value: (r) => from(r).browser },
    { header: 'Latitude', width: 12, value: (r) => from(r).location?.latitude ?? null, numFmt: '0.000000' },
    { header: 'Longitude', width: 12, value: (r) => from(r).location?.longitude ?? null, numFmt: '0.000000' },
    { header: 'Accuracy (m)', width: 12, value: (r) => from(r).location?.accuracyMetres ?? null },
    { header: 'Made-up position', width: 16, value: (r) => (from(r).location ? (from(r).location!.mock ? 'Yes' : 'No') : null) },
    { header: 'User agent', width: 40, value: (r) => from(r).userAgent },
  ];
}

const COLUMNS: readonly Column<AuditEntryView>[] = [
  { header: 'When', width: 21, value: (e) => e.when },
  { header: 'Who', width: 32, value: (e) => e.who.text },
  { header: 'Email', width: 30, value: (e) => e.who.user?.email ?? null },
  { header: 'Result', width: 11, value: (e) => e.resultLabel },
  { header: 'Module', width: 18, value: (e) => e.moduleLabel },
  { header: 'Action', width: 28, value: (e) => e.actionLabel },
  { header: 'Record', width: 24, value: (e) => e.entityLabel },
  { header: 'Reference', width: 22, value: (e) => e.reference },
  { header: 'Employee code', width: 14, value: (e) => e.employee?.employeeCode ?? null },
  { header: 'Employee', width: 28, value: (e) => e.employee?.fullNameEn ?? null },
  { header: 'Changes', width: 80, value: (e) => e.changes.map(changeText).join('\n') || null, wrap: true },
  ...fromColumns<AuditEntryView>((e) => e.from),
  { header: 'Action key', width: 20, value: (e) => e.action },
  { header: 'Record type', width: 22, value: (e) => e.entityType },
  { header: 'Record ID', width: 38, value: (e) => e.entityId },
  { header: 'Entry', width: 10, value: (e) => Number(e.id) },
];

/** The Sign-ins tab's columns (31 October 2026). */
const SIGN_IN_COLUMNS: readonly Column<SignInView>[] = [
  { header: 'When', width: 21, value: (e) => e.when },
  { header: 'Email', width: 32, value: (e) => e.email },
  { header: 'Name', width: 26, value: (e) => e.user?.name ?? null },
  { header: 'Outcome', width: 20, value: (e) => e.outcomeLabel },
  { header: 'How', width: 18, value: (e) => e.methodLabel },
  ...fromColumns<SignInView>((e) => e.from),
  { header: 'Entry', width: 10, value: (e) => Number(e.id) },
];

/** A filter as the About sheet says it. */
export interface FilterLine {
  label: string;
  value: string;
}

/** "Audit log 2026-10-19.xlsx", with the day (Cairo) it was made. */
export const auditLogFileName = (today: string) => `Audit log ${today}.xlsx`;

/** "Sign-ins 2026-10-31.xlsx", with the day (Cairo) it was made. */
export const signInsFileName = (today: string) => `Sign-ins ${today}.xlsx`;

/** The workbook: the entries (newest first), then what was asked, as of when (`made`, already in words). */
export async function auditLogWorkbook(entries: readonly AuditEntryView[], total: number, filters: readonly FilterLine[], made: string): Promise<Buffer> {
  return workbookOf('Audit Log', COLUMNS, entries, total, filters, made);
}

/** The Sign-ins tab's workbook, the same way. */
export async function signInsWorkbook(entries: readonly SignInView[], total: number, filters: readonly FilterLine[], made: string): Promise<Buffer> {
  return workbookOf('Sign-ins', SIGN_IN_COLUMNS, entries, total, filters, made);
}

async function workbookOf<T>(name: string, columns: readonly Column<T>[], entries: readonly T[], total: number, filters: readonly FilterLine[], made: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  addSheet(wb, name, columns, entries);
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
