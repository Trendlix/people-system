import { Injectable } from '@nestjs/common';
import {
  CHECK_IN_SOURCES,
  compensatoryDays,
  exemptDays,
  monthDays,
  officialDutyDays,
  OWN_SOURCES,
  readPressPairs,
  shiftWorkHours,
  type AttendanceDayStatus,
  type AttendanceSource,
  type CorrectedFrom,
  type DayPlace,
  type ExemptionPeriod,
  type SourcedDay,
} from '@trendlix/shared';
import { addDays, fromDateOnly, todayInCairo, toDateOnly } from '../common/date-only.js';
import { fromTimeOfDay } from '../common/time-of-day.js';
import type { Prisma } from '../generated/prisma/client.js';
import { employedIn } from '../payroll/adjustments/people.js';
import { firstDay, lastDay } from '../payroll/months.js';
import { approvedCompensatory } from '../compensatory/compensatory-days.js';
import { approvedOds, dutyDaysOf } from '../official-duty/od-days.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { exemptionsOf } from './exemption-days.js';

// A person's month of attendance days from every source (owner, 19 October 2026: "Check-in through the system (phone or
// web with the office location check, or a device) to replace Zoho"): the days kept from Zoho People's imports, from
// their check-ins on the system (and later a device's), and the corrections approved, one a date by SOURCE_PRECEDENCE,
// with the days gone by since their first check-in on the system that have none (an absent working day, a rest day, a
// holiday or approved leave: packages/shared monthDays). The Attendance section shows them and a draft payroll run's
// lines are filled from them (attendance-fill.service.ts), so both count the same days. A day kept on the system's
// check-ins carries its pairs, break and open last check-in (owner, 25 October 2026: "the working hours to be calculated
// between the checkin and out only, not the first and last"). People exempt from check-in (owner, 25 October 2026: "trat
// them as if they achived their full working hours"): their exempt days are read full here (packages/shared exemptDays),
// never written, so the pages, the payroll and the KPIs read them alike.

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
  pairs: true,
  breakMinutes: true,
  openAt: true,
} satisfies Prisma.AttendanceDaySelect;

export type DayRow = Prisma.AttendanceDayGetPayload<{ select: typeof DAY_SELECT }>;

/**
 * The employment a month is read with: its place, job title, dates and shift (its window, hours, grace, the time it
 * counts hours until, 20 October 2026, and days).
 */
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
  shift: { select: { startTime: true, endTime: true, hoursPerDay: true, graceMinutes: true, countUntil: true, workingDays: true } },
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
  /** Their periods exempt from check-in with a day in the month (owner, 25 October 2026), in date order. */
  exemptions: ExemptionPeriod[];
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
    // its pairs, break and open last check-in (25 October 2026); none on Zoho's days and those kept before
    pairs: readPressPairs(d.pairs),
    breakMinutes: d.breakMinutes,
    openAt: d.openAt?.toISOString() ?? null,
  };
}

/** The shift's times as the shared rules take them. */
export const shiftTimesOf = (s: NonNullable<EmploymentRow['shift']>) => ({
  startTime: fromTimeOfDay(s.startTime),
  endTime: fromTimeOfDay(s.endTime),
  hoursPerDay: s.hoursPerDay?.toNumber() ?? null,
  graceMinutes: s.graceMinutes,
  // a long day making up short ones (owner, 20 October 2026: "within the same month"): hours count until it
  countUntil: s.countUntil ? fromTimeOfDay(s.countUntil) : null,
  workingDays: s.workingDays,
});

@Injectable()
export class AttendanceDaysService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Those employed in a month who checked in on the system (or a device) on or before its end, or were exempt from
   * check-in in it (owner, 25 October 2026): their month has days (the working days gone by without a check-in, the exempt
   * days) even when nothing was kept in it.
   */
  async checkInPeople(month: string, db: Db = this.prisma): Promise<string[]> {
    const [first, last] = [toDateOnly(firstDay(month)), toDateOnly(lastDay(month))];
    const rows = await db.employee.findMany({
      where: {
        employments: { some: employedIn(month) },
        OR: [
          { attendanceDays: { some: { source: { in: [...CHECK_IN_SOURCES] }, date: { lte: last } } } },
          { checkInExemptions: { some: { cancelledAt: null, startDate: { lte: last }, OR: [{ endDate: null }, { endDate: { gte: first } }] } } },
          // a compensatory day off approved in the month (owner, 26 October 2026)
          { compensatoryDays: { some: { status: 'approved', OR: [{ dayOff: { gte: first, lte: last } }, { dayWorked: { gte: first, lte: last } }] } } },
        ],
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
    const [kept, employments, holidays, leave, checkIns, ods, exemptions, compensatory] = await Promise.all([
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
      // their official duties approved in the month (owner, 23 October 2026: "OD counted as attended")
      approvedOds(db, ids, first, last),
      // their periods exempt from check-in (owner, 25 October 2026)
      exemptionsOf(db, ids, first, last),
      // their compensatory days approved (owner, 26 October 2026: "my compensatory is a compensation with another day in the same month")
      approvedCompensatory(db, ids, first, last),
    ]);
    const employmentOf = new Map<string, EmploymentRow>();
    for (const e of employments) if (!employmentOf.has(e.employeeId)) employmentOf.set(e.employeeId, e);
    const rowsOf = new Map<string, MonthDay[]>();
    for (const d of kept) if (ids.includes(d.employeeId)) rowsOf.set(d.employeeId, [...(rowsOf.get(d.employeeId) ?? []), monthDayOf(d)]);
    const holidayDays = holidays.map((h) => fromDateOnly(h.date));
    const holidaySet = new Set(holidayDays);
    const firstCheckIn = new Map(checkIns.map((c) => [c.employeeId, c._min.date ? fromDateOnly(c._min.date) : null]));

    for (const id of ids) {
      const employment = employmentOf.get(id) ?? null;
      const own = rowsOf.get(id) ?? [];
      const leaveDays: string[] = [];
      for (const l of leave.filter((x) => x.employeeId === id)) {
        for (let d = fromDateOnly(l.startDate); d <= fromDateOnly(l.endDate); d = addDays(d, 1)) if (d >= first && d <= last) leaveDays.push(d);
      }
      const shift = employment?.shift ? shiftTimesOf(employment.shift) : null;
      const checkInFrom = firstCheckIn.get(id) ?? null;
      const employedFrom = employment ? fromDateOnly(employment.joinDate) : null;
      const employedTo = employment ? fromDateOnly(employment.endDate) : null;
      const base = monthDays(own, { month, today, checkInFrom, workingDays: shift?.workingDays ?? null, holidays: holidayDays, leaveDays, employedFrom, employedTo });
      // an approved official duty's days attended for its hours, a day gone by without a press too (23 October 2026)
      const duties = dutyDaysOf(ods, id, shift, holidaySet, first, last);
      const withDuty = officialDutyDays(base, duties, { today, checkInFrom, employedFrom, employedTo, shift });
      // the exempt days full, whatever was pressed (25 October 2026), a day gone by with nothing kept too
      const hoursADay = shift ? shiftWorkHours(shift) : null;
      const periods = exemptions.get(id) ?? [];
      const exempt = employment ? exemptDays(withDuty, periods, { month, today, workingDays: shift?.workingDays ?? null, holidays: holidayDays, leaveDays, employedFrom, employedTo, hoursADay }) : withDuty;
      // the compensatory days off full and paid, the days worked they compensate left out of the month's hours (26 October 2026:
      // "if the day is compensated with a day, we pay nothing")
      const comp = compensatory.get(id);
      const compensated = employment && comp ? compensatoryDays(exempt, { month, today, workingDays: shift?.workingDays ?? null, holidays: holidayDays, leaveDays, employedFrom, employedTo, hoursADay, daysOff: comp.daysOff, daysWorked: comp.daysWorked }) : exempt;
      const days = compensated.map((d) => ({
        ...d,
        importId: 'importId' in d ? (d.importId as string | null) : null,
        flags: [...(d.flags ?? [])],
      }));
      if (!employment && !days.length) continue;
      out.set(id, {
        employeeId: id,
        employment,
        hoursADay,
        days,
        // the days gone by without a check-in count too: someone who checks in on the system and didn't all month; and
        // the exempt days (25 October 2026), so an exempt person's line is filled from them
        own: days.some((d) => d.exempt || (OWN_SOURCES as readonly string[]).includes(d.source)),
        sources: [...new Set(days.map((d) => d.source))],
        exemptions: periods,
      });
    }
    return out;
  }
}
