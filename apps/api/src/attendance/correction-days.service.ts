import { Injectable } from '@nestjs/common';
import { correctedDay, type CorrectableDay, type CorrectedDay, type CorrectedFrom, type CorrectionKind } from '@trendlix/shared';
import type { SessionUser } from '../auth/session-user.js';
import { fromDateOnly, toDateOnly } from '../common/date-only.js';
import { Prisma } from '../generated/prisma/client.js';
import { json } from '../payroll/line-work.js';
import { firstDay, lastDay } from '../payroll/months.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AttendanceDaysService, DAY_SELECT, shiftTimesOf } from './attendance-days.service.js';

type Db = PrismaService | Prisma.TransactionClient;

/** What a corrected day was made from and into, for the audit log. */
export interface CorrectionDayChange {
  dayId: string | null;
  before: CorrectedFrom | null;
  after: CorrectedDay | null;
}

// The corrected days (owner, 19 October 2026, "Proceed with those": "Attendance corrections with approval ("I forgot to
// check out")"): a day with corrections approved is kept as source 'correction' over the day it corrects, which stays
// as it was: the day of the first other source there is (the system's check-ins, a device's, Zoho's import: or one
// gone by without a check-in, absent), each correction approved applied over it in the order approved (packages/shared
// correctedDay: the right times, worked remotely remote and no longer flagged, the hours counted again by the shift's
// rule), with the day it was applied over as it was then (correctedFrom). Made again whenever that day changes (a
// check-in on the system that day, a Zoho import applied or undone), so a correction of today still takes a later
// check-out; gone when no correction of the day is approved.
@Injectable()
export class CorrectionDaysService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly days: AttendanceDaysService,
  ) {}

  /** Makes the person's corrected day of `date` (YYYY-MM-DD) again from its corrections approved and the day it corrects. */
  async rebuild(employeeId: string, date: string, user: SessionUser | null, db: Db = this.prisma): Promise<CorrectionDayChange> {
    const corrections = await db.attendanceCorrection.findMany({
      where: { employeeId, date: toDateOnly(date), status: 'approved' },
      orderBy: [{ appliedAt: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, kind: true, checkIn: true, checkOut: true },
    });
    const key = { employeeId_date_source: { employeeId, date: toDateOnly(date), source: 'correction' } };
    const existing = await db.attendanceDay.findUnique({ where: key, select: { id: true } });
    if (!corrections.length) {
      if (existing) await db.attendanceDay.delete({ where: { id: existing.id } });
      return { dayId: null, before: null, after: null };
    }
    // the day it corrects: every other source's, the days gone by since the first check-in on the system among them
    const month = date.slice(0, 7);
    const rows = await db.attendanceDay.findMany({
      where: { employeeId, date: { gte: toDateOnly(firstDay(month)), lte: toDateOnly(lastDay(month)) }, source: { not: 'correction' } },
      select: DAY_SELECT,
    });
    const person = (await this.days.monthOf(month, [employeeId], rows, db)).get(employeeId);
    const base = person?.days.find((d) => d.date === date) ?? null;
    const shift = person?.employment?.shift ? shiftTimesOf(person.employment.shift) : null;
    let day: CorrectableDay | CorrectedDay | null = base;
    for (const c of corrections) {
      day = correctedDay(day, { kind: c.kind as CorrectionKind, checkIn: c.checkIn?.toISOString() ?? null, checkOut: c.checkOut?.toISOString() ?? null }, date, shift);
    }
    const after = day as CorrectedDay;
    const before: CorrectedFrom | null = base ? { source: base.source, status: base.status, checkIn: base.checkIn, checkOut: base.checkOut, place: base.place } : null;
    const data = {
      status: after.status,
      checkIn: after.checkIn ? new Date(after.checkIn) : null,
      checkOut: after.checkOut ? new Date(after.checkOut) : null,
      place: after.place,
      flags: after.flags,
      hoursCounted: Math.round(after.hoursCounted * 100) / 100,
      // Zoho's status and permission of the day it corrects, as they were
      zohoStatus: base?.zohoStatus ?? null,
      permissionHours: base && (base.source === 'zoho' || base.source === 'correction') && base.permissionHours > 0 ? base.permissionHours : null,
      correctedFrom: before ? json(before) : Prisma.DbNull,
      correctionId: corrections.at(-1)!.id,
      importId: null,
      importedById: user?.id ?? null,
      importedAt: new Date(),
    };
    const saved = await db.attendanceDay.upsert({ where: key, create: { employeeId, date: toDateOnly(date), source: 'correction', ...data }, update: data, select: { id: true } });
    return { dayId: saved.id, before, after };
  }

  /** Makes again the corrected days of these people in a month (YYYY-MM): after the days they correct changed. */
  async rebuildMonth(employeeIds: readonly string[], month: string, user: SessionUser | null): Promise<void> {
    if (!employeeIds.length) return;
    const dates = await this.prisma.attendanceCorrection.findMany({
      where: { employeeId: { in: [...employeeIds] }, status: 'approved', date: { gte: toDateOnly(firstDay(month)), lte: toDateOnly(lastDay(month)) } },
      distinct: ['employeeId', 'date'],
      select: { employeeId: true, date: true },
    });
    for (const d of dates) await this.rebuild(d.employeeId, fromDateOnly(d.date), user);
  }

  /** Makes the day again when it has a correction approved (after a check-in on the system that day). */
  async rebuildIfCorrected(employeeId: string, date: string, user: SessionUser | null): Promise<void> {
    if (await this.prisma.attendanceCorrection.count({ where: { employeeId, date: toDateOnly(date), status: 'approved' } })) await this.rebuild(employeeId, date, user);
  }
}
