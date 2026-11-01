import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { checkInPlaceAt, PING_MIN_GAP_MINUTES, PING_OFF_LABELS, pingStatus, type PingStatus, type PingView } from '@trendlix/shared';
import { AuditService } from '../audit/audit.service.js';
import type { ActiveSession } from '../auth/sessions.service.js';
import type { SessionUser } from '../auth/session-user.js';
import { todayInCairo, toDateOnly } from '../common/date-only.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CheckInSetupService } from './check-in-setup.service.js';
import { HomeLocationsService } from './home-locations.service.js';
import type { LocationPingDto } from './location-pings.dto.js';

// Hourly location pings while checked in (owner, 1 November 2026: "can the devices ping every 1 hour their location? and
// flag if someone is not in the checked in location?"; chose "Silent automatic ping"). The app reads the location in
// the background every hour while its person is checked in and the company has it switched on (Check-in Setup), and
// sends it here; each is read against the check-in it follows (packages/shared location-pings.ts): at the place, away,
// can't tell, or the location off (not allowed all the time, or switched off). HR sees the flags on the day's records.
// From the app only (a website can't run in the background); the point kept as a check-in's is, to 6 decimals, never in
// the audit log.

export const PINGS_FROM_THE_APP = 'Location pings come from the app.';
export const NOT_CHECKED_IN = 'You aren’t checked in.';
export const PINGS_OFF = 'Hourly location is switched off.';

const coordinate = (v: number) => Math.round(v * 1e6) / 1e6;

@Injectable()
export class LocationPingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly setup: CheckInSetupService,
    private readonly homes: HomeLocationsService,
    private readonly audit: AuditService,
  ) {}

  /** Whether the company has the hourly location switched on. */
  async enabled(): Promise<boolean> {
    const s = await this.prisma.payrollSettings.findUnique({ where: { id: 1 }, select: { locationPings: true } });
    return s?.locationPings ?? false;
  }

  /** PUT …/location-pings: the company's switch, audited when it changes. */
  async setEnabled(enabled: boolean, user: SessionUser): Promise<{ enabled: boolean }> {
    const before = await this.enabled();
    if (before === enabled) return { enabled };
    await this.prisma.payrollSettings.upsert({ where: { id: 1 }, create: { id: 1, locationPings: enabled }, update: { locationPings: enabled } });
    await this.audit.record({ userId: user.id, action: 'update', entityType: 'check_in_location_pings', entityId: null, diff: { enabled: { from: before, to: enabled } } });
    return { enabled };
  }

  /**
   * POST /me/attendance/pings: one ping, read against the check-in it follows; refused off the app, while switched off
   * or when not checked in (the app stops then); one sooner than PING_MIN_GAP_MINUTES after the last isn't kept.
   */
  async ping(dto: LocationPingDto, user: SessionUser, session: Pick<ActiveSession, 'kind'>, now = new Date()): Promise<{ kept: boolean; status: PingStatus | null }> {
    if (session.kind !== 'app') throw new ForbiddenException(PINGS_FROM_THE_APP);
    const employeeId = user.employeeId;
    if (!employeeId) throw new ForbiddenException(NOT_CHECKED_IN);
    if (!(await this.enabled())) throw new ConflictException(PINGS_OFF);
    const reading =
      typeof dto.latitude === 'number' && typeof dto.longitude === 'number' ? { latitude: dto.latitude, longitude: dto.longitude, accuracy: dto.accuracy ?? null } : null;
    if (!reading && !dto.off) throw new BadRequestException(['Send the location, or why there is none.']);

    // the check-in it follows: their last press of the last day, a check-in not checked out yet
    const last = await this.prisma.attendancePunch.findFirst({
      where: { employeeId, at: { gte: new Date(now.getTime() - 24 * 3600_000) } },
      orderBy: { at: 'desc' },
    });
    if (!last || last.kind !== 'in') throw new ConflictException(NOT_CHECKED_IN);
    const recent = await this.prisma.attendancePing.findFirst({ where: { employeeId, at: { gte: new Date(now.getTime() - PING_MIN_GAP_MINUTES * 60_000) } }, select: { id: true } });
    if (recent) return { kept: false, status: null };

    let status: PingStatus = 'off';
    let read: { place: string | null; location: string | null; distance: number | null } = { place: null, location: null, distance: null };
    if (reading) {
      const [places, own] = await Promise.all([this.setup.checkInPlaces(employeeId), this.homes.ownPlaces(employeeId, todayInCairo())]);
      const at = checkInPlaceAt(reading, places, own.home, own.sites);
      const verdict = pingStatus(
        {
          place: last.place as Parameters<typeof pingStatus>[0]['place'],
          locationName: last.locationName,
          latitude: last.latitude === null ? null : Number(last.latitude),
          longitude: last.longitude === null ? null : Number(last.longitude),
        },
        { place: at.place, location: at.location ?? null, latitude: reading.latitude, longitude: reading.longitude, accuracy: reading.accuracy },
      );
      status = verdict.status;
      read = { place: at.place, location: at.location ?? null, distance: verdict.distanceMetres };
    }
    await this.prisma.attendancePing.create({
      data: {
        employeeId,
        date: last.date,
        at: now,
        punchId: last.id,
        status,
        offReason: reading ? null : (dto.off ?? null),
        place: read.place,
        locationName: read.location,
        latitude: reading ? coordinate(reading.latitude) : null,
        longitude: reading ? coordinate(reading.longitude) : null,
        accuracyMetres: reading?.accuracy != null ? Math.round(reading.accuracy) : null,
        distanceMetres: read.distance,
        mock: dto.mock === true,
      },
    });
    return { kept: true, status };
  }

  /** A day's pings of a person, as HR and the person see them, oldest first. */
  async ofDay(employeeId: string, date: string): Promise<PingView[]> {
    const rows = await this.prisma.attendancePing.findMany({ where: { employeeId, date: toDateOnly(date) }, orderBy: { at: 'asc' } });
    return rows.map((r) => ({
      at: r.at.toISOString(),
      status: r.status as PingStatus,
      placeText: r.offReason ? PING_OFF_LABELS[r.offReason as keyof typeof PING_OFF_LABELS] : (r.locationName ?? placeWord(r.place)),
      distanceMetres: r.distanceMetres,
      accuracyMetres: r.accuracyMetres,
      latitude: r.latitude === null ? null : Number(r.latitude),
      longitude: r.longitude === null ? null : Number(r.longitude),
    }));
  }
}

/** Where a ping's point was: the office, home, else elsewhere (a named place is said by its name). */
const placeWord = (place: string | null) => (place === 'office' ? 'Office' : place === 'home' ? 'Home' : 'Elsewhere');
