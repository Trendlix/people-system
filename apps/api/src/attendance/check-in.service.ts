import { ForbiddenException, Injectable } from '@nestjs/common';
import {
  checkInFlags,
  checkInPlace,
  checkInRefusal,
  dayFromPunches,
  expectedPlace,
  expectedPlaceText,
  nextPunch,
  OFFICE_RADIUS_DEFAULT,
  officeLocationSet,
  punchMessages,
  shiftDayOf,
  type CheckInFlag,
  type CheckInPlace,
  type ExpectedPlace,
  type OfficeLocation,
  type PunchKind,
  type PunchLike,
} from '@trendlix/shared';
import type { SessionUser } from '../auth/session-user.js';
import { toDateOnly, weekday } from '../common/date-only.js';
import { fromTimeOfDay } from '../common/time-of-day.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AttendanceFillService } from './attendance-fill.service.js';
import type { PunchDto } from './check-in.dto.js';
import { CorrectionDaysService } from './correction-days.service.js';

type Db = PrismaService | Prisma.TransactionClient;

/** A press twice within this long is one press (a double tap on a phone). */
const SAME_PRESS_MS = 60_000;

/** A punch as the employee's day shows it. */
export interface PunchView {
  kind: PunchKind;
  at: string;
  place: CheckInPlace;
  accuracyMetres: number | null;
  flags: CheckInFlag[];
}

/** GET /me/attendance/today: whether they check in, today's punches and day, and what is next. */
export interface CheckInTodayView {
  /** Null: they check in on the system; else why not, in a sentence. */
  refusal: string | null;
  /** The working day the next punch counts on (YYYY-MM-DD, Cairo). */
  date: string;
  /** The server's time now (ISO): the time a punch takes. */
  now: string;
  next: PunchKind;
  punches: PunchView[];
  /** The day as the punches make it: the first check-in, the last check-out, the place, the flags, the hours counted. */
  day: { checkIn: string | null; checkOut: string | null; place: CheckInPlace | null; flags: CheckInFlag[]; hoursCounted: number } | null;
  /** Where their work arrangement expects them today, and in words. */
  expected: ExpectedPlace | null;
  expectedText: string | null;
  /** Whether the office's point is set (Payroll Setup → Your Rules): without it every check-in is location unknown. */
  officeLocationSet: boolean;
  /** Their shift: its window (HH:MM), its hours a day and its grace minutes. */
  shift: { startTime: string; endTime: string; hoursPerDay: number | null; graceMinutes: number } | null;
}

/** POST /me/attendance/punches: the day after the punch, and what to tell them. */
export interface PunchResultView extends CheckInTodayView {
  messages: string[];
  /** False when it was the same press twice (kept once). */
  kept: boolean;
}

/** The current employment as checking in needs it. */
const EMPLOYMENT = {
  id: true,
  employmentType: true,
  shiftId: true,
  workArrangement: true,
  officeDays: true,
  shift: { select: { startTime: true, endTime: true, hoursPerDay: true, graceMinutes: true } },
} satisfies Prisma.EmploymentSelect;

type CheckInEmploymentRow = Prisma.EmploymentGetPayload<{ select: typeof EMPLOYMENT }>;

const punchView = (p: { kind: string; at: Date; place: string; accuracyMetres: number | null; flags: string[] }): PunchView => ({
  kind: p.kind as PunchKind,
  at: p.at.toISOString(),
  place: p.place as CheckInPlace,
  accuracyMetres: p.accuracyMetres,
  flags: p.flags as CheckInFlag[],
});

// Checking in on the system (owner, 19 October 2026, "Proceed with those": "Check-in through the system (phone or web
// with the office location check, or a device) to replace Zoho"). Someone with an employee profile and a current
// employment under a shift, not a freelancer (packages/shared checkInRefusal), presses Check in or Check out on their
// Dashboard or My Attendance: one press, at the server's time (Cairo), counted on the working day it is in (shiftDayOf:
// a night shift's check-out after midnight on the night before). The browser's location, asked each time, is read
// against the office's point and radius (Payroll Setup → Your Rules): office within it, remote outside it, unknown when
// refused or unavailable or the office's point isn't set; only that and the accuracy are kept, the point is dropped
// here (the owner chose to keep only office or remote). Their work arrangement says where they are expected (office:
// the office; hybrid: the office on its office days; anyone else anywhere): a check-in elsewhere is kept, flagged for
// the manager and HR, never refused. Each press is a punch (the same press twice within a minute kept once); the day is
// kept from them (AttendanceDay, source 'system': the first check-in, the last check-out after it, its hours by the
// shift's rule and grace), in a transaction holding the employee's row; then the month's draft payroll line takes it
// (attendance-fill.service.ts), a day corrected already made again with it (correction-days.service.ts). Not in the
// audit log: the punches are their own record.
@Injectable()
export class CheckInService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fill: AttendanceFillService,
    private readonly corrections: CorrectionDaysService,
  ) {}

  async today(user: SessionUser): Promise<CheckInTodayView> {
    const { employeeId, employment, refusal } = await this.who(user);
    const office = await this.office();
    return this.view(this.prisma, employeeId, employment, refusal, office, new Date());
  }

  async punch(dto: PunchDto, user: SessionUser): Promise<PunchResultView> {
    const { employeeId, employment, refusal } = await this.who(user);
    if (refusal || !employeeId || !employment) throw new ForbiddenException(refusal ?? 'You can’t check in on the system.');
    const office = await this.office();
    const now = new Date();
    const shift = shiftOf(employment);
    const date = shiftDayOf(now, shift);
    const reading = typeof dto.latitude === 'number' && typeof dto.longitude === 'number' ? { latitude: dto.latitude, longitude: dto.longitude, accuracy: dto.accuracy ?? null } : null;
    // the point read and dropped: only office, remote or unknown and the accuracy go further
    const { place, accuracyMetres } = checkInPlace(reading, office);
    const expected = expectedPlace(employment.workArrangement, employment.officeDays, weekday(date));
    const flags = dto.kind === 'in' ? checkInFlags(expected, place) : [];

    const { kept, earlier } = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM employees WHERE id = ${employeeId}::uuid FOR UPDATE`;
      const before = await tx.attendancePunch.findMany({ where: { employeeId, date: toDateOnly(date) }, orderBy: { at: 'asc' } });
      const last = before.at(-1);
      // the same press twice (a double tap): kept once
      if (last && last.kind === dto.kind && now.getTime() - last.at.getTime() < SAME_PRESS_MS) return { kept: false, earlier: before };
      await tx.attendancePunch.create({ data: { employeeId, date: toDateOnly(date), kind: dto.kind, at: now, place, accuracyMetres, expected, flags, source: 'system', userId: user.id } });
      const punches = [...before, { kind: dto.kind, at: now, place, flags }];
      const day = dayFromPunches(date, punches.map(asPunch), shift);
      const data = {
        checkIn: day.checkIn ? new Date(day.checkIn) : null,
        checkOut: day.checkOut ? new Date(day.checkOut) : null,
        status: 'worked',
        place: day.place,
        flags: day.flags,
        hoursCounted: Math.round(day.hoursCounted * 100) / 100,
        importedById: user.id,
        importedAt: now,
      };
      await tx.attendanceDay.upsert({
        where: { employeeId_date_source: { employeeId, date: toDateOnly(date), source: 'system' } },
        create: { employeeId, date: toDateOnly(date), source: 'system', zohoStatus: null, permissionHours: null, importId: null, ...data },
        update: data,
      });
      return { kept: true, earlier: before };
    });
    if (kept) {
      // a correction of the day approved already (a correction of today) takes the punch too (19 October 2026)
      await this.corrections.rebuildIfCorrected(employeeId, date, user);
      await this.fill.fillMonth(employeeId, date.slice(0, 7), user);
    }
    const view = await this.view(this.prisma, employeeId, employment, null, office, now);
    const messages = kept
      ? punchMessages({ kind: dto.kind, at: now.toISOString(), place, flags }, earlier.map(asPunch), { locationError: dto.locationError ?? null, officeSet: officeLocationSet(office) })
      : [`Already ${dto.kind === 'in' ? 'checked in' : 'checked out'} a moment ago: that press is kept once.`];
    return { ...view, messages, kept };
  }

  // ---------- helpers ----------

  /** The caller's profile and current employment, and why they can't check in (null: they can). */
  private async who(user: SessionUser): Promise<{ employeeId: string | null; employment: CheckInEmploymentRow | null; refusal: string | null }> {
    const me = await this.prisma.employee.findUnique({ where: { workEmail: user.email.toLowerCase() }, select: { id: true } });
    const employment = me ? await this.prisma.employment.findFirst({ where: { employeeId: me.id, endDate: null }, orderBy: { joinDate: 'desc' }, select: EMPLOYMENT }) : null;
    return { employeeId: me?.id ?? null, employment, refusal: checkInRefusal(!!me, employment) };
  }

  /** The office's point and radius (Payroll Setup → Your Rules). */
  private async office(): Promise<OfficeLocation> {
    const s = await this.prisma.payrollSettings.findUnique({ where: { id: 1 }, select: { officeLatitude: true, officeLongitude: true, officeRadiusMetres: true } });
    return { latitude: s?.officeLatitude?.toNumber() ?? null, longitude: s?.officeLongitude?.toNumber() ?? null, radiusMetres: s?.officeRadiusMetres ?? OFFICE_RADIUS_DEFAULT };
  }

  private async view(db: Db, employeeId: string | null, employment: CheckInEmploymentRow | null, refusal: string | null, office: OfficeLocation, now: Date): Promise<CheckInTodayView> {
    const shift = employment ? shiftOf(employment) : null;
    const date = shiftDayOf(now, shift);
    const punches = employeeId ? await db.attendancePunch.findMany({ where: { employeeId, date: toDateOnly(date) }, orderBy: { at: 'asc' } }) : [];
    const expected = employment ? expectedPlace(employment.workArrangement, employment.officeDays, weekday(date)) : null;
    return {
      refusal,
      date,
      now: now.toISOString(),
      next: nextPunch(punches.map(asPunch)),
      punches: punches.map(punchView),
      day: punches.length ? dayFromPunches(date, punches.map(asPunch), shift) : null,
      expected,
      expectedText: employment && expected ? expectedPlaceText(employment.workArrangement, expected) : null,
      officeLocationSet: officeLocationSet(office),
      shift: shift && { startTime: shift.startTime, endTime: shift.endTime, hoursPerDay: shift.hoursPerDay ?? null, graceMinutes: shift.graceMinutes ?? 0 },
    };
  }
}

/** The employment's shift as the shared rules count a day with it. */
function shiftOf(e: CheckInEmploymentRow) {
  const s = e.shift;
  return s ? { startTime: fromTimeOfDay(s.startTime), endTime: fromTimeOfDay(s.endTime), hoursPerDay: s.hoursPerDay?.toNumber() ?? null, graceMinutes: s.graceMinutes } : null;
}

/** A kept punch as the shared rules take it. */
const asPunch = (p: { kind: string; at: Date; place: string; flags: readonly string[] }): PunchLike => ({ kind: p.kind as PunchKind, at: p.at.toISOString(), place: p.place as CheckInPlace, flags: p.flags });
