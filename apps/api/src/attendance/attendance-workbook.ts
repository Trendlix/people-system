import ExcelJS from 'exceljs';
import {
  ATTENDANCE_DAY_STATUS_LABELS,
  ATTENDANCE_SOURCE_LABELS,
  CHECK_IN_FLAG_LABELS,
  CHECK_IN_PLACE_LABELS,
  EXEMPT_BADGE,
  openPressText,
  pairsText,
  type AttendanceDayView,
  type AttendanceFigures,
  type AttendanceSource,
  type AttendanceSummaryRow,
} from '@trendlix/shared';
import { addSheet, type Column } from '../employees/missing-workbook.js';
import { monthName } from '../payroll/months.js';
import type { AttendanceEmployeeView, AttendanceSummaryReport } from './attendance.service.js';

// The attendance Summary as an Excel workbook (owner's brief, 19 October 2026: "Summary … with Excel export, like the
// other reports"): By Department and Team (each department with its teams' people, then each team), By Person (each
// person's month) and Days (every day kept), written like the other reports (missing-workbook.ts addSheet: bold, frozen
// headers, an autofilter). Hours are Excel times ([h]:mm), dates DD/MM/YYYY and times 12-hour, as the screens show them.

/** The name it is saved under: "Attendance 2026-10.xlsx", "Attendance 2026-01 to 2026-06.xlsx". */
export const attendanceSummaryFileName = (p: { from: string; to: string }) => (p.from === p.to ? `Attendance ${p.from}.xlsx` : `Attendance ${p.from} to ${p.to}.xlsx`);

/** Hours as Excel keeps a time: a fraction of a day, shown [h]:mm. */
const asTime = (hours: number | null) => (hours === null ? null : hours / 24);
const HOURS = '[h]:mm';

const CAIRO_TIME = new Intl.DateTimeFormat('en-US', { timeZone: 'Africa/Cairo', hour: 'numeric', minute: '2-digit', hour12: true });
/** A moment's time in Cairo, 12-hour: "10:23 AM". */
export const cairoTime = (iso: string | null) => (iso ? CAIRO_TIME.format(new Date(iso)) : null);
/** "2026-10-18" → "18/10/2026". */
const shownDate = (ymd: string) => ymd.split('-').reverse().join('/');

/** The figures' columns, after each sheet's own. */
function figureColumns<T>(f: (row: T) => AttendanceFigures, average: (row: T) => number | null): Column<T>[] {
  return [
    { header: 'Days worked', width: 11, value: (r) => f(r).daysWorked, numFmt: '0' },
    { header: 'Hours counted', width: 13, value: (r) => asTime(f(r).hoursCounted), numFmt: HOURS },
    { header: 'Average a day', width: 12, value: (r) => asTime(average(r)), numFmt: HOURS },
    { header: 'Absent days', width: 11, value: (r) => f(r).absentDays, numFmt: '0' },
    { header: 'Short hours', width: 11, value: (r) => asTime(f(r).shortHours), numFmt: HOURS },
    // make-up hours (owner, 20 October 2026: "within the same month"): the short hours a month's extra time filled
    { header: 'Short hours filled by extra time', width: 16, value: (r) => asTime(f(r).shortHoursFilled), numFmt: HOURS },
    { header: 'Permission hours', width: 14, value: (r) => asTime(f(r).permissionHours), numFmt: HOURS },
    { header: 'Office days', width: 10, value: (r) => f(r).officeDays, numFmt: '0' },
    { header: 'Remote days', width: 11, value: (r) => f(r).remoteDays, numFmt: '0' },
    { header: 'Leave days', width: 10, value: (r) => f(r).leaveDays, numFmt: '0' },
    { header: 'Leave in Zoho only', width: 15, value: (r) => f(r).zohoLeaveDays, numFmt: '0' },
    { header: 'Missing check-outs', width: 15, value: (r) => f(r).missingCheckOuts, numFmt: '0' },
    // checking in on the system (19 October 2026): a check-out without a check-in, and the check-ins flagged
    { header: 'Missing check-ins', width: 14, value: (r) => f(r).missingCheckIns, numFmt: '0' },
    { header: 'Flagged days', width: 12, value: (r) => f(r).flaggedDays, numFmt: '0' },
    // people exempt from check-in (owner, 25 October 2026): their days counted as full
    { header: 'Exempt days', width: 11, value: (r) => f(r).exemptDays ?? 0, numFmt: '0' },
    { header: 'Compensatory days off', width: 14, value: (r) => f(r).compensatoryDays ?? 0, numFmt: '0' },
  ];
}

interface PlaceRow {
  department: string;
  team: string | null;
  row: AttendanceSummaryRow;
}

const PLACE_COLUMNS: readonly Column<PlaceRow>[] = [
  { header: 'Department', width: 28, value: (r) => r.department },
  { header: 'Team', width: 24, value: (r) => r.team },
  { header: 'People', width: 9, value: (r) => r.row.people, numFmt: '0' },
  { header: 'Person-months', width: 13, value: (r) => r.row.personMonths, numFmt: '0' },
  ...figureColumns<PlaceRow>(
    (r) => r.row.figures,
    (r) => r.row.averageHours,
  ),
];

type PersonRow = AttendanceSummaryReport['rows'][number];

const PERSON_COLUMNS: readonly Column<PersonRow>[] = [
  { header: 'Month', width: 15, value: (r) => monthName(r.month) },
  { header: 'Code', width: 11, value: (r) => r.employee.employeeCode },
  { header: 'Name', width: 30, value: (r) => r.employee.fullNameEn },
  { header: 'Department', width: 28, value: (r) => r.place?.parent?.nameEn ?? r.place?.nameEn ?? null },
  { header: 'Team', width: 24, value: (r) => (r.place?.parent ? r.place.nameEn : null) },
  ...figureColumns<PersonRow>(
    (r) => r.figures,
    (r) => (r.figures.daysCounted > 0 ? Math.round((r.figures.hoursCounted / r.figures.daysCounted) * 60) / 60 : null),
  ),
];

export interface DayRow {
  month: string;
  employee: AttendanceEmployeeView;
  day: AttendanceDayView;
}

const DAY_COLUMNS: readonly Column<DayRow>[] = [
  { header: 'Date', width: 12, value: (r) => shownDate(r.day.date) },
  { header: 'Code', width: 11, value: (r) => r.employee.employeeCode },
  { header: 'Name', width: 30, value: (r) => r.employee.fullNameEn },
  { header: 'Department', width: 30, value: (r) => r.employee.department },
  { header: 'What it was', width: 22, value: (r) => ATTENDANCE_DAY_STATUS_LABELS[r.day.status] ?? r.day.status },
  { header: 'Check-in', width: 11, value: (r) => cairoTime(r.day.checkIn) },
  { header: 'Check-out', width: 11, value: (r) => cairoTime(r.day.checkOut) },
  { header: 'Hours counted', width: 13, value: (r) => (r.day.status === 'worked' ? asTime(r.day.hoursCounted) : null), numFmt: HOURS },
  { header: 'Short hours', width: 11, value: (r) => (r.day.shortHours > 0 ? asTime(r.day.shortHours) : null), numFmt: HOURS },
  { header: 'Where', width: 16, value: (r) => (r.day.place ? CHECK_IN_PLACE_LABELS[r.day.place] : null) },
  { header: 'Permission hours', width: 14, value: (r) => (r.day.permissionHours > 0 ? asTime(r.day.permissionHours) : null), numFmt: HOURS },
  { header: 'Zoho says', width: 22, value: (r) => r.day.zohoStatus },
  // where the day came from, and a check-in on the system flagged by its work arrangement (19 October 2026)
  { header: 'From', width: 22, value: (r) => ATTENDANCE_SOURCE_LABELS[(r.day.source ?? 'zoho') as AttendanceSource] ?? r.day.source ?? null },
  { header: 'Flagged', width: 40, value: (r) => (r.day.flags.length ? r.day.flags.map((f) => CHECK_IN_FLAG_LABELS[f]).join('; ') : null) },
  // a day as the sum of its pairs (owner, 25 October 2026: "the working hours to be calculated between the checkin and out
  // only, not the first and last"): its pairs and an open last check-in, the break between them
  { header: 'Pairs', width: 44, value: (r) => dayPairsCell(r.day) },
  { header: 'Break', width: 9, value: (r) => (r.day.breakMinutes ? asTime(r.day.breakMinutes / 60) : null), numFmt: HOURS },
  // exempt from check-in (25 October 2026): counted as full
  { header: 'Exempt', width: 9, value: (r) => (r.day.compensatory ? 'Compensatory' : r.day.exempt ? EXEMPT_BADGE : null) },
];

/** A day's pairs and its open last check-in in a cell: "9:02 AM–1:10 PM · Checked in 2:00 PM · not checked out"; none with one pair or less. */
function dayPairsCell(day: Pick<AttendanceDayView, 'pairs' | 'openAt'>): string | null {
  const pairs = day.pairs ?? [];
  if (pairs.length < 2 && !day.openAt) return null;
  return [pairsText(pairs), day.openAt ? openPressText(day.openAt) : null].filter(Boolean).join(' · ');
}

/** The Summary's rows as the first sheet lists them: each department, then its teams; those without one as "No department". */
export function placeRows(report: Pick<AttendanceSummaryReport, 'groups'>): PlaceRow[] {
  return report.groups.flatMap((g) => {
    const department = g.name ?? 'No department';
    return [{ department, team: null, row: g }, ...g.teams.map((t) => ({ department, team: t.name, row: t }))];
  });
}

/** The workbook: By Department and Team (with the totals last), By Person, Days. */
export async function attendanceWorkbook(report: AttendanceSummaryReport, days: readonly DayRow[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const places = placeRows(report);
  const sheet = addSheet(wb, 'By Department and Team', PLACE_COLUMNS, [...places, { department: 'All', team: null, row: report.totals }]);
  sheet.getRow(places.length + 2).font = { name: 'Calibri', size: 11, bold: true };
  addSheet(wb, 'By Person', PERSON_COLUMNS, report.rows);
  addSheet(wb, 'Days', DAY_COLUMNS, days);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
