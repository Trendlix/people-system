import { Injectable } from '@nestjs/common';
import {
  CHECK_IN_SOURCES,
  monthDays,
  OWN_SOURCES,
  shiftWorkHours,
  type AttendanceDayStatus,
  type AttendanceSource,
  type CorrectedFrom,
  type DayPlace,
  type SourcedDay,
} from '@trendlix/shared';
import { addDays, fromDateOnly, todayInCairo, toDateOnly } from '../common/date-only.js';
import { fromTimeOfDay } from '../common/time-of-day.js';
import type { Prisma } from '../generated/prisma/client.js';
import { employedIn } from '../payroll/adjustments/people.js';
import { firstDay, lastDay } from '../payroll/months.js';
import { PrismaService } from '../prisma/prisma.service.js';

// A person's month of attendance days from every source (owner, 19 October 2026: "Check-in through the system (phone or
// web with the office location check, or a device) to replace Zoho"): the days kept from Zoho People's imports, from
// their check-ins on the system (and later a device's), and the corrections approved, one a date by SOURCE_PRECEDENCE,
// with the days gone by since their first check-in on the system that have none (an absent working day, a rest day, a
// holiday or approved leave: packages/shared monthDays). The Attendance section shows them and a draft payroll run's
// lines are filled from them (attendance-fill.service.ts), so both count the same days.

type Db = PrismaService | Prisma.TransactionClient;

/** What a kept day is read with. */
export const DAY_SELECT = {
  employeeId: true,
  date: true,
  checkIn: true,
  checkOut: true,
  status: true,
  zohoStatus: true,
  place: true,
  permissionHours: true,
  hoursCounted: true,
  importId: true,
  source: true,
  flags: true,
  correctedFrom: true,
  correctionId: true,
} satisfies Prisma.AttendanceDaySelect;

export type DayRow = Prisma.AttendanceDayGetPayload<{ select: typeof DAY_SELECT }>;

/** The employment a month is read with: its place, job title, dates and shift (its window, hours, grace and days). */
export const EMPLOYMENT_SELECT = {
  id: true,
  employeeId: true,
  joinDate: true,
  endDate: true,
  departmentId: true,
  workArrangement: true,
  officeDays: true,
  department: { select: { id: true, nameEn: true, parent: { select: { id: true, nameEn: true } } } },
  jobTitle: { select: { titleEn: true } },
  shift: { select: { startTime: true, endTime: true, hoursPerDay: true, graceMinutes: true, workingDays: true } },
} satisfies Prisma.EmploymentSelect;

export type EmploymentRow = Prisma.EmploymentGetPayload<{ select: typeof EMPLOYMENT_SELECT }>;

/** A day as the month has it: from its source, or one gone by without a check-in (source 'system', no import). */
export type MonthDay = SourcedDay & { importId: string | null; flags: string[] };

/** A person's month: their employment in it (the latest), their shift's hours a day, and their days. */
export interface PersonDays {
  employeeId: string;
  employment: EmploymentRow | null;
  /** The shift's hours to work a day (payroll.ts shiftWorkHours); null without one. */
  hoursADay: number | null;
  days: MonthDay[];
  /**
   * Whether the month has a day of the system's own (a check-in on the system, a day gone by since their first one, a
   * device's, a correction): their payroll line is filled from these days, not left to Zoho's import.
   */
  own: boolean;
  /** The sources of the days shown. */
  sources: AttendanceSource[];
}

/** A kept row as a month's day. */
export function monthDayOf(d: DayRow): MonthDay {
  return {
    date: fromDateOnly(d.date),
    status: d.status as AttendanceDayStatus,
    checkIn: d.checkIn?.toISOString() ?? null,
    checkOut: d.checkOut?.toISOString() ?? null,
    place: (d.place as DayPlace | null) ?? null,
    zohoStatus: d.zohoStatus,
    permissionHours: d.permissionHours?.toNumber() ?? 0,
    hoursCounted: d.hoursCounted.toNumber(),
    source: d.source as AttendanceSource,
    flags: d.flags,
    importId: d.importId,
    // a correction approved (owner, 19 October 2026: "Attendance corrections with approval"): the day it was applied over
    ...(d.source === 'correction' && { correctedFrom: (d.correctedFrom as unknown as CorrectedFrom | null) ?? null, correctionId: d.correctionId }),
  };
}

/** The shift's times as the shared rules take them. */
export const shiftTimesOf = (s: NonNullable<EmploymentRow['shift']>) => ({
  startTime: fromTimeOfDay(s.startTime),
  endTime: fromTimeOfDay(s.endTime),
  hoursPerDay: s.hoursPerDay?.toNumber() ?? null,
  graceMinutes: s.graceMinutes,
  workingDays: s.workingDays,
});

@Injectable()
export class AttendanceDaysService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Those employed in a month who checked in on the system (or a device) on or before its end: their month has days
   * (the working days gone by without a check-in among them) even when nothing was kept in it.
   */
  async checkInPeople(month: string, db: Db = this.prisma): Promise<string[]> {
    const rows = await db.employee.findMany({
      where: {
        employments: { some: employedIn(month) },
        attendanceDays: { some: { source: { in: [...CHECK_IN_SOURCES] }, date: { lte: toDateOnly(lastDay(month)) } } },
      },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  /**
   * Each person's month (YYYY-MM): their kept days of every source, one a date, with the days gone by since their first
   * check-in on the system (monthDays). `rows`: their kept days of the month when already read (else read here). People
   * with no employment in the month and no days are left out.
   */
  async monthOf(month: string, ids: readonly string[], rows?: readonly DayRow[], db: Db = this.prisma, today = todayInCairo()): Promise<Map<string, PersonDays>> {
    const out = new Map<string, PersonDays>();
    if (!ids.length) return out;
    const [first, last] = [firstDay(month), lastDay(month)];
    const range = { gte: toDateOnly(first), lte: toDateOnly(last) };
    const [kept, employments, holidays, leave, checkIns] = await Promise.all([
      rows ?? db.attendanceDay.findMany({ where: { employeeId: { in: [...ids] }, date: range }, orderBy: { date: 'asc' }, select: DAY_SELECT }),
      db.employment.findMany({ where: { employeeId: { in: [...ids] }, ...employedIn(month) }, orderBy: { joinDate: 'desc' }, select: EMPLOYMENT_SELECT }),
      db.holiday.findMany({ where: { date: range }, select: { date: true } }),
      db.leaveRequest.findMany({
        where: { employeeId: { in: [...ids] }, status: 'approved', startDate: { lte: range.lte }, endDate: { gte: range.gte } },
        select: { employeeId: true, startDate: true, endDate: true },
      }),
      // the first day each checked in on the system (or a device), up to the month's end
      db.attendanceDay.groupBy({
        by: ['employeeId'],
        where: { employeeId: { in: [...ids] }, source: { in: [...CHECK_IN_SOURCES] }, date: { lte: range.lte } },
        _min: { date: true },
      }),
    ]);
    const employmentOf = new Map<string, EmploymentRow>();
    for (const e of employments) if (!employmentOf.has(e.employeeId)) employmentOf.set(e.employeeId, e);
    const rowsOf = new Map<string, MonthDay[]>();
    for (const d of kept) if (ids.includes(d.employeeId)) rowsOf.set(d.employeeId, [...(rowsOf.get(d.employeeId) ?? []), monthDayOf(d)]);
    const holidayDays = holidays.map((h) => fromDateOnly(h.date));
    const firstCheckIn = new Map(checkIns.map((c) => [c.employeeId, c._min.date ? fromDateOnly(c._min.date) : null]));

    for (const id of ids) {
      const employment = employmentOf.get(id) ?? null;
      const own = rowsOf.get(id) ?? [];
      const leaveDays: string[] = [];
      for (const l of leave.filter((x) => x.employeeId === id)) {
        for (let d = fromDateOnly(l.startDate); d <= fromDateOnly(l.endDate); d = addDays(d, 1)) if (d >= first && d <= last) leaveDays.push(d);
      }
      const shift = employment?.shift ? shiftTimesOf(employment.shift) : null;
      const days = monthDays(own, {
        month,
        today,
        checkInFrom: firstCheckIn.get(id) ?? null,
        workingDays: shift?.workingDays ?? null,
        holidays: holidayDays,
        leaveDays,
        employedFrom: employment ? fromDateOnly(employment.joinDate) : null,
        employedTo: employment ? fromDateOnly(employment.endDate) : null,
      }).map((d) => ({ ...d, importId: 'importId' in d ? (d.importId as string | null) : null, flags: [...(d.flags ?? [])] }));
      if (!employment && !days.length) continue;
      out.set(id, {
        employeeId: id,
        employment,
        hoursADay: shift ? shiftWorkHours(shift) : null,
        days,
        // the days gone by without a check-in count too: someone who checks in on the system and didn't all month
        own: days.some((d) => (OWN_SOURCES as readonly string[]).includes(d.source)),
        sources: [...new Set(days.map((d) => d.source))],
      });
    }
    return out;
  }
}
