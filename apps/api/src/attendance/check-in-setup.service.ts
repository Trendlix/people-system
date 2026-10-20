import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  CHECK_IN_LOCATIONS_MAX,
  checkInLocationProblems,
  LOCK_NEEDS_KEY_MESSAGE,
  matchOfficeNetwork,
  networkLockInForce,
  OFFICE_RADIUS_DEFAULT,
  officeNetworksFrom,
  SIGNED_IP_PROBLEM_TEXT,
  webKeyUsable,
  type LocationRule,
  type NetworkLockSetting,
  type OfficeLocation,
  type OfficeNetwork,
  type SignedIpProblem,
} from '@trendlix/shared';
import type { Request } from 'express';
import { AuditService, changes } from '../audit/audit.service.js';
import { readToken } from '../auth/auth.guard.js';
import { assertDeletes } from '../auth/roles.js';
import type { SessionUser } from '../auth/session-user.js';
import type { CheckInLocation } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CreateCheckInLocationDto, UpdateCheckInLocationDto, UpdateLocationRuleDto, UpdateOfficeNetworksDto } from './check-in-setup.dto.js';
import { verifySignedIp, type SignedIp } from './signed-ip.js';

const LOCATION = 'check_in_location';
const NETWORKS = 'office_networks';
const LOCATION_RULE = 'check_in_location_rule';

/** A check-in location as the API sends it. */
export interface CheckInLocationView {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  radiusMetres: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * GET /attendance/check-in-setup/networks: the office networks, the switch, whether the server has the key and the lock
 * is in force, and this very request's address as the website signed it (the office network it is on), or why it
 * can't be trusted: so the page says "Ready" or what is missing, and offers the network HR is on now.
 */
export interface OfficeNetworksView {
  lock: boolean;
  networks: OfficeNetwork[];
  serverKey: boolean;
  inForce: boolean;
  here: { signed: true; ip: string; network: string | null } | { signed: false; problem: SignedIpProblem };
}

const locationView = (l: CheckInLocation): CheckInLocationView => ({
  id: l.id,
  name: l.name,
  latitude: l.latitude.toNumber(),
  longitude: l.longitude.toNumber(),
  radiusMetres: l.radiusMetres,
  createdAt: l.createdAt.toISOString(),
  updatedAt: l.updatedAt.toISOString(),
});

/** A coordinate kept to 6 decimals (about 10 cm), as the column keeps it. */
const coordinate = (n: number) => Math.round(n * 1e6) / 1e6 + 0;

/** The networks as kept (JSON): only well-formed entries, in case the column was ever written by hand. */
function networksOf(json: unknown): OfficeNetwork[] {
  if (!Array.isArray(json)) return [];
  return json.filter((n): n is OfficeNetwork => !!n && typeof n === 'object' && typeof n.label === 'string' && typeof n.range === 'string');
}

// Attendance → Check-in Setup (owner, 20 October 2026: "i cant find in the system where to add the eligable check in
// locations", then "Own page, several locations"): the check-in locations, within any of which a check-in on the system
// is at the office, and the office networks with the switch locking check-ins to them (owner, the same day: "allow me
// to lock checkin's to wifi name or ip, whatever is right"; "Off the office network: refuse it", "Office staff, plus
// exceptions", check-in and check-out alike). HR and Admin (a Super Admin as an Admin) read and change them; a location
// is removed by a Super Admin, as every deletion is (owner's decision, 15 October 2026). Each change is in the audit log.
// The lock needs the key the website signs the visitor's address with (WEB_KEY, deploy/web-key.sh, on the server and in
// Vercel): without it the switch can't be turned on, and while it is missing no one is refused. The networks are the
// office's public addresses, kept with the payroll settings' row (id 1); no employee's address is ever kept. And the
// switch "Refuse check-ins and check-outs without a location" (owner, 20 October 2026: "i want a flag to restrict
// checkin and out from unknown locations", then "Company switch + exceptions"), off to start with, on the same row: HR's
// and Admin's, audited (packages/shared punch-location.ts decides each press with it).
@Injectable()
export class CheckInSetupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ---------- the key and the signed address ----------

  /** Whether the server holds the key the website signs with (WEB_KEY, at least 32 characters). */
  serverKey(): boolean {
    return webKeyUsable(process.env.WEB_KEY);
  }

  /** The address the website signed for this request, or why it can't be trusted (a plain header never is). */
  signedIp(req: Request): SignedIp {
    return verifySignedIp(req.headers, readToken(req), process.env.WEB_KEY, Date.now());
  }

  /** The lock as set, with whether the server has the key (packages/shared lockedToOfficeNetwork reads it). */
  async lockSetting(): Promise<NetworkLockSetting> {
    const s = await this.prisma.payrollSettings.findUnique({ where: { id: 1 }, select: { officeNetworks: true, officeNetworkLock: true } });
    return { lock: s?.officeNetworkLock ?? false, networks: networksOf(s?.officeNetworks), serverKey: this.serverKey() };
  }

  // ---------- the office networks ----------

  async networks(req: Request): Promise<OfficeNetworksView> {
    return this.networksView(await this.lockSetting(), this.signedIp(req));
  }

  /**
   * The whole list and the switch. Each network named and valid, none twice, 20 at most (shared officeNetworksFrom).
   * Switched on only with the key on the server, this request's address signed by the website (so the website has the
   * same key), and at least one network: never a lock that would refuse every Office check-in.
   */
  async updateNetworks(dto: UpdateOfficeNetworksDto, req: Request, user: SessionUser): Promise<OfficeNetworksView> {
    const { networks, problems } = officeNetworksFrom(dto.networks);
    if (problems.length) throw new BadRequestException(problems);
    const here = this.signedIp(req);
    if (dto.lock) {
      if (!this.serverKey()) throw new BadRequestException([LOCK_NEEDS_KEY_MESSAGE]);
      if (here.problem) throw new BadRequestException([`The lock can't be switched on yet. ${SIGNED_IP_PROBLEM_TEXT[here.problem]}`]);
      if (!networks.length) throw new BadRequestException(['Add the office network before switching the lock on: without one, every Office check-in would be refused.']);
    }
    const before = await this.lockSetting();
    await this.prisma.payrollSettings.upsert({
      where: { id: 1 },
      update: { officeNetworks: networks as unknown as object[], officeNetworkLock: dto.lock },
      create: { id: 1, officeNetworks: networks as unknown as object[], officeNetworkLock: dto.lock },
    });
    const diff = changes({ officeNetworks: before.networks, officeNetworkLock: before.lock }, { officeNetworks: networks, officeNetworkLock: dto.lock });
    if (Object.keys(diff).length) await this.audit.record({ userId: user.id, action: 'update', entityType: NETWORKS, diff });
    return this.networksView({ lock: dto.lock, networks, serverKey: this.serverKey() }, here);
  }

  private networksView(setting: NetworkLockSetting, here: SignedIp): OfficeNetworksView {
    return {
      lock: setting.lock,
      networks: [...setting.networks],
      serverKey: setting.serverKey,
      inForce: networkLockInForce(setting),
      here: here.ip ? { signed: true, ip: here.ip, network: matchOfficeNetwork(here.ip, setting.networks)?.label ?? null } : { signed: false, problem: here.problem! },
    };
  }

  // ---------- refusing presses without a location ----------

  /** The switch "Refuse check-ins and check-outs without a location" (off unless set). */
  async locationRule(): Promise<LocationRule> {
    const s = await this.prisma.payrollSettings.findUnique({ where: { id: 1 }, select: { refuseWithoutLocation: true } });
    return { refuseWithoutLocation: s?.refuseWithoutLocation ?? false };
  }

  /** { refuseWithoutLocation }: on or off, in the audit log when it changes. */
  async updateLocationRule(dto: UpdateLocationRuleDto, user: SessionUser): Promise<LocationRule> {
    const before = await this.locationRule();
    await this.prisma.payrollSettings.upsert({
      where: { id: 1 },
      update: { refuseWithoutLocation: dto.refuseWithoutLocation },
      create: { id: 1, refuseWithoutLocation: dto.refuseWithoutLocation },
    });
    const diff = changes({ ...before }, { refuseWithoutLocation: dto.refuseWithoutLocation });
    if (Object.keys(diff).length) await this.audit.record({ userId: user.id, action: 'update', entityType: LOCATION_RULE, diff });
    return { refuseWithoutLocation: dto.refuseWithoutLocation };
  }

  // ---------- the check-in locations ----------

  /** Every location, oldest first (the first, "Office", the point Payroll Setup had). */
  async locations(): Promise<CheckInLocationView[]> {
    return (await this.prisma.checkInLocation.findMany({ orderBy: [{ createdAt: 'asc' }, { name: 'asc' }] })).map(locationView);
  }

  /** The locations as checkInPlace reads them. */
  async officeLocations(): Promise<OfficeLocation[]> {
    return (await this.locations()).map((l) => ({ name: l.name, latitude: l.latitude, longitude: l.longitude, radiusMetres: l.radiusMetres }));
  }

  async createLocation(dto: CreateCheckInLocationDto, user: SessionUser): Promise<CheckInLocationView> {
    const values = { name: dto.name.trim().replace(/\s+/g, ' '), latitude: coordinate(dto.latitude), longitude: coordinate(dto.longitude), radiusMetres: dto.radiusMetres ?? OFFICE_RADIUS_DEFAULT };
    await this.assertLocation(values, null);
    if ((await this.prisma.checkInLocation.count()) >= CHECK_IN_LOCATIONS_MAX) throw new BadRequestException([`Keep at most ${CHECK_IN_LOCATIONS_MAX} check-in locations.`]);
    const row = await this.prisma.checkInLocation.create({ data: values });
    await this.audit.record({ userId: user.id, action: 'create', entityType: LOCATION, entityId: row.id, diff: values });
    return locationView(row);
  }

  async updateLocation(id: string, dto: UpdateCheckInLocationDto, user: SessionUser): Promise<CheckInLocationView> {
    const before = locationView(await this.row(id));
    const sent = {
      name: dto.name === undefined ? undefined : dto.name.trim().replace(/\s+/g, ' '),
      latitude: dto.latitude === undefined ? undefined : coordinate(dto.latitude),
      longitude: dto.longitude === undefined ? undefined : coordinate(dto.longitude),
      radiusMetres: dto.radiusMetres,
    };
    const after = {
      name: sent.name ?? before.name,
      latitude: sent.latitude ?? before.latitude,
      longitude: sent.longitude ?? before.longitude,
      radiusMetres: sent.radiusMetres ?? before.radiusMetres,
    };
    await this.assertLocation(after, id);
    const row = await this.prisma.checkInLocation.update({ where: { id }, data: sent });
    const diff = changes({ ...before }, sent);
    if (Object.keys(diff).length) await this.audit.record({ userId: user.id, action: 'update', entityType: LOCATION, entityId: id, diff });
    return locationView(row);
  }

  /** Removes a location: a Super Admin only, as every deletion. Check-ins from then on aren't read against it. */
  async removeLocation(id: string, user: SessionUser): Promise<void> {
    assertDeletes(user);
    const l = locationView(await this.row(id));
    await this.prisma.checkInLocation.delete({ where: { id } });
    await this.audit.record({ userId: user.id, action: 'delete', entityType: LOCATION, entityId: id, diff: { name: l.name, latitude: l.latitude, longitude: l.longitude, radiusMetres: l.radiusMetres } });
  }

  private async row(id: string): Promise<CheckInLocation> {
    const row = await this.prisma.checkInLocation.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Check-in location not found.');
    return row;
  }

  /** The shared checks, and no two locations of the same name (whatever its capitals). */
  private async assertLocation(l: { name: string; latitude: number; longitude: number; radiusMetres: number }, id: string | null): Promise<void> {
    const problems = checkInLocationProblems(l);
    if (problems.length) throw new BadRequestException(problems);
    const same = await this.prisma.checkInLocation.findFirst({ where: { name: { equals: l.name, mode: 'insensitive' }, ...(id && { id: { not: id } }) }, select: { id: true } });
    if (same) throw new BadRequestException([`There is a location named ${l.name} already: give this one another name.`]);
  }
}
