import ExcelJS from 'exceljs';
import { CLIENT_HOURS_STATUS_LABELS, hiddenPeopleNote, NO_CLIENT_LABEL, type ClientHoursLine, type ClientHoursReport } from '@trendlix/shared';
import { excelDate, fitted } from '../contracts/contracts-report-workbook.js';
import { addSheet, type Column } from '../employees/missing-workbook.js';

// Client hours as an Excel workbook (owner, 4 November 2026: "Full salary, hours tracked": the hours kept for the
// clients), to bill or check the clients outside the system. Two sheets: "Summary", a row per person on each client
// with their approved hours, those waiting for approval and both, each client's total in bold after its people, "No
// client (tasks only)" last, and the month's total; "Lines", every line of the month (its day, who, the client, the
// task, the hours, the note, where its week stands), to filter or pivot. Dates are real Excel dates shown DD/MM/YYYY,
// hours numbers to the hundredth. Written with the Contracts report's helpers.

const DATE = 'dd/mm/yyyy';
const HOURS = '0.00';
const COUNT = '0';
const BOLD = { name: 'Calibri', size: 11, bold: true } as const;

/** "Client hours 2026-11.xlsx". */
export const clientHoursFileName = (month: string) => `Client hours ${month}.xlsx`;

const both = (approved: number, waiting: number) => Math.round((approved + waiting) * 100) / 100;

/** A row of the Summary: a person on a client, a client's total, the month's total, or a note. */
interface SummaryRow {
  kind: 'person' | 'client' | 'total' | 'note';
  client: string;
  clientCode: string | null;
  employeeCode: string | null;
  employee: string | null;
  people: number | null;
  approved: number | null;
  waiting: number | null;
}

const SUMMARY_COLUMNS: readonly Column<SummaryRow>[] = [
  { header: 'Client', width: 24, value: (r) => r.client },
  { header: 'Client code', width: 11, value: (r) => r.clientCode },
  { header: 'Employee code', width: 13, value: (r) => r.employeeCode },
  { header: 'Employee', width: 24, value: (r) => r.employee },
  { header: 'People', width: 8, value: (r) => r.people, numFmt: COUNT },
  { header: 'Approved hours', width: 10, value: (r) => r.approved, numFmt: HOURS },
  { header: 'Waiting for approval', width: 10, value: (r) => r.waiting, numFmt: HOURS },
  { header: 'Total hours', width: 10, value: (r) => (r.approved === null || r.waiting === null ? null : both(r.approved, r.waiting)), numFmt: HOURS },
];

const LINE_COLUMNS: readonly Column<ClientHoursLine>[] = [
  { header: 'Date', width: 11, value: (l) => excelDate(l.date), numFmt: DATE },
  { header: 'Employee code', width: 13, value: (l) => l.employee.employeeCode },
  { header: 'Employee', width: 24, value: (l) => l.employee.fullNameEn },
  { header: 'Client', width: 24, value: (l) => l.client?.name ?? NO_CLIENT_LABEL },
  { header: 'Client code', width: 11, value: (l) => l.client?.code ?? null },
  { header: 'Task', width: 20, value: (l) => l.task },
  { header: 'Hours', width: 8, value: (l) => l.hours, numFmt: HOURS },
  { header: 'Note', width: 30, value: (l) => l.note, wrap: true },
  { header: 'Status', width: 20, value: (l) => CLIENT_HOURS_STATUS_LABELS[l.status] ?? l.status },
];

/** The Summary's rows: each client's people then its total, the month's total, and who isn't shown. */
export function summaryRows(report: ClientHoursReport): SummaryRow[] {
  const rows: SummaryRow[] = [];
  for (const g of report.groups) {
    const client = g.client?.name ?? NO_CLIENT_LABEL;
    const clientCode = g.client?.code ?? null;
    for (const p of g.people) {
      rows.push({ kind: 'person', client, clientCode, employeeCode: p.employee.employeeCode, employee: p.employee.fullNameEn, people: null, approved: p.approved, waiting: p.waiting });
    }
    rows.push({ kind: 'client', client: `Total: ${client}`, clientCode, employeeCode: null, employee: null, people: g.people.length, approved: g.approved, waiting: g.waiting });
  }
  rows.push({ kind: 'total', client: 'Total', clientCode: null, employeeCode: null, employee: null, people: report.total.people, approved: report.total.approved, waiting: report.total.waiting });
  const note = hiddenPeopleNote(report.hiddenPeople);
  if (note) rows.push({ kind: 'note', client: note, clientCode: null, employeeCode: null, employee: null, people: null, approved: null, waiting: null });
  return rows;
}

/** The month's summary and lines as an .xlsx. */
export async function clientHoursWorkbook(report: ClientHoursReport, lines: readonly ClientHoursLine[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const rows = summaryRows(report);
  const summary = addSheet(wb, 'Summary', fitted(SUMMARY_COLUMNS, rows), rows);
  rows.forEach((r, i) => {
    if (r.kind !== 'client' && r.kind !== 'total') return;
    summary.getRow(i + 2).eachCell({ includeEmpty: true }, (cell) => (cell.font = BOLD));
  });
  addSheet(wb, 'Lines', fitted(LINE_COLUMNS, lines), lines);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
