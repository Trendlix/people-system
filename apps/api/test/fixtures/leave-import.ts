import ExcelJS from 'exceljs';

// Leave files for the tests (owner, 21 October 2026: "how to import bulk leaves?"): the system's template filled in, and
// Zoho People's leave export laid out as Zoho writes it (the owner's sample: one sheet, the headings in row 1, a row a
// leave with its ZOHO_LINK_ID, "<name> <Zoho number>" as Employee ID, From and To as dates, Days/Hours Taken as text like
// "1.0 ", Unit "Day ", the Approval Status and each day's duration). Everyone, every number and every reason here is
// invented: nothing of the owner's file is copied.

/** A row of the template's Leaves taken: a date as YYYY-MM-DD is written as an Excel date, any other text as it is. */
export interface TemplateLeave {
  code?: string;
  name?: string;
  type: string;
  from: string;
  to: string;
  days?: number;
  notes?: string;
}

export interface TemplateBalance {
  code?: string;
  name?: string;
  type?: string;
  balance: number | string;
  asOf: string;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const asCell = (v: string) => (ISO.test(v) ? new Date(`${v}T00:00:00.000Z`) : v);

/** The template filled in: Leaves taken and Balances, their headings in row 1 (either sheet may be left out). */
export async function templateWorkbook(leaves: readonly TemplateLeave[] | null, balances: readonly TemplateBalance[] | null = null): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  if (leaves) {
    const ws = wb.addWorksheet('Leaves taken');
    ws.addRow(['Employee code', 'Employee name', 'Leave type', 'From', 'To', 'Days', 'Notes']);
    for (const l of leaves) ws.addRow([l.code ?? '', l.name ?? '', l.type, asCell(l.from), asCell(l.to), l.days ?? null, l.notes ?? '']);
  }
  if (balances) {
    const ws = wb.addWorksheet('Balances');
    ws.addRow(['Employee code', 'Employee name', 'Leave type', 'Balance in days', 'As of']);
    for (const b of balances) ws.addRow([b.code ?? '', b.name ?? '', b.type ?? 'Annual leave', b.balance, asCell(b.asOf)]);
  }
  wb.addWorksheet('How to fill').addRow(['Importing Leave']);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export const ZOHO_LEAVE_HEADINGS = [
  'ZOHO_LINK_ID',
  'Employee ID',
  'Leave type',
  'From',
  'To',
  'Days/Hours Taken',
  'Reason for leave',
  'Added By',
  'Added Time',
  'Modified By',
  'Modified Time',
  'Unit',
  'File upload',
  'Approval Status',
  'Approver',
  'Approval Time',
  'Type',
  'Date - Duration and Session',
  'Reason for cancellation',
] as const;

/** A day of a Zoho leave: a full day, a half day (its session), or a holiday or weekend. */
export interface ZohoLeaveDayIn {
  date: string;
  duration: 'Full Day' | 'Half Day' | 'Holiday/Weekend';
  session?: '1st Half' | '2nd Half';
}

/** A made-up Zoho leave: who ("<name> <number>"), the type, the status and each day. */
export interface ZohoLeaveIn {
  linkId: string;
  employee: string;
  type: string;
  status: 'Approved' | 'System Approved' | 'Pending' | 'Rejected' | 'Cancelled';
  days: ZohoLeaveDayIn[];
  reason?: string;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** 2026-10-21 → 21-Oct-2026, as Zoho writes a day. */
const zohoDate = (ymd: string) => `${ymd.slice(8, 10)}-${MONTHS[Number(ymd.slice(5, 7)) - 1]}-${ymd.slice(0, 4)}`;

/** Zoho People's leave export as a Buffer: its one sheet, the headings in row 1. */
export async function zohoLeaveWorkbook(leaves: readonly ZohoLeaveIn[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet - 1');
  ws.addRow([...ZOHO_LEAVE_HEADINGS]);
  for (const l of leaves) {
    const dates = l.days.map((d) => d.date).sort((x, y) => x.localeCompare(y));
    const taken = l.days.reduce((n, d) => n + (d.duration === 'Full Day' ? 1 : d.duration === 'Half Day' ? 0.5 : 0), 0);
    ws.addRow([
      l.linkId,
      l.employee,
      l.type,
      new Date(`${dates[0]}T00:00:00.000Z`),
      new Date(`${dates[dates.length - 1]}T00:00:00.000Z`),
      `${taken.toFixed(1)} `,
      l.reason ?? '',
      '1 - Invented Approver - X',
      new Date('2026-01-05T08:00:00.000Z'),
      '1 - Invented Approver - X',
      new Date('2026-01-05T08:00:00.000Z'),
      'Day ',
      '',
      l.status,
      'Invented Approver',
      new Date('2026-01-05T09:00:00.000Z'),
      /compensatory/i.test(l.type) ? 'Compensatory off' : 'Paid',
      l.days.map((d) => `{Date:${zohoDate(d.date)},Duration:${d.duration}${d.session ? `,Session:${d.session}` : ''}}`).join(','),
      l.status === 'Cancelled' ? 'Invented reason' : '',
    ]);
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
