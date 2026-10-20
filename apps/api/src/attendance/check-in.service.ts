import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import {
  APP_LOCATION_NEEDED_MESSAGE,
  checkInLocationsSet,
  checkInPlace,
  checkInRefusal,
  dayFromPunches,
  expectedPlace,
  expectedPlaceText,
  lockedToOfficeNetwork,
  nextPunch,
  OFF_NETWORK_MESSAGE,
  punchFlags,
  punchMessages,
  punchNetwork,
  shiftDayOf,
  type CheckInFlag,
  type CheckInPlace,
  type ExpectedPlace,
  type NetworkLockSetting,
  type OfficeLocation,
  type PunchKind,
  type PunchLike,
  type SessionKind,
} from '@trendlix/shared';
import { AuditService } from '../audit/audit.service.js';
import type { SessionUser } from '../auth/session-user.js';
import { toDateOnly, weekday } from '../common/date-only.js';
import { fromTimeOfDay } from '../common/time-of-day.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AttendanceFillService } from './attendance-fill.service.js';
import { CheckInSetupService } from './check-in-setup.service.js';
import type { PunchDto } from './check-in.dto.js';
import { CorrectionDaysService } from './correction-days.service.js';
import type { SignedIp } from './signed-ip.js';

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
  /** The check-in location it was within, by its name then; the office network it came from, by its name. */
  locationName: string | null;
  officeNetwork: string | null;
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
  /** Whether a check-in location is set (Attendance → Check-in Setup): without one every check-in is location unknown. */
  officeLocationSet: boolean;
  /** Whether their check-ins and check-outs need the office network (owner, 20 October 2026): the lock, for them. */
  network: { locked: boolean };
  /**
   * Their shift: its window (HH:MM), its hours a day, its grace minutes and the time it counts hours until (HH:MM; owner,
   * 20 October 2026: "no working hours to be counted after 8 PM even if the check out was 11 PM"; null: none).
   */
  shift: { startTime: string; endTime: string; hoursPerDay: number | null; graceMinutes: number; countUntil: string | null } | null;
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
  checkInAnywhere: true,
  shift: { select: { startTime: true, endTime: true, hoursPerDay: true, graceMinutes: true, countUntil: true } },
} satisfies Prisma.EmploymentSelect;

type CheckInEmploymentRow = Prisma.EmploymentGetPayload<{ select: typeof EMPLOYMENT }>;

const punchView = (p: { kind: string; at: Date; place: string; accuracyMetres: number | null; flags: string[]; locationName: string | null; officeNetwork: string | null }): PunchView => ({
  kind: p.kind as PunchKind,
  at: p.at.toISOString(),
  place: p.place as CheckInPlace,
  accuracyMetres: p.accuracyMetres,
  flags: p.flags as CheckInFlag[],
  locationName: p.locationName,
  officeNetwork: p.officeNetwork,
});

/** What a press brings besides its body: the session's kind (the website or the app) and the address the website signed. */
export interface PunchContext {
  session: SessionKind;
  signedIp: SignedIp;
}

// Checking in on the system (owner, 19 October 2026, "Proceed with those": "Check-in through the system (phone or web
// with the office location check, or a device) to replace Zoho"). Someone with an employee profile and a current
// employment under a shift, not a freelancer (packages/shared checkInRefusal), presses Check in or Check out on their
// Dashboard or My Attendance: one press, at the server's time (Cairo), counted on the working day it is in (shiftDayOf:
// a night shift's check-out after midnight on the night before). The browser's location, asked each time, is read
// against the office's point and radius (Payroll Setup → Your Rules): office within it, remote outside it, unknown when
// refused or unavailable or the office's point isn't set; only that and the accuracy are kept, the point is dropped
// here (the owner chose to keep only office or remote). Their work arrangement says where they are expected (office:
// the office; hybrid: the office on its office days; anyone else anywhere): a check-in elsewhere is kept, flagged for
// the manager and HR, never refused. A press on a location the employee app said is a mock one (fake GPS on Android,
// `mock`, the app's Phase 2, 20 October 2026) is kept the same way, its place read as any other, and flagged "Fake GPS
// suspected". Each press is a punch (the same press twice within a minute kept once); the day is
// kept from them (AttendanceDay, source 'system': the first check-in, the last check-out after it, its hours by the
// shift's rule and grace), in a transaction holding the employee's row; then the month's draft payroll line takes it
// (attendance-fill.service.ts), a day corrected already made again with it (correction-days.service.ts). Not in the
// audit log: the punches are their own record. Several check-in locations since 20 October 2026 (owner: "Own page,
// several locations", Attendance → Check-in Setup): within any one's radius is the office, its name kept with the punch.
// Locked to the office network (owner, 20 October 2026: "allow me to lock checkin's to wifi name or ip, whatever is
// right"): with the lock in force, an Office employee HR hasn't let check in from anywhere is refused a check-in or a
// check-out (409) unless the address the website signed is on one of the office networks; a press on the office network
// is at the office whatever the location says, its network's name kept with it, never the address. A refused press is
// in the audit log, without the address. Inside the employee app (owner, 20 October 2026: "dont allow checkins without
// location is always active", "Refuse without location", "App only"): a press without a location is refused (409),
// with how to turn it on; the office network doesn't waive it. On the website a press without one is kept as before,
// location unknown. HR's own recording of a day (a correction) is never refused by either.
@Injectable()
export class CheckInService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fill: AttendanceFillService,
    private readonly corrections: CorrectionDaysService,
    private readonly setup: CheckInSetupService,
    private readonly audit: AuditService,
  ) {}

  async today(user: SessionUser): Promise<CheckInTodayView> {
    const { employeeId, employment, refusal } = await this.who(user);
    const [locations, lock] = await Promise.all([this.setup.officeLocations(), this.setup.lockSetting()]);
    return this.view(this.prisma, employeeId, employment, refusal, locations, lock, new Date());
  }

  async punch(dto: PunchDto, user: SessionUser, context: PunchContext): Promise<PunchResultView> {
    const { employeeId, employment, refusal } = await this.who(user);
    if (refusal || !employeeId || !employment) throw new ForbiddenException(refusal ?? 'You can’t check in on the system.');
    const reading = typeof dto.latitude === 'number' && typeof dto.longitude === 'number' ? { latitude: dto.latitude, longitude: dto.longitude, accuracy: dto.accuracy ?? null } : null;
    // in the app a location is needed, read at the press and never tracked (owner, 20 October 2026: "App only")
    if (context.session === 'app' && !reading) throw new ConflictException(APP_LOCATION_NEEDED_MESSAGE);
    const [locations, lock] = await Promise.all([this.setup.officeLocations(), this.setup.lockSetting()]);
    const now = new Date();
    const shift = shiftOf(employment);
    const date = shiftDayOf(now, shift);
    // the office network (20 October 2026): refused off it when locked; on it, at the office
    const network = punchNetwork(lock, employment, context.signedIp.ip ?? null);
    if (network.refused) {
      await this.audit.record({
        userId: user.id,
        action: 'check_in_refused',
        entityType: 'employee',
        entityId: employeeId,
        // never the address: what was pressed, the day, and why (none signed, or signed and off the networks)
        diff: { kind: dto.kind, date, reason: context.signedIp.ip ? 'off_network' : 'not_signed' },
      });
      throw new ConflictException(OFF_NETWORK_MESSAGE);
    }
    // the point read and dropped: only office, remote or unknown, the accuracy and the location's name go further
    const read = checkInPlace(reading, locations);
    const place: CheckInPlace = network.network ? 'office' : read.place;
    const { accuracyMetres } = read;
    const locationName = read.location ?? null;
    const officeNetwork = network.network;
    const expected = expectedPlace(employment.workArrangement, employment.officeDays, weekday(date));
    // a check-in breaking the arrangement's rule, and any press on a location the phone said is a mock one (fake GPS)
    const flags = punchFlags(dto.kind, expected, place, dto.mock === true);

    const { kept, earlier } = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM employees WHERE id = ${employeeId}::uuid FOR UPDATE`;
      const before = await tx.attendancePunch.findMany({ where: { employeeId, date: toDateOnly(date) }, orderBy: { at: 'asc' } });
      const last = before.at(-1);
      // the same press twice (a double tap): kept once
      if (last && last.kind === dto.kind && now.getTime() - last.at.getTime() < SAME_PRESS_MS) return { kept: false, earlier: before };
      await tx.attendancePunch.create({
        data: { employeeId, date: toDateOnly(date), kind: dto.kind, at: now, place, accuracyMetres, expected, flags, locationName, officeNetwork, source: 'system', userId: user.id },
      });
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
    const view = await this.view(this.prisma, employeeId, employment, null, locations, lock, now);
    const messages = kept
      ? punchMessages({ kind: dto.kind, at: now.toISOString(), place, flags }, earlier.map(asPunch), { locationError: dto.locationError ?? null, officeSet: checkInLocationsSet(locations) })
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

  private async view(
    db: Db,
    employeeId: string | null,
    employment: CheckInEmploymentRow | null,
    refusal: string | null,
    locations: readonly OfficeLocation[],
    lock: NetworkLockSetting,
    now: Date,
  ): Promise<CheckInTodayView> {
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
      officeLocationSet: checkInLocationsSet(locations),
      network: { locked: !!employment && lockedToOfficeNetwork(lock, employment) },
      shift: shift && { startTime: shift.startTime, endTime: shift.endTime, hoursPerDay: shift.hoursPerDay ?? null, graceMinutes: shift.graceMinutes ?? 0, countUntil: shift.countUntil },
    };
  }
}

/** The employment's shift as the shared rules count a day with it. */
function shiftOf(e: CheckInEmploymentRow) {
  const s = e.shift;
  return s
    ? {
        startTime: fromTimeOfDay(s.startTime),
        endTime: fromTimeOfDay(s.endTime),
        hoursPerDay: s.hoursPerDay?.toNumber() ?? null,
        graceMinutes: s.graceMinutes,
        // a day counts until it, past the hours to work (owner, 20 October 2026)
        countUntil: s.countUntil ? fromTimeOfDay(s.countUntil) : null,
      }
    : null;
}

/** A kept punch as the shared rules take it. */
const asPunch = (p: { kind: string; at: Date; place: string; flags: readonly string[] }): PunchLike => ({ kind: p.kind as PunchKind, at: p.at.toISOString(), place: p.place as CheckInPlace, flags: p.flags });
