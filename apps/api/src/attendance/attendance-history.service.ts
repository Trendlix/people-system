import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import ExcelJS from 'exceljs';
import {
  attendanceDayView,
  CHECK_IN_SOURCES,
  checkInBins,
  clockText,
  DEFAULT_WORKING_DAYS,
  HISTORY_FIGURE_DEFINITIONS,
  HISTORY_MODE_LABELS,
  HISTORY_PERIOD_LABELS,
  HISTORY_SOURCE_LABELS,
  historyDay,
  historyFigures,
  historyFileName,
  historyRange,
  historyTrend,
  lateByWeekday,
  matchesHistoryFilter,
  monthDays,
  monthRange,
  officialDutyDays,
  percentText,
  shiftWorkHours,
  trendByQuarter,
  WEEKDAY_SHORT,
  type HistoryBin,
  type HistoryDay,
  type HistoryFigures,
  type HistoryFilter,
  type HistoryPeriod,
  type HistoryTrendPoint,
  type HistoryWeekday,
} from '@trendlix/shared';
import { AuditService } from '../audit/audit.service.js';
import { actsAs, isSuperAdmin } from '../auth/roles.js';
import type { SessionUser } from '../auth/session-user.js';
import { addDays, fromDateOnly, todayInCairo, toDateOnly, weekday } from '../common/date-only.js';
import { ConfidentialService } from '../employees/confidential.service.js';
import { addSheet, type Column } from '../employees/missing-workbook.js';
import { approvedOds, dutyDaysOf } from '../official-duty/od-days.js';
import { firstDay, lastDay } from '../payroll/months.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { approvedWfhDays } from '../wfh/wfh-days.js';
import { DAY_SELECT, EMPLOYMENT_SELECT, monthDayOf, shiftTimesOf } from './attendance-days.service.js';
import type { AttendanceHistoryQueryDto } from './attendance-history.dto.js';
import { cairoTime } from './attendance-workbook.js';

// A person's attendance history on their profile (owner, 23 October 2026: "Attendance history on the profile. Since
// joining: on-time %, average check-in time, late days by weekday and trends; an Excel export"; asked who sees it, "HR,
// CEO and Finance only"; packages/shared attendance-history.ts). For HR, the CEO, Finance and the Super Admin; a C-level
// person's only the CEO's and the Super Admin's; nobody else, a manager and the person themself neither (404, as for a
// person not there, as the month page answers). The period's days are read in one query (every source), with the
// holidays, the approved leave, work from home days and official duties and the first check-in on the system beside it;
// each month is then made as the attendance makes it (packages/shared monthDays, officialDutyDays), under each
// employment of the person in it, so a rehire's gap between two employments is left out. The figures, the on-time
// trend, the check-in times and the late days by weekday are worked out from them; the daily log is paged, latest
// first, by the log's filter. The Excel export (never a developer's) has the figures and every day, and is audited.
// Nothing is cached.

const NOT_FOUND = 'Employee not found.';

/** The days a page of the log shows. */
export const HISTORY_PAGE_SIZE = 50;

/** GET /attendance/employees/:id/history. */
export interface AttendanceHistoryView {
  employee: { id: string; employeeCode: string; fullNameEn: string; confidential: boolean };
  period: HistoryPeriod;
  periodLabel: string;
  range: { from: string; to: string };
  /** Their first employment's join date: where since joining starts; null: no employment. */
  joinedOn: string | null;
  /** Their employments within the period, oldest first; the days between two are left out (a rehire's gap). */
  employments: { joinDate: string; endDate: string | null }[];
  /** The first and the last day on record in the period; null: none. */
  firstRecord: string | null;
  lastRecord: string | null;
  figures: HistoryFigures;
  definitions: typeof HISTORY_FIGURE_DEFINITIONS;
  trend: { by: 'month' | 'quarter'; points: HistoryTrendPoint[] };
  /** The first check-ins by 15 minutes (minutes after midnight, Cairo). */
  checkIns: HistoryBin[];
  /** Late days by weekday, their shifts' working days first. */
  weekdays: HistoryWeekday[];
  log: { only: HistoryFilter | null; page: number; pages: number; pageSize: number; total: number; days: HistoryDay[] };
  generatedAt: string;
}

/** The period built: who, the days, the working weekdays. */
interface Built {
  employee: AttendanceHistoryView['employee'];
  period: HistoryPeriod;
  range: { from: string; to: string };
  joinedOn: string | null;
  employments: { joinDate: string; endDate: string | null }[];
  days: HistoryDay[];
  workingDays: number[];
}

@Injectable()
export class AttendanceHistoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly confidential: ConfidentialService,
  ) {}

  /** A person's history for a period, with a page of its log. */
  async history(employeeId: string, query: AttendanceHistoryQueryDto, user: SessionUser): Promise<AttendanceHistoryView> {
    const built = await this.build(employeeId, query, user);
    const only = query.only ?? null;
    const listed = built.days.filter((d) => matchesHistoryFilter(d, only)).reverse();
    const pages = Math.max(1, Math.ceil(listed.length / HISTORY_PAGE_SIZE));
    const page = Math.min(Math.max(1, query.page ?? 1), pages);
    const records = built.days.map((d) => d.date);
    return {
      employee: built.employee,
      period: built.period,
      periodLabel: HISTORY_PERIOD_LABELS[built.period],
      range: built.range,
      joinedOn: built.joinedOn,
      employments: built.employments,
      firstRecord: records[0] ?? null,
      lastRecord: records.at(-1) ?? null,
      figures: historyFigures(built.days),
      definitions: HISTORY_FIGURE_DEFINITIONS,
      trend: { by: trendByQuarter(built.range) ? 'quarter' : 'month', points: historyTrend(built.days, built.range) },
      checkIns: checkInBins(built.days),
      weekdays: lateByWeekday(built.days, built.workingDays),
      log: { only, page, pages, pageSize: HISTORY_PAGE_SIZE, total: listed.length, days: listed.slice((page - 1) * HISTORY_PAGE_SIZE, page * HISTORY_PAGE_SIZE) },
      generatedAt: new Date().toISOString(),
    };
  }

  /** The history as an Excel workbook (Figures, On-Time Trend, Daily Log); the download is in the audit log. */
  async workbook(employeeId: string, query: AttendanceHistoryQueryDto, user: SessionUser): Promise<{ fileName: string; data: Buffer }> {
    const built = await this.build(employeeId, query, user);
    const figures = historyFigures(built.days);
    const trend = historyTrend(built.days, built.range);
    const wb = new ExcelJS.Workbook();
    addSheet(wb, 'Figures', FIGURE_COLUMNS, figureRows(built, figures));
    addSheet(wb, 'On-Time Trend', TREND_COLUMNS, trend);
    addSheet(wb, 'Daily Log', DAY_COLUMNS, built.days);
    const data = Buffer.from(await wb.xlsx.writeBuffer());
    await this.audit.record({
      userId: user.id,
      action: 'attendance_history_file',
      entityType: 'employee',
      entityId: employeeId,
      diff: { period: built.period, from: built.range.from, to: built.range.to, days: built.days.length },
    });
    return { fileName: historyFileName(built.employee.employeeCode, built.range), data };
  }

  // ---------- helpers ----------

  /**
   * Who may see it (owner, 23 October 2026: "HR, CEO and Finance only", the Super Admin too): 404 for anyone else, and
   * for a C-level person to all but the CEO and the Super Admin, as for a person not there.
   */
  private async assertSees(employeeId: string, user: SessionUser): Promise<{ confidential: boolean }> {
    if (!(actsAs(user.roles, ['hr', 'ceo', 'finance']) || isSuperAdmin(user))) throw new NotFoundException(NOT_FOUND);
    if (await this.confidential.isHidden(user, employeeId)) throw new NotFoundException(NOT_FOUND);
    return { confidential: await this.confidential.isConfidential(employeeId) };
  }

  /** The period's days, as the attendance makes them under each employment, one a date, in date order. */
  private async build(employeeId: string, query: AttendanceHistoryQueryDto, user: SessionUser): Promise<Built> {
    const { confidential } = await this.assertSees(employeeId, user);
    const person = await this.prisma.employee.findUnique({ where: { id: employeeId }, select: { id: true, employeeCode: true, fullNameEn: true } });
    if (!person) throw new NotFoundException(NOT_FOUND);
    const employments = await this.prisma.employment.findMany({ where: { employeeId }, orderBy: { joinDate: 'asc' }, select: EMPLOYMENT_SELECT });
    const today = todayInCairo();
    const joinedOn = employments.length ? fromDateOnly(employments[0].joinDate) : null;
    const period = query.period ?? 'this_month';
    const range = historyRange(period, today, joinedOn, { from: query.from, to: query.to });
    if ('problem' in range) throw new BadRequestException([range.problem]);
    const within = { gte: toDateOnly(range.from), lte: toDateOnly(range.to) };

    // the period's days in one query, and what they are read with
    const [rows, holidays, leave, wfh, ods, checkIns] = await Promise.all([
      this.prisma.attendanceDay.findMany({ where: { employeeId, date: within }, orderBy: { date: 'asc' }, select: DAY_SELECT }),
      this.prisma.holiday.findMany({ where: { date: within }, select: { date: true } }),
      this.prisma.leaveRequest.findMany({
        where: { employeeId, status: 'approved', startDate: { lte: within.lte }, endDate: { gte: within.gte } },
        select: { startDate: true, endDate: true },
      }),
      approvedWfhDays(this.prisma, [employeeId], range.from, range.to),
      approvedOds(this.prisma, [employeeId], range.from, range.to),
      this.prisma.attendanceDay.aggregate({ where: { employeeId, source: { in: [...CHECK_IN_SOURCES] }, date: { lte: within.lte } }, _min: { date: true } }),
    ]);
    const kept = rows.map(monthDayOf);
    const holidayDays = holidays.map((h) => fromDateOnly(h.date));
    const holidaySet = new Set(holidayDays);
    const wfhSet = new Set(wfh.get(employeeId) ?? []);
    const checkInFrom = checkIns._min.date ? fromDateOnly(checkIns._min.date) : null;
    const leaveDays: string[] = [];
    for (const l of leave) for (let d = fromDateOnly(l.startDate); d <= fromDateOnly(l.endDate); d = addDays(d, 1)) if (d >= range.from && d <= range.to) leaveDays.push(d);

    const inRange = employments.filter((e) => fromDateOnly(e.joinDate) <= range.to && (e.endDate === null || fromDateOnly(e.endDate) >= range.from));
    const byDate = new Map<string, HistoryDay>();
    const working = new Set<number>();
    for (const month of monthRange(range.from.slice(0, 7), range.to.slice(0, 7))) {
      const [first, last] = [firstDay(month), lastDay(month)];
      const ofMonth = kept.filter((d) => d.date.startsWith(month));
      for (const e of inRange) {
        const employedFrom = fromDateOnly(e.joinDate);
        const employedTo = fromDateOnly(e.endDate);
        if (employedFrom > last || (employedTo !== null && employedTo < first)) continue;
        const shift = e.shift ? shiftTimesOf(e.shift) : null;
        const workingDays = shift?.workingDays ?? DEFAULT_WORKING_DAYS;
        for (const w of workingDays) working.add(w);
        const base = monthDays(ofMonth, { month, today, checkInFrom, workingDays, holidays: holidayDays, leaveDays, employedFrom, employedTo });
        const duties = dutyDaysOf(ods, employeeId, shift, holidaySet, first, last);
        const days = officialDutyDays(base, duties, { today, checkInFrom, employedFrom, employedTo, shift });
        const hoursADay = shift ? shiftWorkHours(shift) : null;
        for (const d of days) {
          // within this employment and the period: a rehire's gap is left out
          if (d.date < range.from || d.date > range.to || d.date < employedFrom || (employedTo !== null && d.date > employedTo)) continue;
          const view = attendanceDayView(d, hoursADay);
          byDate.set(
            d.date,
            historyDay({
              ...view,
              source: d.source,
              wfh: wfhSet.has(d.date),
              shift,
              scheduled: workingDays.includes(weekday(d.date)) && !holidaySet.has(d.date),
            }),
          );
        }
      }
    }
    return {
      employee: { ...person, confidential },
      period,
      range,
      joinedOn,
      employments: inRange.map((e) => ({ joinDate: fromDateOnly(e.joinDate), endDate: fromDateOnly(e.endDate) })),
      days: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)),
      workingDays: working.size ? [...working].sort((a, b) => a - b) : [...DEFAULT_WORKING_DAYS],
    };
  }
}

// ---------- the workbook ----------

/** Hours as Excel keeps a time: a fraction of a day, shown [h]:mm. */
const asTime = (hours: number | null) => (hours === null ? null : hours / 24);
const HOURS = '[h]:mm';
/** "2026-10-18" → "18/10/2026". */
const shownDate = (ymd: string) => ymd.split('-').reverse().join('/');

interface FigureRow {
  figure: string;
  value: string | number | null;
  meaning: string | null;
}

/** Hours as the figures say them: 8.5 → "8:30"; null → none. */
const hoursText = (hours: number | null) => (hours === null ? null : `${Math.floor(hours)}:${String(Math.round((hours % 1) * 60)).padStart(2, '0')}`);

const FIGURE_COLUMNS: readonly Column<FigureRow>[] = [
  { header: 'Figure', width: 28, value: (r) => r.figure },
  { header: 'Value', width: 30, value: (r) => r.value },
  { header: 'What it means', width: 90, value: (r) => r.meaning, wrap: true },
];

/** The Figures sheet: who and when, then each figure with its definition. */
function figureRows(b: Built, f: HistoryFigures): FigureRow[] {
  const D = HISTORY_FIGURE_DEFINITIONS;
  return [
    { figure: 'Employee', value: `${b.employee.fullNameEn} (${b.employee.employeeCode})`, meaning: null },
    { figure: 'Period', value: `${HISTORY_PERIOD_LABELS[b.period]}: ${shownDate(b.range.from)} to ${shownDate(b.range.to)}`, meaning: b.employments.length > 1 ? 'Across their employments; the days between two are left out.' : null },
    { figure: 'Days on record', value: f.daysOnRecord, meaning: 'Days kept from Zoho People’s imports, the system’s check-ins and the corrections; a day before any record isn’t counted.' },
    { figure: 'Attendance rate', value: percentText(f.attendanceRate), meaning: `${D.attendanceRate} ${f.attendedDays} of ${f.expectedDays}.` },
    { figure: 'On-time %', value: percentText(f.onTimeRate), meaning: `${D.onTimeRate} ${f.onTimeDays} of ${f.measuredDays}.` },
    { figure: 'Late days', value: f.lateDays, meaning: D.lateDays },
    { figure: 'Average check-in', value: f.averageCheckIn === null ? null : clockText(f.averageCheckIn), meaning: D.averageCheckIn },
    { figure: 'Average hours a day', value: hoursText(f.averageHours), meaning: D.averageHours },
    { figure: 'Absences', value: f.absences, meaning: D.absences },
    { figure: 'Leave days', value: f.leaveDays, meaning: D.leaveDays },
    { figure: 'Leave in Zoho only', value: f.zohoLeaveDays, meaning: 'Days Zoho People marks as leave with no leave in the system.' },
    { figure: 'Work from home days', value: f.wfhDays, meaning: D.wfhDays },
    { figure: 'Official duty days', value: f.odDays, meaning: D.odDays },
    { figure: 'Overtime (extra time)', value: hoursText(f.extraHours), meaning: D.extraHours },
    { figure: 'Days worked off', value: f.offDaysWorked, meaning: 'Days checked in on a rest day or an official holiday.' },
  ];
}

const TREND_COLUMNS: readonly Column<HistoryTrendPoint>[] = [
  { header: 'Period', width: 14, value: (p) => p.label },
  { header: 'From', width: 12, value: (p) => shownDate(p.from) },
  { header: 'To', width: 12, value: (p) => shownDate(p.to) },
  { header: 'On-time %', width: 11, value: (p) => p.onTimeRate, numFmt: '0%' },
  { header: 'Days on time', width: 12, value: (p) => p.onTimeDays, numFmt: '0' },
  { header: 'Days measured', width: 13, value: (p) => p.measuredDays, numFmt: '0' },
  { header: 'Attendance rate', width: 14, value: (p) => p.attendanceRate, numFmt: '0%' },
  { header: 'Days attended', width: 13, value: (p) => p.attendedDays, numFmt: '0' },
  { header: 'Days expected', width: 13, value: (p) => p.expectedDays, numFmt: '0' },
];

const DAY_COLUMNS: readonly Column<HistoryDay>[] = [
  { header: 'Date', width: 12, value: (d) => shownDate(d.date) },
  { header: 'Day', width: 6, value: (d) => WEEKDAY_SHORT[d.weekday] },
  { header: 'Mode', width: 20, value: (d) => HISTORY_MODE_LABELS[d.mode] },
  { header: 'First in', width: 11, value: (d) => cairoTime(d.checkIn) },
  { header: 'Last out', width: 11, value: (d) => cairoTime(d.checkOut) },
  { header: 'Hours', width: 9, value: (d) => (d.status === 'worked' ? asTime(d.hours) : null), numFmt: HOURS },
  { header: 'Late minutes', width: 12, value: (d) => (d.lateMinutes > 0 ? d.lateMinutes : null), numFmt: '0' },
  { header: 'On time', width: 9, value: (d) => (d.onTime === null ? null : d.onTime ? 'Yes' : 'No') },
  { header: 'Source', width: 18, value: (d) => HISTORY_SOURCE_LABELS[d.source] ?? d.source },
];
