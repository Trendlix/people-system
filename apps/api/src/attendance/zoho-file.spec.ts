import ExcelJS from 'exceljs';
import { OFFICE_ADDRESS_DEFAULTS } from '@trendlix/shared';
import { officeAt, ZOHO_HOME, zohoWorkbook } from '../../test/fixtures/zoho.js';
import { personKey, readZohoWorkbook, zohoDay, zohoHours, zohoMoment, ZohoFileError } from './zoho-file.js';

// Reading Zoho People's attendance entries (owner, 19 October 2026: "Import Zoho now, replace it later"): a made-up
// workbook laid out as Zoho's export is (test/fixtures/zoho.ts); every person and place is invented.

const SEPTEMBER = [
  { date: '2026-09-01', in: '10:23', out: '18:31' },
  { date: '2026-09-02', in: '09:40', out: '19:20', inLocation: officeAt(17) },
  { date: '2026-09-03', in: '11:00', out: '17:00', inLocation: ZOHO_HOME, outLocation: ZOHO_HOME, permission: '01:30' },
  { date: '2026-09-04', status: 'Weekend' },
  { date: '2026-09-06', status: 'Annual Leave' },
  { date: '2026-09-07', status: 'Absent' },
];

describe('readZohoWorkbook', () => {
  it('reads each person’s day: the day, the times on Cairo’s clock, office or remote, the status, the permission', async () => {
    const file = await zohoWorkbook([
      { id: '701', name: 'Rania Invented Sample', days: SEPTEMBER },
      { id: '702', name: 'Omar Madeup', days: [{ date: '2026-09-01', in: '09:00', out: '18:00', inLocation: officeAt(13) }] },
    ]);
    const r = await readZohoWorkbook(file, OFFICE_ADDRESS_DEFAULTS);
    expect(r.sheet).toBe('Attendance(Hours)');
    expect(r.problems).toEqual([]);
    expect(r.rows).toHaveLength(7);
    expect(r.rows[0]).toEqual({
      row: 2,
      zohoId: '701',
      name: 'Rania Invented Sample',
      date: '2026-09-01',
      // 10:23 in Cairo, on summer time (UTC+3) in September 2026
      checkIn: '2026-09-01T07:23:00.000Z',
      checkOut: '2026-09-01T15:31:00.000Z',
      place: 'office',
      zohoStatus: 'Present',
      permissionHours: 0,
    });
    expect(r.rows.map((x) => x.place)).toEqual(['office', 'office', 'remote', null, null, null, 'office']);
    expect(r.rows[2].permissionHours).toBe(1.5);
    expect(r.rows.slice(3, 6).map((x) => [x.checkIn, x.zohoStatus])).toEqual([
      [null, 'Weekend'],
      [null, 'Annual Leave'],
      [null, 'Absent'],
    ]);
    expect(new Set(r.rows.map(personKey))).toEqual(new Set(['id:701', 'id:702']));
  });

  it('finds the headings in any order, the first sheet when there is no Hours sheet, and leaves out the Total row', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Export');
    ws.addRow(['Attendance entries, September 2026']);
    ws.addRow(['Status', 'Date', 'Employee Name', 'Last Check-Out', 'First Check-In']);
    ws.addRow(['Present', '01-Sep-2026', 'Lina Invented', '06:30 PM', '09:15 AM']);
    ws.addRow(['', '', 'Total', '', '']);
    const r = await readZohoWorkbook(Buffer.from(await wb.xlsx.writeBuffer()), OFFICE_ADDRESS_DEFAULTS);
    expect(r.sheet).toBe('Export');
    expect(r.rows).toEqual([
      expect.objectContaining({ zohoId: null, name: 'Lina Invented', date: '2026-09-01', checkIn: '2026-09-01T06:15:00.000Z', checkOut: '2026-09-01T15:30:00.000Z', place: null }),
    ]);
    expect(r.problems).toEqual([{ row: 4, message: "Row 4: the day isn't a date, e.g. 01-Sep-2026. The row is left out." }]);
    expect(personKey(r.rows[0])).toBe('name:lina invented');
  });

  it('refuses a file that isn’t Zoho’s workbook, in words HR act on', async () => {
    await expect(readZohoWorkbook(Buffer.from('Employee Name,Date\n'), OFFICE_ADDRESS_DEFAULTS)).rejects.toThrow(ZohoFileError);
    await expect(readZohoWorkbook(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]), OFFICE_ADDRESS_DEFAULTS)).rejects.toThrow(/old Excel file/);
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('Sheet1').addRow(['Name', 'Amount']);
    await expect(readZohoWorkbook(Buffer.from(await wb.xlsx.writeBuffer()), OFFICE_ADDRESS_DEFAULTS)).rejects.toThrow(/doesn't have Zoho's headings/);
    const empty = await zohoWorkbook([]);
    await expect(readZohoWorkbook(empty, OFFICE_ADDRESS_DEFAULTS)).rejects.toThrow('has no days under its headings.');
  });
});

describe('Zoho’s cells', () => {
  it('reads a day as Zoho writes it, as a date, or as DD/MM/YYYY', () => {
    expect(zohoDay('01-Sep-2026')).toBe('2026-09-01');
    expect(zohoDay('2026-09-30')).toBe('2026-09-30');
    expect(zohoDay('30/09/2026')).toBe('2026-09-30');
    expect(zohoDay(new Date('2026-09-05T00:00:00Z'))).toBe('2026-09-05');
    expect(zohoDay('31-Sep-2026')).toBeNull();
    expect(zohoDay('Total')).toBeNull();
  });

  it('reads a time on Cairo’s clock, with or without its day', () => {
    expect(zohoMoment('01-Sep-2026 10:23 AM', '2026-09-01')).toBe('2026-09-01T07:23:00.000Z');
    expect(zohoMoment('6:05 PM', '2026-12-01')).toBe('2026-12-01T16:05:00.000Z');
    expect(zohoMoment('', '2026-09-01')).toBeNull();
    expect(zohoMoment('-', '2026-09-01')).toBeNull();
    expect(zohoMoment('13:00 PM', '2026-09-01')).toBeNull();
  });

  it('reads the permission as HH:MM or hours', () => {
    expect(zohoHours('01:30')).toBe(1.5);
    expect(zohoHours('00:00')).toBe(0);
    expect(zohoHours('-')).toBe(0);
    expect(zohoHours(2)).toBe(2);
  });

  it('takes the check-out’s place when the check-in has none', async () => {
    const r = await readZohoWorkbook(await zohoWorkbook([{ id: '9', name: 'Invented', days: [{ date: '2026-09-01', in: '09:00', out: '18:00', inLocation: '-', outLocation: ZOHO_HOME }] }]), OFFICE_ADDRESS_DEFAULTS);
    expect(r.rows[0].place).toBe('remote');
  });
});
