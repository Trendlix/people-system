import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  breakMinutesOf,
  dayFromPunches,
  isDaySourceChoice,
  isRecordSource,
  recordLockRefusal,
  recordReasonProblem,
  removesPress,
  shiftWindowOn,
  spansOfPairs,
  zohoDayFromPresses,
  zohoDayPresses,
  type CheckInPlace,
  type DayPress,
  type DaySourceChoice,
  type ImportedDay,
  type PunchKind,
  type PunchLike,
  type RecordSource,
  type WorkPlace,
} from '@trendlix/shared';
import { AuditService } from '../audit/audit.service.js';
import { isSuperAdmin } from '../auth/roles.js';
import type { SessionUser } from '../auth/session-user.js';
import { fromDateOnly, toDateOnly } from '../common/date-only.js';
import { ConfidentialService } from '../employees/confidential.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { json } from '../payroll/line-work.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { userNames } from '../payroll/adjustments/people.js';
import { seesEveryonesAttendance, teamOf } from './attendance-scope.js';
import { EMPLOYMENT_SELECT, shiftTimesOf } from './attendance-days.service.js';
import { AttendanceFillService } from './attendance-fill.service.js';
import { AttendanceImportsService } from './attendance-imports.service.js';
import { keptDayData } from './check-in.service.js';
import { CorrectionDaysService } from './correction-days.service.js';
import { firstWorkingDayOn } from './first-day.js';

// A person's attendance records, seen, and put right by a Super Admin (owner, 31 October 2026: "is there a way to check
// the checkin records? even if imported from zoho and delete one of them?" — "as a super admin"; asked, "Stays removed"
// and "Block locked months"; then "Pick a record to remove" and "Pick which source counts": "zoho or system";
// packages/shared attendance-records.ts):
// - a day's records, the system's presses and Zoho's, for those who see the person's month (attendance.service.ts);
//   the records removed only for a Super Admin, with who removed them, when and why;
// - removing one, with a reason: a system press moved whole to attendance_record_removals (put back as it was on
//   Restore), the day made again from the presses left as a press makes it (check-in.service.ts); a Zoho record kept
//   there by its kind and moment, the Zoho day worked out again without it by the import's rules, and left out by the
//   nightly fetch and an import while removed (record-removals.ts);
// - which source a day uses when it has both Zoho's and the system's (attendance_day_sources), or back to the usual;
// - then, as after a correction: a corrected day over it made again and the month's draft payroll refilled. Never in a
//   month whose payroll is with the CEO, approved or paid. Each change audited. Only a Super Admin changes them.

type Db = PrismaService | Prisma.TransactionClient;

const NOT_FOUND = 'Employee not found.';
const GONE = 'That record isn’t there any more. Reload the page to see the day as it is.';

/** A record of a day as the page lists it. */
export interface DayRecordView {
  /** The system's press's id; a Zoho record's "zoho:{kind}:{moment}". */
  id: string;
  source: RecordSource;
  kind: PunchKind;
  at: string;
  /** Where (the system's: office, home, remote, unknown, with the location's name); null for Zoho's. */
  place: string | null;
  locationName: string | null;
  flags: string[];
}

/** A record removed, for a Super Admin. */
export interface RemovedRecordView {
  id: string;
  source: RecordSource;
  kind: PunchKind;
  at: string;
  reason: string;
  removedBy: string | null;
  removedAt: string;
}

/** GET /attendance/employees/:employeeId/records?date=: a day's records and which source counts. */
export interface DayRecordsView {
  employee: { id: string; fullNameEn: string; employeeCode: string };
  date: string;
  system: { kept: boolean; hoursCounted: number | null; records: DayRecordView[] };
  zoho: { kept: boolean; hoursCounted: number | null; records: DayRecordView[] };
  /** Removed and not restored: a Super Admin's only (empty for anyone else). */
  removed: RemovedRecordView[];
  /** The source the day uses now: a correction over it, else the one chosen, else the usual order; null: no day kept. */
  counts: 'correction' | 'system' | 'zoho' | null;
  /** The source the usual order takes (the system's over Zoho's); null: none. */
  usual: DaySourceChoice | null;
  chosen: { source: DaySourceChoice; reason: string; by: string | null; at: string } | null;
  /** Whether the caller may remove, restore and choose (a Super Admin, the month not locked). */
  canChange: boolean;
  /** Why the day can't change now (its payroll with the CEO, approved or paid); null: it can. */
  locked: string | null;
}

@Injectable()
export class AttendanceRecordsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly confidential: ConfidentialService,
    private readonly correctionDays: CorrectionDaysService,
    private readonly fill: AttendanceFillService,
    private readonly imports: AttendanceImportsService,
  ) {}

  // ---------- seeing ----------

  async day(employeeId: string, date: string, user: SessionUser): Promise<DayRecordsView> {
    const person = await this.visible(employeeId, user);
    const d = toDateOnly(date);
    const [punches, days, removals, choice, locked] = await Promise.all([
      this.prisma.attendancePunch.findMany({ where: { employeeId, date: d }, orderBy: { at: 'asc' }, select: { id: true, kind: true, at: true, place: true, locationName: true, flags: true } }),
      this.prisma.attendanceDay.findMany({ where: { employeeId, date: d }, select: { source: true, checkIn: true, checkOut: true, pairs: true, openAt: true, hoursCounted: true } }),
      isSuperAdmin(user)
        ? this.prisma.attendanceRecordRemoval.findMany({ where: { employeeId, date: d, restoredAt: null }, orderBy: { at: 'asc' }, include: { removedBy: { select: { id: true, email: true } } } })
        : Promise.resolve([]),
      this.prisma.attendanceDaySource.findUnique({ where: { employeeId_date: { employeeId, date: d } }, include: { chosenBy: { select: { id: true, email: true } } } }),
      this.lockOf(date),
    ]);
    const names = await userNames(this.prisma, [...removals.map((r) => r.removedBy), choice?.chosenBy ?? null]);
    const nameOf = (u: { id: string } | null) => (u ? (names.get(u.id)?.name ?? null) : null);
    const system = days.find((x) => x.source === 'system' || x.source === 'device') ?? null;
    const zoho = days.find((x) => x.source === 'zoho') ?? null;
    const correction = days.some((x) => x.source === 'correction');
    const usual: DaySourceChoice | null = system ? 'system' : zoho ? 'zoho' : null;
    const chosen = choice && isDaySourceChoice(choice.source) ? choice.source : null;
    return {
      employee: person,
      date,
      system: {
        kept: !!system,
        hoursCounted: system ? system.hoursCounted.toNumber() : null,
        records: punches.map((p) => ({ id: p.id, source: 'system', kind: p.kind as PunchKind, at: p.at.toISOString(), place: p.place, locationName: p.locationName, flags: p.flags })),
      },
      zoho: {
        kept: !!zoho,
        hoursCounted: zoho ? zoho.hoursCounted.toNumber() : null,
        records: zoho
          ? zohoDayPresses({ checkIn: zoho.checkIn?.toISOString() ?? null, checkOut: zoho.checkOut?.toISOString() ?? null, pairs: zoho.pairs, openAt: zoho.openAt?.toISOString() ?? null }).map((p) => ({
              id: zohoRecordId(p),
              source: 'zoho' as const,
              kind: p.kind,
              at: p.at,
              place: null,
              locationName: null,
              flags: [],
            }))
          : [],
      },
      removed: removals.map((r) => ({ id: r.id, source: r.source as RecordSource, kind: r.kind as PunchKind, at: r.at.toISOString(), reason: r.reason, removedBy: nameOf(r.removedBy), removedAt: r.removedAt.toISOString() })),
      counts: correction ? 'correction' : chosen && ((chosen === 'system' && system) || (chosen === 'zoho' && zoho)) ? chosen : usual,
      usual,
      chosen: choice && chosen ? { source: chosen, reason: choice.reason, by: nameOf(choice.chosenBy), at: choice.chosenAt.toISOString() } : null,
      canChange: isSuperAdmin(user) && !locked,
      locked,
    };
  }

  // ---------- removing and restoring ----------

  /** A Super Admin removes one record, with a reason: the day made again without it. */
  async remove(employeeId: string, dto: { date: string; source: string; recordId: string; reason: string }, user: SessionUser): Promise<DayRecordsView> {
    await this.visible(employeeId, user);
    const reason = this.reasonOf(dto.reason);
    if (!isRecordSource(dto.source)) throw new BadRequestException(['Choose the record’s source: system or zoho.']);
    await this.assertOpen(dto.date);
    const d = toDateOnly(dto.date);
    let removed: { id: string; kind: string; at: Date } | null = null;
    if (dto.source === 'system') {
      removed = await this.prisma.$transaction(async (tx) => {
        await this.lockPerson(tx, employeeId);
        const punch = await tx.attendancePunch.findFirst({ where: { id: dto.recordId, employeeId, date: d } });
        if (!punch) throw new NotFoundException(GONE);
        const row = await tx.attendanceRecordRemoval.create({
          data: { employeeId, date: d, source: 'system', kind: punch.kind, at: punch.at, punch: json(punchSnapshot(punch)), reason, removedById: user.id },
          select: { id: true, kind: true, at: true },
        });
        await tx.attendancePunch.delete({ where: { id: punch.id } });
        await this.remakeSystemDay(tx, employeeId, dto.date, user);
        return row;
      });
    } else {
      const zoho = await this.zohoDay(employeeId, dto.date);
      const press = zoho ? zoho.presses.find((p) => zohoRecordId(p) === dto.recordId) : null;
      if (!zoho || !press) throw new NotFoundException(GONE);
      // from the day's records before any removal, less those removed (this one too): a removal never loses another
      const { original, active } = await this.zohoRemovalsOn(employeeId, dto.date, zoho.presses);
      const remade = await this.workedZohoDay(employeeId, dto.date, zoho, original.filter((p) => !removesPress(press, p) && !active.some((r) => removesPress(r, p))));
      removed = await this.prisma.$transaction(async (tx) => {
        await this.lockPerson(tx, employeeId);
        const row = await tx.attendanceRecordRemoval.create({
          // the day's records as they were before any removal, kept to put back from (owner: "can be restored")
          data: { employeeId, date: d, source: 'zoho', kind: press.kind, at: new Date(press.at), punch: json({ presses: original }), reason, removedById: user.id },
          select: { id: true, kind: true, at: true },
        });
        await tx.attendanceDay.update({ where: { id: zoho.id }, data: remade });
        return row;
      });
    }
    await this.audit.record({
      userId: user.id,
      action: 'attendance_record_remove',
      entityType: 'attendance_record_removal',
      entityId: removed.id,
      diff: { employeeId, date: dto.date, source: dto.source, kind: removed.kind, at: removed.at.toISOString(), reason },
    });
    await this.afterChange(employeeId, dto.date, user);
    return this.day(employeeId, dto.date, user);
  }

  /** A Super Admin puts a record removed back: the day made again with it. */
  async restore(removalId: string, user: SessionUser): Promise<DayRecordsView> {
    const removal = await this.prisma.attendanceRecordRemoval.findUnique({ where: { id: removalId } });
    if (!removal) throw new NotFoundException('That removal isn’t there.');
    await this.visible(removal.employeeId, user);
    if (removal.restoredAt) throw new ConflictException('That record is back already. Reload the page.');
    const date = fromDateOnly(removal.date);
    await this.assertOpen(date);
    const employeeId = removal.employeeId;
    if (removal.source === 'system') {
      await this.prisma.$transaction(async (tx) => {
        await this.lockPerson(tx, employeeId);
        const { count } = await tx.attendanceRecordRemoval.updateMany({ where: { id: removal.id, restoredAt: null }, data: { restoredAt: new Date(), restoredById: user.id } });
        if (!count) throw new ConflictException('That record is back already. Reload the page.');
        const data = punchFromSnapshot(removal.punch, employeeId, removal.date);
        // what it pointed to gone meanwhile (an official duty, a user): put back without it
        if (data.odRequestId && !(await tx.odRequest.findUnique({ where: { id: data.odRequestId }, select: { id: true } }))) data.odRequestId = null;
        if (data.userId && !(await tx.user.findUnique({ where: { id: data.userId }, select: { id: true } }))) data.userId = null;
        if (data.id && (await tx.attendancePunch.findUnique({ where: { id: data.id }, select: { id: true } }))) data.id = undefined;
        await tx.attendancePunch.create({ data });
        await this.remakeSystemDay(tx, employeeId, date, user);
      });
    } else {
      const zoho = await this.zohoDay(employeeId, date);
      // from the day's records before any removal, less those still removed (not this one)
      const { original, active } = zoho ? await this.zohoRemovalsOn(employeeId, date, zoho.presses) : { original: [], active: [] };
      const still = active.filter((r) => r.id !== removal.id);
      const remade = zoho ? await this.workedZohoDay(employeeId, date, zoho, original.filter((p) => !still.some((r) => removesPress(r, p)))) : null;
      await this.prisma.$transaction(async (tx) => {
        await this.lockPerson(tx, employeeId);
        const { count } = await tx.attendanceRecordRemoval.updateMany({ where: { id: removal.id, restoredAt: null }, data: { restoredAt: new Date(), restoredById: user.id } });
        if (!count) throw new ConflictException('That record is back already. Reload the page.');
        // the Zoho day gone meanwhile (its import undone): nothing to put it in; the next fetch or import brings it
        if (zoho && remade) await tx.attendanceDay.update({ where: { id: zoho.id }, data: remade });
      });
    }
    await this.audit.record({
      userId: user.id,
      action: 'attendance_record_restore',
      entityType: 'attendance_record_removal',
      entityId: removal.id,
      diff: { employeeId, date, source: removal.source, kind: removal.kind, at: removal.at.toISOString() },
    });
    await this.afterChange(employeeId, date, user);
    return this.day(employeeId, date, user);
  }

  // ---------- which source counts ----------

  /** A Super Admin chooses which source a day with both uses, with a reason. */
  async choose(employeeId: string, date: string, dto: { source: string; reason: string }, user: SessionUser): Promise<DayRecordsView> {
    await this.visible(employeeId, user);
    const reason = this.reasonOf(dto.reason);
    if (!isDaySourceChoice(dto.source)) throw new BadRequestException(['Choose the source the day uses: zoho or system.']);
    await this.assertOpen(date);
    const d = toDateOnly(date);
    const kept = await this.prisma.attendanceDay.findMany({ where: { employeeId, date: d, source: { in: ['system', 'device', 'zoho'] } }, select: { source: true } });
    const both = kept.some((k) => k.source === 'zoho') && kept.some((k) => k.source !== 'zoho');
    if (!both) throw new ConflictException('This day doesn’t have both Zoho’s records and the system’s: there is nothing to choose.');
    const before = await this.prisma.attendanceDaySource.findUnique({ where: { employeeId_date: { employeeId, date: d } }, select: { source: true } });
    await this.prisma.attendanceDaySource.upsert({
      where: { employeeId_date: { employeeId, date: d } },
      create: { employeeId, date: d, source: dto.source, reason, chosenById: user.id },
      update: { source: dto.source, reason, chosenById: user.id, chosenAt: new Date() },
    });
    await this.audit.record({ userId: user.id, action: 'attendance_day_source', entityType: 'employee', entityId: employeeId, diff: { date, source: { from: before?.source ?? null, to: dto.source }, reason } });
    await this.afterChange(employeeId, date, user);
    return this.day(employeeId, date, user);
  }

  /** Back to the usual order for the day. */
  async clearChoice(employeeId: string, date: string, user: SessionUser): Promise<DayRecordsView> {
    await this.visible(employeeId, user);
    await this.assertOpen(date);
    const d = toDateOnly(date);
    const before = await this.prisma.attendanceDaySource.findUnique({ where: { employeeId_date: { employeeId, date: d } }, select: { source: true } });
    if (!before) throw new ConflictException('This day uses the usual source already. Reload the page.');
    await this.prisma.attendanceDaySource.delete({ where: { employeeId_date: { employeeId, date: d } } });
    await this.audit.record({ userId: user.id, action: 'attendance_day_source_clear', entityType: 'employee', entityId: employeeId, diff: { date, source: { from: before.source, to: null } } });
    await this.afterChange(employeeId, date, user);
    return this.day(employeeId, date, user);
  }

  // ---------- helpers ----------

  /** The person, when the caller sees their month (attendance.service.ts person) or is a Super Admin: else 404, as if not there. */
  private async visible(employeeId: string, user: SessionUser) {
    const me = await this.confidential.selfId(user);
    if (me !== employeeId) {
      if (await this.confidential.isHidden(user, employeeId)) throw new NotFoundException(NOT_FOUND);
      // a Super Admin too: the one who puts records right
      if (!seesEveryonesAttendance(user) && !isSuperAdmin(user)) {
        const team = me ? await teamOf(this.prisma, me) : [];
        if (!team.includes(employeeId)) throw new NotFoundException(NOT_FOUND);
      }
    }
    const person = await this.prisma.employee.findUnique({ where: { id: employeeId }, select: { id: true, fullNameEn: true, employeeCode: true } });
    if (!person) throw new NotFoundException(NOT_FOUND);
    return person;
  }

  private reasonOf(reason: unknown): string {
    const problem = recordReasonProblem(reason);
    if (problem) throw new BadRequestException([problem]);
    return (reason as string).trim();
  }

  /** Why the day's month can't change (its payroll with the CEO, approved or paid); null: it can. */
  private async lockOf(date: string): Promise<string | null> {
    const run = await this.prisma.payrollRun.findUnique({ where: { month: toDateOnly(`${date.slice(0, 7)}-01`) }, select: { status: true } });
    return recordLockRefusal(date, run?.status ?? null);
  }

  private async assertOpen(date: string): Promise<void> {
    const locked = await this.lockOf(date);
    if (locked) throw new ConflictException(locked);
  }

  /** Their row locked as a press locks it (check-in.service.ts), so nothing is lost meanwhile. */
  private async lockPerson(tx: Prisma.TransactionClient, employeeId: string) {
    await tx.$queryRaw`SELECT 1 FROM employees WHERE id = ${employeeId}::uuid FOR UPDATE`;
  }

  /** The day of the system's presses made again from those left, as a press makes it; none left: the day gone. */
  private async remakeSystemDay(db: Db, employeeId: string, date: string, user: SessionUser) {
    const d = toDateOnly(date);
    const punches = await db.attendancePunch.findMany({ where: { employeeId, date: d }, orderBy: { at: 'asc' }, select: { kind: true, at: true, place: true, flags: true } });
    if (!punches.length) {
      await db.attendanceDay.deleteMany({ where: { employeeId, date: d, source: 'system' } });
      return;
    }
    const employment = await db.employment.findFirst({
      where: { employeeId, joinDate: { lte: d }, OR: [{ endDate: null }, { endDate: { gte: d } }] },
      orderBy: { joinDate: 'desc' },
      select: EMPLOYMENT_SELECT,
    });
    const shift = employment?.shift ? shiftTimesOf(employment.shift) : null;
    const firstDay = employment ? await firstWorkingDayOn(db, employment, date) : false;
    const presses: PunchLike[] = punches.map((p) => ({ kind: p.kind as PunchKind, at: p.at.toISOString(), place: p.place as CheckInPlace, flags: p.flags }));
    const data = { ...keptDayData(dayFromPunches(date, presses, shift, { firstDay })), importedById: user.id, importedAt: new Date() };
    await db.attendanceDay.upsert({
      where: { employeeId_date_source: { employeeId, date: d, source: 'system' } },
      create: { employeeId, date: d, source: 'system', zohoStatus: null, permissionHours: null, importId: null, ...data },
      update: data,
    });
  }

  /** The person's Zoho day kept, with its records. */
  private async zohoDay(employeeId: string, date: string) {
    const row = await this.prisma.attendanceDay.findUnique({
      where: { employeeId_date_source: { employeeId, date: toDateOnly(date), source: 'zoho' } },
      select: { id: true, checkIn: true, checkOut: true, pairs: true, openAt: true, place: true, zohoStatus: true, permissionHours: true, zohoRunId: true },
    });
    if (!row) return null;
    const presses = zohoDayPresses({ checkIn: row.checkIn?.toISOString() ?? null, checkOut: row.checkOut?.toISOString() ?? null, pairs: row.pairs, openAt: row.openAt?.toISOString() ?? null });
    return { ...row, presses };
  }

  /**
   * A Zoho day's records before any removal (the first removal's copy of them; none removed: as kept now) and its
   * removals in force: the pairs kept after a removal can hide a record (a check-in after the check-out removed), so
   * the day is always worked out from the records as they were.
   */
  private async zohoRemovalsOn(employeeId: string, date: string, current: readonly DayPress[]): Promise<{ original: DayPress[]; active: (DayPress & { id: string })[] }> {
    const rows = await this.prisma.attendanceRecordRemoval.findMany({
      where: { employeeId, date: toDateOnly(date), source: 'zoho' },
      orderBy: { removedAt: 'asc' },
      select: { id: true, kind: true, at: true, punch: true, restoredAt: true },
    });
    const kept = rows.map((r) => (r.punch as { presses?: DayPress[] } | null)?.presses).find((p) => Array.isArray(p) && p.length);
    const original = kept ?? [...current];
    const active = rows.filter((r) => !r.restoredAt).map((r) => ({ id: r.id, kind: r.kind as DayPress['kind'], at: r.at.toISOString() }));
    // a record removed that the copy doesn't have (Zoho's day changed since): put back with its own moment
    for (const r of rows) {
      const p = { kind: r.kind as DayPress['kind'], at: r.at.toISOString() };
      if (!original.some((o) => removesPress(p, o))) original.push(p);
    }
    return { original, active };
  }

  /** The Zoho day worked out again from `presses` by the import's rules (AttendanceImportsService.months), as kept. */
  private async workedZohoDay(employeeId: string, date: string, zoho: NonNullable<Awaited<ReturnType<AttendanceRecordsService['zohoDay']>>>, presses: readonly DayPress[]) {
    const base: ImportedDay = {
      date,
      checkIn: null,
      checkOut: null,
      place: (zoho.place as WorkPlace | null) ?? null,
      zohoStatus: zoho.zohoStatus,
      permissionHours: zoho.permissionHours?.toNumber() ?? 0,
      pairs: null,
    };
    // a day fetched from Zoho People is kept by its pairs; an Excel import's by its first check-in and last check-out
    const byPairs = !!zoho.zohoRunId || !!zoho.openAt || (Array.isArray(zoho.pairs) && zoho.pairs.length > 0);
    const { day, openAt } = zohoDayFromPresses(base, presses, byPairs);
    const employment = await this.prisma.employment.findFirst({
      where: { employeeId, joinDate: { lte: toDateOnly(date) }, OR: [{ endDate: null }, { endDate: { gte: toDateOnly(date) } }] },
      orderBy: { joinDate: 'desc' },
      select: { id: true, shift: { select: { startTime: true, endTime: true, hoursPerDay: true, graceMinutes: true, countUntil: true, workingDays: true } } },
    });
    const worked = (await this.imports.months(date.slice(0, 7), [{ employeeId, employmentId: employment?.id ?? null, days: [day] }])).get(employeeId)?.days.find((x) => x.date === date);
    if (!worked) throw new ConflictException('This day is outside their employment: it can’t be worked out again.');
    const shift = employment?.shift ? shiftTimesOf(employment.shift) : null;
    const window = shift ? shiftWindowOn(date, shift) : null;
    const pairs = worked.pairs ?? null;
    return {
      checkIn: worked.checkIn ? new Date(worked.checkIn) : null,
      checkOut: worked.checkOut ? new Date(worked.checkOut) : null,
      status: worked.status,
      place: worked.place,
      hoursCounted: Math.round(worked.hoursCounted * 100) / 100,
      pairs: pairs ? json(pairs) : Prisma.DbNull,
      breakMinutes: pairs?.length ? breakMinutesOf(spansOfPairs(pairs), openAt ? Date.parse(openAt) : null, window) : null,
      openAt: openAt ? new Date(openAt) : null,
    };
  }

  /** As after a correction: a corrected day over it made again, the month's draft payroll refilled. */
  private async afterChange(employeeId: string, date: string, user: SessionUser) {
    await this.correctionDays.rebuildIfCorrected(employeeId, date, user);
    await this.fill.fillMonth(employeeId, date.slice(0, 7), user);
  }
}

/** A Zoho record's id on the page: its kind and moment. */
export const zohoRecordId = (p: DayPress) => `zoho:${p.kind}:${new Date(p.at).toISOString()}`;

type PunchRow = Prisma.AttendancePunchGetPayload<object>;

/** A press as kept whole with its removal (its spot as text, to put back to the same 6 decimals). */
function punchSnapshot(p: PunchRow) {
  return {
    id: p.id,
    kind: p.kind,
    at: p.at.toISOString(),
    place: p.place,
    accuracyMetres: p.accuracyMetres,
    latitude: p.latitude?.toString() ?? null,
    longitude: p.longitude?.toString() ?? null,
    expected: p.expected,
    flags: p.flags,
    locationName: p.locationName,
    locationKind: p.locationKind,
    officeNetwork: p.officeNetwork,
    odRequestId: p.odRequestId,
    source: p.source,
    userId: p.userId,
  };
}

/** The press put back from its snapshot, as it was. */
function punchFromSnapshot(snapshot: Prisma.JsonValue, employeeId: string, date: Date): Prisma.AttendancePunchUncheckedCreateInput {
  const s = (snapshot ?? {}) as Record<string, unknown>;
  const text = (v: unknown) => (typeof v === 'string' ? v : null);
  return {
    id: text(s.id) ?? undefined,
    employeeId,
    date,
    kind: text(s.kind) ?? 'in',
    at: new Date(text(s.at) ?? Date.now()),
    place: text(s.place) ?? 'unknown',
    accuracyMetres: typeof s.accuracyMetres === 'number' ? s.accuracyMetres : null,
    latitude: text(s.latitude),
    longitude: text(s.longitude),
    expected: text(s.expected) ?? 'office',
    flags: Array.isArray(s.flags) ? s.flags.filter((f): f is string => typeof f === 'string') : [],
    locationName: text(s.locationName),
    locationKind: text(s.locationKind),
    officeNetwork: text(s.officeNetwork),
    odRequestId: text(s.odRequestId),
    source: text(s.source) ?? 'system',
    userId: text(s.userId),
  };
}
