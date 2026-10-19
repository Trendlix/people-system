import ExcelJS from 'exceljs';

// Zoho People's attendance entries export for the tests, laid out as Zoho writes it (owner's brief, 19 October 2026):
// the sheets "Attendance(Hours)" and "Attendance(Decimal)", the headings in row 1, a row per person and day (the day as
// 01-Sep-2026, the first check-in and last check-out as Excel date-times on Cairo's clock, the locations, the hours as
// HH:MM, the status, the shift) and a Total row. Everyone and every place here is invented.

export const ZOHO_HEADINGS = [
  'Employee Id',
  'Employee Name',
  'Date',
  'First Check-In',
  'Last Check-Out',
  'Check-in Notes',
  'Check-out Notes',
  'Check-in Location',
  'Check-out Location',
  'Total Hours',
  'Total paid break',
  'Total unpaid break',
  'Permission',
  'Payable Hours',
  'Office In Hours',
  'Remote In Hours',
  'Status',
  'Office In/Remote In',
  'Shift(s)',
  'Reason',
  'Description',
] as const;

/** A day of a made-up person: times as HH:MM on Cairo's clock (none: no check-in), the place, Zoho's status. */
export interface ZohoTestDay {
  date: string;
  in?: string;
  out?: string;
  inLocation?: string;
  outLocation?: string;
  status?: string;
  /** Zoho's Permission that day, HH:MM. */
  permission?: string;
}

export interface ZohoTestPerson {
  id: string;
  name: string;
  days: ZohoTestDay[];
}

/** An office address as Zoho writes it, of the office's street number given (13, 15 or 17 are the office's). */
export const officeAt = (n: number) => `${n}, Al Doctor Al Mahrouqi Street, El Golf, Nasr City, Cairo, 11765, Egypt`;
export const ZOHO_OFFICE = `Trendlix, ${officeAt(15)}`;
export const ZOHO_HOME = '42, Invented Street, Sheraton, Cairo, Egypt';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** 2026-09-01 → 01-Sep-2026, as Zoho writes the day. */
export const zohoDate = (ymd: string) => `${ymd.slice(8, 10)}-${MONTHS[Number(ymd.slice(5, 7)) - 1]}-${ymd.slice(0, 4)}`;
/** A time on a day as exceljs gives an Excel date-time back: the sheet's clock as UTC. */
const excelTime = (ymd: string, hhmm: string) => new Date(`${ymd}T${hhmm}:00.000Z`);

/** The workbook, as a Buffer: everyone's rows on the Hours sheet (and a copy on the Decimal one), then the Total row. */
export async function zohoWorkbook(people: readonly ZohoTestPerson[], sheetName = 'Attendance(Hours)'): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  for (const name of [sheetName, 'Attendance(Decimal)']) {
    const ws = wb.addWorksheet(name);
    ws.addRow([...ZOHO_HEADINGS]);
    for (const p of people) {
      for (const d of p.days) {
        const row = ws.addRow([
          p.id,
          p.name,
          zohoDate(d.date),
          d.in ? excelTime(d.date, d.in) : '',
          d.out ? excelTime(d.date, d.out) : '',
          '',
          '',
          d.inLocation ?? (d.in ? ZOHO_OFFICE : '-'),
          d.outLocation ?? (d.out ? ZOHO_OFFICE : '-'),
          '08:00',
          '00:00',
          '00:00',
          d.permission ?? '00:00',
          '08:00',
          '-',
          '-',
          d.status ?? (d.in ? 'Present' : 'Absent'),
          d.in ? 'Office In' : '',
          'Morning Shift (10:00 AM - 07:00 PM)',
          null,
          null,
        ]);
        for (const c of [4, 5]) row.getCell(c).numFmt = 'dd-MMM-yyyy HH:MM AM/PM';
      }
    }
    ws.addRow(['', '', '', '', '', '', '', '', 'Total', '160:00', '00:00', '00:00', '04:00', '176:00']);
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
