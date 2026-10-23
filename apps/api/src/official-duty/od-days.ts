import { DEFAULT_WORKING_DAYS, odCoversMoment, odHoursOn, type CountingShift, type DayOfficialDuty, type ShiftWindowTimes } from '@trendlix/shared';
import { addDays, fromDateOnly, toDateOnly, weekday } from '../common/date-only.js';
import type { Prisma } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { timeOf } from './od-views.js';

// The approved official duties (owner, 23 October 2026: "Official duty (OD) requests"; packages/shared
// official-duty.ts), as checking in and the attendance read them: plain reads, no service, so the attendance module
// takes them without depending on the official duty module.

type Db = PrismaService | Prisma.TransactionClient;

/** An approved official duty as the attendance reads it: its request, its days and its hours. */
export interface ApprovedOd {
  id: string;
  employeeId: string;
  startDate: string;
  endDate: string;
  fullDay: boolean;
  fromTime: string | null;
  toTime: string | null;
}

const SELECT = { id: true, employeeId: true, startDate: true, endDate: true, fullDay: true, fromTime: true, toTime: true } satisfies Prisma.OdRequestSelect;

const asApproved = (r: Prisma.OdRequestGetPayload<{ select: typeof SELECT }>): ApprovedOd => ({
  id: r.id,
  employeeId: r.employeeId,
  startDate: fromDateOnly(r.startDate),
  endDate: fromDateOnly(r.endDate),
  fullDay: r.fullDay,
  fromTime: timeOf(r.fromTime),
  toTime: timeOf(r.toTime),
});

/** The approved official duties of these people with a day from `from` to `to`, in date order. */
export async function approvedOds(db: Db, employeeIds: readonly string[], from: string, to: string): Promise<ApprovedOd[]> {
  if (!employeeIds.length) return [];
  const rows = await db.odRequest.findMany({
    where: { employeeId: { in: [...employeeIds] }, status: 'approved', startDate: { lte: toDateOnly(to) }, endDate: { gte: toDateOnly(from) } },
    orderBy: [{ startDate: 'asc' }, { createdAt: 'asc' }],
    select: SELECT,
  });
  return rows.map(asApproved);
}

/**
 * The approved official duty a press at `moment` is within, if any (owner, 23 October 2026: "Check in from anywhere: on
 * an approved OD day or its hours"): one with the day among its days, a full day or part of one with the moment within
 * its hours (and 30 minutes either side).
 */
export async function approvedOdAt(db: Db, employeeId: string, date: string, moment: Date, shift: ShiftWindowTimes | null): Promise<ApprovedOd | null> {
  const ods = await approvedOds(db, [employeeId], date, date);
  return ods.find((od) => odCoversMoment(date, od, moment.getTime(), shift)) ?? null;
}

/** The approved official duty on a day for the check-in panel: a full day first, else the part of a day still to come or now. */
export async function approvedOdOn(db: Db, employeeId: string, date: string): Promise<ApprovedOd | null> {
  const ods = await approvedOds(db, [employeeId], date, date);
  return ods.find((od) => od.fullDay) ?? ods[0] ?? null;
}

/**
 * Someone's duty days (by date) from their approved official duties, for their attendance: the working days of their
 * shift (Sunday to Thursday without one) that aren't an official holiday, each with the hours the duty counts by itself
 * (packages/shared odHoursOn). Within `from` and `to`.
 */
export function dutyDaysOf(
  ods: readonly ApprovedOd[],
  employeeId: string,
  shift: (CountingShift & { workingDays?: readonly number[] | null }) | null,
  holidays: ReadonlySet<string>,
  from: string,
  to: string,
): Map<string, DayOfficialDuty> {
  const out = new Map<string, DayOfficialDuty>();
  const working = shift?.workingDays ?? DEFAULT_WORKING_DAYS;
  for (const od of ods) {
    if (od.employeeId !== employeeId) continue;
    for (let d = od.startDate > from ? od.startDate : from; d <= od.endDate && d <= to; d = addDays(d, 1)) {
      if (!working.includes(weekday(d)) || holidays.has(d) || out.has(d)) continue;
      out.set(d, { requestId: od.id, fullDay: od.fullDay, fromTime: od.fromTime, toTime: od.toTime, hours: odHoursOn(d, od, shift) });
    }
  }
  return out;
}
