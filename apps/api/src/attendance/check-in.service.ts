import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import {
  APP_LOCATION_NEEDED_MESSAGE,
  checkInLocationsSet,
  checkInPlaceAt,
  checkInRefusal,
  dayFromPunches,
  expectedPlace,
  expectedPlaceText,
  locationRefusal,
  lockedToOfficeNetwork,
  needsLocation,
  nextPunch,
  NO_LOCATION_MESSAGE,
  OD_CHECK_IN_TEXT,
  odWhenText,
  OFF_NETWORK_MESSAGE,
  punchFlags,
  punchMessages,
  punchNetwork,
  shiftDayOf,
  waivesNetworkLock,
  type CheckInFlag,
  type CheckInPlace,
  type CheckInPlaces,
  type ExpectedPlace,
  type LocationRule,
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
import { approvedOdAt, approvedOdOn } from '../official-duty/od-days.js';
import { approvedWfhOn } from '../wfh/wfh-days.js';
import { AttendanceFillService } from './attendance-fill.service.js';
import { CheckInSetupService } from './check-in-setup.service.js';
import type { PunchDto } from './check-in.dto.js';
import { CorrectionDaysService } from './correction-days.service.js';
import { HomeLocationsService } from './home-locations.service.js';
import { coordinate, PUNCH_SELECT, punchView, type PunchRow, type PunchView } from './punch-views.js';
import type { SignedIp } from './signed-ip.js';

type Db = PrismaService | Prisma.TransactionClient;

/** A press twice within this long is one press (a double tap on a phone). */
const SAME_PRESS_MS = 60_000;

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
  /**
   * Whether their check-ins and check-outs need the office network (owner, 20 October 2026): the lock, for them; never on
   * a work from home day approved for them (21 October 2026).
   */
  network: { locked: boolean };
  /**
   * Whether the day is a work from home day approved for them (owner, 21 October 2026: "think about how should we handle
   * the working from home in out erp"; packages/shared wfh.ts): expected anywhere, the office network's lock waived.
   */
  workingFromHome: boolean;
  /**
   * An official duty approved for them today (owner, 23 October 2026: "Check in from anywhere"; packages/shared
   * official-duty.ts): its request, a full day or its times, and whether it is on now (a full day, or within a part
   * day's hours): then the office's location rule and the network's lock don't apply. Null: none today.
   */
  officialDuty: { requestId: string; fullDay: boolean; fromTime: string | null; toTime: string | null; now: boolean } | null;
  /**
   * The sub-locations they are linked to, by name (owner, 20 October 2026: "own sublocation shows the sub location
   * name"): their own check-in places, where they aren't flagged and, when locked, may check in off the office network.
   */
  ownPlaces: string[];
  /**
   * Whether their presses on the website need a location (owner, 20 October 2026: "Company switch + exceptions"): the
   * switch on and HR hasn't exempted them. Inside the app a location is always needed.
   */
  location: { required: boolean };
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
  checkInWithoutLocation: true,
  shift: { select: { startTime: true, endTime: true, hoursPerDay: true, graceMinutes: true, countUntil: true } },
} satisfies Prisma.EmploymentSelect;

type CheckInEmploymentRow = Prisma.EmploymentGetPayload<{ select: typeof EMPLOYMENT }>;

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
// refused or unavailable or the office's point isn't set; that, the accuracy and (since 20 October 2026, below) the
// point are kept. Their work arrangement says where they are expected (office:
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
// location unknown, unless the company refuses it (below). HR's own recording of a day (a correction) is never refused by either. Home locations (owner, 20
// October 2026: "Label Home, flag elsewhere"): for someone with an approved home, a check-in outside every office location
// within the home's radius is Home (remote for every other rule), and a remote one elsewhere is flagged "Not at home or
// the office"; nothing is refused for it, and the office network's lock is as before (an Office person locked to it is
// refused off it at home too, unless HR lets them check in from anywhere); the home's point is never kept on a punch.
// The spot kept (owner, 20 October 2026: "Yes, keep the spot"): each press keeps the point where it was made, read only
// then (a mock one too, flagged), never tracked and never in the audit log; the caller's own today shows it, and the
// Attendance pages show it to HR, the CEO and the Super Admin (punch-views.ts). Refusing presses without a location
// (owner, the same day: "Company switch + exceptions", "Allow as Office"): with Check-in Setup's switch on, a website
// press without a reading is refused (409) unless HR exempts the person or it comes from an office network the website
// signed (it is Office), in the audit log as check_in_refused, no_location, never with a point. The main office and
// its sub-locations (owner, 20 October 2026: "main office location is the hero and other locations are like sub
// locations"; "any checkin rather than the office location counts remote and named with the location name (Remote -
// Location name)"): a press is read against the main office, then the person's own sub-locations, then any, then their
// home (packages/shared checkInPlaceAt); within a sub-location it is kept as remote with the sub-location's name, and
// flagged "Not their location" for someone not linked to it. A locked Office person may press off the office network
// within their own sub-location (Claude's default, which the owner can change), never on a mock location.
@Injectable()
export class CheckInService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fill: AttendanceFillService,
    private readonly corrections: CorrectionDaysService,
    private readonly setup: CheckInSetupService,
    private readonly audit: AuditService,
    private readonly homes: HomeLocationsService,
  ) {}

  async today(user: SessionUser): Promise<CheckInTodayView> {
    const { employeeId, employment, refusal } = await this.who(user);
    const [locations, places, lock, rule] = await Promise.all([this.setup.officeLocations(), this.setup.checkInPlaces(employeeId), this.setup.lockSetting(), this.setup.locationRule()]);
    return this.view(this.prisma, employeeId, employment, refusal, { locations, places, lock, rule }, new Date());
  }

  async punch(dto: PunchDto, user: SessionUser, context: PunchContext): Promise<PunchResultView> {
    const { employeeId, employment, refusal } = await this.who(user);
    if (refusal || !employeeId || !employment) throw new ForbiddenException(refusal ?? 'You can’t check in on the system.');
    const reading = typeof dto.latitude === 'number' && typeof dto.longitude === 'number' ? { latitude: dto.latitude, longitude: dto.longitude, accuracy: dto.accuracy ?? null } : null;
    // their approved home, if any (20 October 2026): read against it after the office and the sub-locations, its point
    // never kept with the punch; the main office and the sub-locations, with theirs (20 October 2026)
    const [locations, places, lock, rule, home] = await Promise.all([
      this.setup.officeLocations(),
      this.setup.checkInPlaces(employeeId),
      this.setup.lockSetting(),
      this.setup.locationRule(),
      this.homes.homePoint(employeeId),
    ]);
    const now = new Date();
    const shift = shiftOf(employment);
    const date = shiftDayOf(now, shift);
    const mock = dto.mock === true;
    // a work from home day approved for them (owner, 21 October 2026): expected anywhere, the network's lock waived
    const workingFromHome = await approvedWfhOn(this.prisma, employeeId, date);
    // within an official duty approved for them (owner, 23 October 2026: "Check in from anywhere"): expected anywhere, the
    // network's lock waived, the spot kept as any press's, the press marked with it
    const od = await approvedOdAt(this.prisma, employeeId, date, now, shift);
    // the place read from the point: the main office (Office), their own sub-location, any sub-location (remote, its
    // name kept), their home, remote, or unknown (20 October 2026)
    const read = checkInPlaceAt(reading, places, home);
    // the office network (20 October 2026): refused off it when locked, unless within their own sub-location on a
    // location that isn't a mock one, or on a work from home day approved for them (21 October 2026); on it, at the office
    const network = punchNetwork(lock, employment, context.signedIp.ip ?? null, waivesNetworkLock(read, mock) || workingFromHome || od !== null);
    // without a location: in the app always refused, read at the press and never tracked (owner, 20 October 2026: "App
    // only"); on the website when the company refuses it for them, unless from an office network ("Allow as Office")
    const withoutLocation = locationRefusal({ session: context.session, reading: reading !== null, rule, person: employment, officeNetwork: network.network !== null });
    if (withoutLocation === 'app') throw new ConflictException(APP_LOCATION_NEEDED_MESSAGE);
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
    if (withoutLocation === 'no_location') {
      // what was pressed, the day and why: there is no point to leave out
      await this.audit.record({ userId: user.id, action: 'check_in_refused', entityType: 'employee', entityId: employeeId, diff: { kind: dto.kind, date, reason: 'no_location' } });
      throw new ConflictException(NO_LOCATION_MESSAGE);
    }
    // on an office network it is Office whatever the location says (the networks mean the main office), the main
    // office's name kept when it was within it; else the place read, with the main office's or the sub-location's name.
    // The point itself kept with the press, to 6 decimals (owner, 20 October 2026: "Yes, keep the spot"), a mock one too
    const officeNetwork = network.network;
    const place: CheckInPlace = officeNetwork ? 'office' : read.place;
    const { accuracyMetres } = read;
    const locationName = (officeNetwork ? (read.place === 'office' ? read.location : null) : read.location) ?? null;
    const subLocation = officeNetwork ? null : (read.subLocation ?? null);
    const point = reading ? { latitude: coordinate(reading.latitude), longitude: coordinate(reading.longitude) } : { latitude: null, longitude: null };
    const expected = expectedPlace(employment.workArrangement, employment.officeDays, weekday(date), workingFromHome || od !== null);
    // a check-in breaking the arrangement's rule (not at their own sub-location), and any press on a location the phone
    // said is a mock one (fake GPS); a remote check-in by someone with an approved home, away from it, the office and
    // the sub-locations (not at home or the office); one within a sub-location they aren't linked to (not their location)
    const flags = punchFlags(dto.kind, expected, place, mock, home !== null, subLocation);

    const { kept, earlier } = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM employees WHERE id = ${employeeId}::uuid FOR UPDATE`;
      const before = await tx.attendancePunch.findMany({ where: { employeeId, date: toDateOnly(date) }, orderBy: { at: 'asc' } });
      const last = before.at(-1);
      // the same press twice (a double tap): kept once
      if (last && last.kind === dto.kind && now.getTime() - last.at.getTime() < SAME_PRESS_MS) return { kept: false, earlier: before };
      await tx.attendancePunch.create({
        data: { employeeId, date: toDateOnly(date), kind: dto.kind, at: now, place, accuracyMetres, ...point, expected, flags, locationName, officeNetwork, source: 'system', userId: user.id, odRequestId: od?.id ?? null },
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
    const view = await this.view(this.prisma, employeeId, employment, null, { locations, places, lock, rule }, now);
    const messages = kept
      ? punchMessages({ kind: dto.kind, at: now.toISOString(), place, flags, locationName }, earlier.map(asPunch), {
          locationError: dto.locationError ?? null,
          officeSet: checkInLocationsSet(locations),
        })
      : [`Already ${dto.kind === 'in' ? 'checked in' : 'checked out'} a moment ago: that press is kept once.`];
    return { ...view, messages, kept };
  }

  // ---------- helpers ----------

  /** The caller's profile and current employment, and why they can't check in (null: they can). */
  private async who(user: SessionUser): Promise<{ employeeId: string | null; employment: CheckInEmploymentRow | null; refusal: string | null }> {
    const me = await (user.employeeId ? this.prisma.employee.findUnique({ where: { id: user.employeeId }, select: { id: true } }) : null);
    const employment = me ? await this.prisma.employment.findFirst({ where: { employeeId: me.id, endDate: null }, orderBy: { joinDate: 'desc' }, select: EMPLOYMENT }) : null;
    return { employeeId: me?.id ?? null, employment, refusal: checkInRefusal(!!me, employment) };
  }

  private async view(
    db: Db,
    employeeId: string | null,
    employment: CheckInEmploymentRow | null,
    refusal: string | null,
    setup: { locations: readonly OfficeLocation[]; places: CheckInPlaces; lock: NetworkLockSetting; rule: LocationRule },
    now: Date,
  ): Promise<CheckInTodayView> {
    const { locations, places, lock, rule } = setup;
    const shift = employment ? shiftOf(employment) : null;
    const date = shiftDayOf(now, shift);
    const [punches, workingFromHome]: [PunchRow[], boolean] = employeeId
      ? await Promise.all([db.attendancePunch.findMany({ where: { employeeId, date: toDateOnly(date) }, orderBy: { at: 'asc' }, select: PUNCH_SELECT }), approvedWfhOn(db, employeeId, date)])
      : [[], false];
    // an official duty approved for them today, and whether it is on now (23 October 2026)
    const [odToday, odNow] = employeeId ? await Promise.all([approvedOdOn(db, employeeId, date), approvedOdAt(db, employeeId, date, now, shift)]) : [null, null];
    const duty = odNow ?? odToday;
    const anywhere = workingFromHome || odNow !== null;
    const expected = employment ? expectedPlace(employment.workArrangement, employment.officeDays, weekday(date), anywhere) : null;
    return {
      refusal,
      date,
      now: now.toISOString(),
      next: nextPunch(punches.map(asPunch)),
      // their own: with the spot (owner, 20 October 2026: "Yes, keep the spot")
      punches: punches.map((p) => punchView(p, true, locations)),
      day: punches.length ? dayFromPunches(date, punches.map(asPunch), shift) : null,
      expected,
      expectedText:
        employment && expected
          ? odNow
            ? OD_CHECK_IN_TEXT
            : odToday
              ? `Official duty today, ${odWhenText(odToday).split(', ')[1] ?? 'part of the day'}: check in from where you are then. ${expectedPlaceText(employment.workArrangement, expected, workingFromHome)}`
              : expectedPlaceText(employment.workArrangement, expected, workingFromHome)
          : null,
      officeLocationSet: checkInLocationsSet(locations),
      network: { locked: !!employment && lockedToOfficeNetwork(lock, employment) && !anywhere },
      workingFromHome,
      officialDuty: duty && { requestId: duty.id, fullDay: duty.fullDay, fromTime: duty.fromTime, toTime: duty.toTime, now: odNow !== null },
      ownPlaces: places.subLocations.filter((l) => l.linked).map((l) => l.name),
      location: { required: !!employment && needsLocation(rule, employment) },
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
