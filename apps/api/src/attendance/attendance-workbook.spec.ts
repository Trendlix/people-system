import ExcelJS from 'exceljs';
import { attendanceDayView, attendanceFigures, attendanceSummary, NO_ATTENDANCE_FIGURES, type PersonMonthFigures } from '@trendlix/shared';
import { attendanceSummaryFileName, attendanceWorkbook, cairoTime, placeRows } from './attendance-workbook.js';
import type { AttendanceEmployeeView, AttendanceSummaryReport } from './attendance.service.js';

// The attendance Summary's workbook (owner's brief, 19 October 2026: "Summary … with Excel export, like the other
// reports"). Every name here is invented.

function rowsOf(ws: ExcelJS.Worksheet): unknown[][] {
  const rows: unknown[][] = [];
  ws.eachRow((r) => rows.push((r.values as unknown[]).slice(1)));
  return rows;
}

/** A time cell as hours: ExcelJS reads a time-formatted number back as a Date from 30/12/1899. */
const hoursOf = (v: unknown) => (v instanceof Date ? Math.round(((v.getTime() - Date.UTC(1899, 11, 30)) / 3_600_000) * 1e6) / 1e6 : v);

const employee = (id: string, fullNameEn: string, department: string | null): AttendanceEmployeeView => ({
  id,
  employeeCode: `EMP-${id}`,
  fullNameEn,
  jobTitle: null,
  department,
  departmentId: null,
  confidential: false,
});

describe('the attendance Summary workbook', () => {
  const field = { id: 't-field', nameEn: 'Field Team', parent: { id: 'd-sales', nameEn: 'Sales' } };
  const day = attendanceDayView(
    { date: '2026-09-01', status: 'worked', checkIn: '2026-09-01T07:23:00.000Z', checkOut: '2026-09-01T15:31:00.000Z', place: 'office', zohoStatus: 'Present', permissionHours: 0, hoursCounted: 8 + 8 / 60 },
    9,
  );
  const absent = attendanceDayView({ date: '2026-09-02', status: 'absent', checkIn: null, checkOut: null, place: null, zohoStatus: 'Absent', permissionHours: 0, hoursCounted: 0 }, 9);
  const figures = attendanceFigures([day, absent]);
  const rania = employee('1', 'Rania Invented', 'Sales › Field Team');
  const rows: (PersonMonthFigures & { employee: AttendanceEmployeeView })[] = [
    { employeeId: '1', month: '2026-09', place: field, figures, employee: rania },
    { employeeId: '2', month: '2026-09', place: null, figures: { ...NO_ATTENDANCE_FIGURES, daysRecorded: 1, absentDays: 1 }, employee: employee('2', 'Nobody Placed', null) },
  ];
  const { groups, totals } = attendanceSummary(rows, [
    { id: 'd-sales', nameEn: 'Sales', parentId: null },
    { id: 't-field', nameEn: 'Field Team', parentId: 'd-sales' },
  ]);
  const report: AttendanceSummaryReport = { generatedAt: '2026-10-19T10:00:00.000Z', period: { from: '2026-09', to: '2026-09' }, months: ['2026-09'], groups, totals, hidden: null, rows };

  it('is named with its month or months', () => {
    expect(attendanceSummaryFileName({ from: '2026-10', to: '2026-10' })).toBe('Attendance 2026-10.xlsx');
    expect(attendanceSummaryFileName({ from: '2026-01', to: '2026-06' })).toBe('Attendance 2026-01 to 2026-06.xlsx');
  });

  it('lists each department, then its teams, those without one as No department', () => {
    expect(placeRows(report).map((r) => [r.department, r.team, r.row.people])).toEqual([
      ['Sales', null, 1],
      ['Sales', 'Field Team', 1],
      ['No department', null, 1],
    ]);
  });

  it('has By Department and Team (with the totals), By Person and Days, hours as Excel times', async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await attendanceWorkbook(report, [{ month: '2026-09', employee: rania, day }, { month: '2026-09', employee: rania, day: absent }])) as never);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['By Department and Team', 'By Person', 'Days']);

    const places = rowsOf(wb.getWorksheet('By Department and Team')!);
    expect(places[0].slice(0, 7)).toEqual(['Department', 'Team', 'People', 'Person-months', 'Days worked', 'Hours counted', 'Average a day']);
    expect(places[1].slice(0, 5)).toEqual(['Sales', undefined, 1, 1, 1]);
    expect(hoursOf(places[1][5])).toBeCloseTo(8 + 8 / 60, 5);
    expect(places.at(-1)?.slice(0, 4)).toEqual(['All', undefined, 2, 2]);
    expect(wb.getWorksheet('By Department and Team')!.getCell('F2').numFmt).toBe('[h]:mm');
    // the short hours filled by extra time (make-up hours, 20 October 2026), after the short hours
    expect(places[0].slice(8, 11)).toEqual(['Short hours', 'Short hours filled by extra time', 'Permission hours']);

    const people = rowsOf(wb.getWorksheet('By Person')!);
    expect(people[1].slice(0, 5)).toEqual(['September 2026', 'EMP-1', 'Rania Invented', 'Sales', 'Field Team']);

    const days = rowsOf(wb.getWorksheet('Days')!);
    expect(days[0]).toEqual(['Date', 'Code', 'Name', 'Department', 'What it was', 'Check-in', 'Check-out', 'Hours counted', 'Short hours', 'Where', 'Permission hours', 'Zoho says', 'From', 'Flagged', 'Pairs', 'Break', 'Exempt']);
    expect(days[1].slice(0, 7)).toEqual(['01/09/2026', 'EMP-1', 'Rania Invented', 'Sales › Field Team', 'Worked', '10:23 AM', '6:31 PM']);
    // 9 − 8:08 short
    expect(hoursOf(days[1][8])).toBeCloseTo(52 / 60, 5);
    expect(days[2].slice(4, 8)).toEqual(['Absent', undefined, undefined, undefined]);
    // a day kept before the check-ins on the system is Zoho's
    expect(days[1].slice(12)).toEqual(['Zoho People']);
  });

  it('says where a day came from and its flags: a check-in on the system outside the office on an office day', async () => {
    const wb = new ExcelJS.Workbook();
    const flagged = attendanceDayView({ ...day, place: 'unknown', source: 'system', flags: ['outside_office'] }, 9);
    await wb.xlsx.load((await attendanceWorkbook(report, [{ month: '2026-09', employee: rania, day: flagged }])) as never);
    const days = rowsOf(wb.getWorksheet('Days')!);
    expect(days[1][9]).toBe('Location unknown');
    expect(days[1].slice(12)).toEqual(['Checked in on the system', 'Checked in outside the office on an office day']);
  });

  it('writes times in Cairo, 12-hour', () => {
    expect(cairoTime('2026-11-15T07:05:00.000Z')).toBe('9:05 AM');
    expect(cairoTime(null)).toBeNull();
  });
});
