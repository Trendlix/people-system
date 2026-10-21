import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  CHECK_IN_LOCATIONS_MAX,
  checkInLocationProblems,
  LOCK_NEEDS_KEY_MESSAGE,
  MAIN_OFFICE_LINK_REFUSED,
  MAIN_OFFICE_REMOVE_REFUSED,
  matchOfficeNetwork,
  networkLockInForce,
  OFFICE_RADIUS_DEFAULT,
  officeNetworksFrom,
  SIGNED_IP_PROBLEM_TEXT,
  webKeyUsable,
  type CheckInPlaces,
  type LocationRule,
  type NetworkLockSetting,
  type OfficeLocation,
  type OfficeNetwork,
  type SignedIpProblem,
} from '@trendlix/shared';
import type { Request } from 'express';
import { AuditService, changes } from '../audit/audit.service.js';
import { readToken } from '../auth/auth.guard.js';
import { actsAs, assertDeletes } from '../auth/roles.js';
import type { SessionUser } from '../auth/session-user.js';
import { ConfidentialService } from '../employees/confidential.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CreateCheckInLocationDto, LinkPeopleDto, UpdateCheckInLocationDto, UpdateLocationRuleDto, UpdateOfficeNetworksDto } from './check-in-setup.dto.js';
import { verifySignedIp, type SignedIp } from './signed-ip.js';

const LOCATION = 'check_in_location';
const NETWORKS = 'office_networks';
const LOCATION_RULE = 'check_in_location_rule';

/** A person linked to a sub-location, as its card names them. */
export interface LinkedPersonView {
  id: string;
  fullNameEn: string;
  employeeCode: string;
}

/** Someone HR may link to a sub-location (GET /attendance/check-in-setup/people): a current employee they may see. */
export interface LinkablePersonView extends LinkedPersonView {
  department: string | null;
}

/** A check-in location as the API sends it: the main office (isMain) or a sub-location with its people. */
export interface CheckInLocationView {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  radiusMetres: number;
  isMain: boolean;
  /** A sub-location's linked people the caller may see (a C-level person only for the CEO and the Super Admin), by name; none on the main office. */
  people: LinkedPersonView[];
  createdAt: string;
  updatedAt: string;
}

/** GET /employees/:employeeId/check-in-places: the sub-locations a person is linked to, by name. */
export interface CheckInPlacesView {
  places: { id: string; name: string }[];
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

/** A linked person as the cards name them. */
const PERSON = { id: true, fullNameEn: true, employeeCode: true } satisfies Prisma.EmployeeSelect;

/** A location with its linked people. */
const WITH_PEOPLE = { people: { select: { employee: { select: PERSON } } } } satisfies Prisma.CheckInLocationInclude;

type LocationRow = Prisma.CheckInLocationGetPayload<{ include: typeof WITH_PEOPLE }>;

/** The main office first, then the sub-locations as they were added (then by name). */
const LIST_ORDER = [{ isMain: 'desc' }, { createdAt: 'asc' }, { name: 'asc' }] satisfies Prisma.CheckInLocationOrderByWithRelationInput[];

/** A location as the page gets it: a sub-location's people the caller may see (none hidden from them), by name; none on the main office. */
const locationView = (l: LocationRow, hidden: ReadonlySet<string>): CheckInLocationView => ({
  id: l.id,
  name: l.name,
  latitude: l.latitude.toNumber(),
  longitude: l.longitude.toNumber(),
  radiusMetres: l.radiusMetres,
  isMain: l.isMain,
  people: l.isMain
    ? []
    : l.people
        .map((p) => p.employee)
        .filter((e) => !hidden.has(e.id))
        .sort((a, b) => a.fullNameEn.localeCompare(b.fullNameEn, 'en')),
  createdAt: l.createdAt.toISOString(),
  updatedAt: l.updatedAt.toISOString(),
});

/** A location's point and radius as the shared rules read a press against them, with its name. */
const pointOf = (l: { name: string; latitude: Prisma.Decimal; longitude: Prisma.Decimal; radiusMetres: number }): OfficeLocation & { name: string } => ({
  name: l.name,
  latitude: l.latitude.toNumber(),
  longitude: l.longitude.toNumber(),
  radiusMetres: l.radiusMetres,
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
// The main office and its sub-locations (owner, 20 October 2026: "main office location is the hero and other locations
// are like sub locations. shown with their name and linked users"; packages/shared sub-locations.ts): one location is the
// main, the first added; "Make main" swaps it; the main is removed (a Super Admin) only once it is the last. HR and Admin
// link people to a sub-location and unlink them, each link in the audit log on the person's History too; a C-level
// person (confidential.ts) is neither shown to, nor linked or unlinked by, those who may not see them (404). The changes
// of which is the main are made one at a time (a transaction-held lock), so there is never a second main.
@Injectable()
export class CheckInSetupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly confidential: ConfidentialService,
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

  /** Every location: the main office first, then the sub-locations as they were added, each with the people the caller may see. */
  async locations(user: SessionUser): Promise<CheckInLocationView[]> {
    const [rows, confidential] = await Promise.all([this.prisma.checkInLocation.findMany({ orderBy: LIST_ORDER, include: WITH_PEOPLE }), this.confidential.view(user)]);
    return rows.map((l) => locationView(l, confidential.hidden));
  }

  /** Every location's point, main or not: an old office press's map falls back to the one it was matched to by name (punch-views.ts). */
  async officeLocations(): Promise<OfficeLocation[]> {
    return (await this.prisma.checkInLocation.findMany({ orderBy: LIST_ORDER, select: { name: true, latitude: true, longitude: true, radiusMetres: true } })).map(pointOf);
  }

  /**
   * The places a person's press is read against (packages/shared checkInPlaceAt): the main office, and each sub-location
   * with whether they are linked to it (none without a profile). Links to the main office don't count while it is the main.
   */
  async checkInPlaces(employeeId: string | null): Promise<CheckInPlaces> {
    const [rows, links] = await Promise.all([
      this.prisma.checkInLocation.findMany({ orderBy: LIST_ORDER, select: { id: true, name: true, latitude: true, longitude: true, radiusMetres: true, isMain: true } }),
      employeeId ? this.prisma.checkInLocationPerson.findMany({ where: { employeeId }, select: { locationId: true } }) : [],
    ]);
    const linked = new Set(links.map((l) => l.locationId));
    const main = rows.find((r) => r.isMain);
    return { main: main ? pointOf(main) : null, subLocations: rows.filter((r) => !r.isMain).map((r) => ({ ...pointOf(r), linked: linked.has(r.id) })) };
  }

  /** One location as the caller gets it. */
  private async one(id: string, user: SessionUser): Promise<CheckInLocationView> {
    const [row, confidential] = await Promise.all([this.prisma.checkInLocation.findUnique({ where: { id }, include: WITH_PEOPLE }), this.confidential.view(user)]);
    if (!row) throw new NotFoundException('Check-in location not found.');
    return locationView(row, confidential.hidden);
  }

  /** The first location added is the main office (owner, 20 October 2026: "main office location is the hero"); every later one a sub-location. */
  async createLocation(dto: CreateCheckInLocationDto, user: SessionUser): Promise<CheckInLocationView> {
    const values = { name: dto.name.trim().replace(/\s+/g, ' '), latitude: coordinate(dto.latitude), longitude: coordinate(dto.longitude), radiusMetres: dto.radiusMetres ?? OFFICE_RADIUS_DEFAULT };
    await this.assertLocation(values, null);
    const row = await this.prisma.$transaction(async (tx) => {
      await lockLocations(tx);
      if ((await tx.checkInLocation.count()) >= CHECK_IN_LOCATIONS_MAX) throw new BadRequestException([`Keep at most ${CHECK_IN_LOCATIONS_MAX} check-in locations.`]);
      const isMain = (await tx.checkInLocation.count({ where: { isMain: true } })) === 0;
      return tx.checkInLocation.create({ data: { ...values, isMain }, include: WITH_PEOPLE });
    });
    await this.audit.record({ userId: user.id, action: 'create', entityType: LOCATION, entityId: row.id, diff: { ...values, isMain: row.isMain } });
    return locationView(row, new Set());
  }

  async updateLocation(id: string, dto: UpdateCheckInLocationDto, user: SessionUser): Promise<CheckInLocationView> {
    const was = await this.row(id);
    const before = { name: was.name, latitude: was.latitude.toNumber(), longitude: was.longitude.toNumber(), radiusMetres: was.radiusMetres };
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
    await this.prisma.checkInLocation.update({ where: { id }, data: sent });
    const diff = changes({ ...before }, sent);
    if (Object.keys(diff).length) await this.audit.record({ userId: user.id, action: 'update', entityType: LOCATION, entityId: id, diff });
    return this.one(id, user);
  }

  /**
   * "Make main" (owner, 20 October 2026: "main office location is the hero"): this location becomes the main office and
   * the main until now a sub-location, in one transaction (never two mains: a partial unique index besides). Its links
   * stay, not counting while it is the main. Already the main: nothing changes.
   */
  async makeMain(id: string, user: SessionUser): Promise<CheckInLocationView[]> {
    const swapped = await this.prisma.$transaction(async (tx) => {
      await lockLocations(tx);
      const target = await tx.checkInLocation.findUnique({ where: { id }, select: { id: true, name: true, isMain: true } });
      if (!target) throw new NotFoundException('Check-in location not found.');
      if (target.isMain) return null;
      const was = await tx.checkInLocation.findFirst({ where: { isMain: true }, select: { id: true, name: true } });
      await tx.checkInLocation.updateMany({ where: { isMain: true }, data: { isMain: false } });
      await tx.checkInLocation.update({ where: { id }, data: { isMain: true } });
      return { from: was, to: target };
    });
    if (swapped) {
      await this.audit.record({
        userId: user.id,
        action: 'make_main',
        entityType: LOCATION,
        entityId: id,
        diff: { mainOffice: { from: swapped.from?.name ?? null, to: swapped.to.name }, ...(swapped.from && { formerMainId: swapped.from.id }) },
      });
    }
    return this.locations(user);
  }

  /**
   * Removes a location: a Super Admin only, as every deletion; its links go with it. The main office only once it is the
   * last location (another is made the main first). Check-ins from then on aren't read against it.
   */
  async removeLocation(id: string, user: SessionUser): Promise<void> {
    assertDeletes(user);
    const removed = await this.prisma.$transaction(async (tx) => {
      await lockLocations(tx);
      const l = await tx.checkInLocation.findUnique({ where: { id }, include: { _count: { select: { people: true } } } });
      if (!l) throw new NotFoundException('Check-in location not found.');
      if (l.isMain && (await tx.checkInLocation.count({ where: { id: { not: id } } })) > 0) throw new BadRequestException([MAIN_OFFICE_REMOVE_REFUSED]);
      await tx.checkInLocation.delete({ where: { id } });
      return l;
    });
    await this.audit.record({
      userId: user.id,
      action: 'delete',
      entityType: LOCATION,
      entityId: id,
      diff: {
        name: removed.name,
        latitude: removed.latitude.toNumber(),
        longitude: removed.longitude.toNumber(),
        radiusMetres: removed.radiusMetres,
        isMain: removed.isMain,
        linkedPeople: removed._count.people,
      },
    });
  }

  // ---------- the people linked to a sub-location ----------

  /**
   * Who HR may link (owner, 20 October 2026: "shown with their name and linked users"): everyone with a current
   * employment who checks in (not a freelancer: packages/shared checkInRefusal) and the caller may see (a C-level person
   * only for the CEO and the Super Admin), by name.
   */
  async linkable(user: SessionUser): Promise<LinkablePersonView[]> {
    const rows = await this.prisma.employee.findMany({
      where: { AND: [await this.confidential.employeeWhere(user), { employments: { some: { endDate: null, employmentType: { not: 'freelance' } } } }] },
      orderBy: { fullNameEn: 'asc' },
      select: { ...PERSON, employments: { where: { endDate: null }, orderBy: { joinDate: 'desc' }, take: 1, select: { department: { select: { nameEn: true } } } } },
    });
    return rows.map((e) => ({ id: e.id, fullNameEn: e.fullNameEn, employeeCode: e.employeeCode, department: e.employments[0]?.department?.nameEn ?? null }));
  }

  /**
   * { employeeIds }: these people linked to a sub-location, those already linked left as they are; each new link in the
   * audit log (on the person's History too). Never the main office (it is everyone's); a person the caller may not see
   * (a C-level person for HR and Admin), or no one by that id: 404.
   */
  async linkPeople(id: string, dto: LinkPeopleDto, user: SessionUser): Promise<CheckInLocationView> {
    const l = await this.row(id);
    if (l.isMain) throw new BadRequestException([MAIN_OFFICE_LINK_REFUSED]);
    const ids = [...new Set(dto.employeeIds)];
    const [found, hidden, already] = await Promise.all([
      this.prisma.employee.findMany({ where: { id: { in: ids } }, select: PERSON }),
      this.confidential.hiddenFrom(user),
      this.prisma.checkInLocationPerson.findMany({ where: { locationId: id, employeeId: { in: ids } }, select: { employeeId: true } }),
    ]);
    if (found.length !== ids.length || ids.some((e) => hidden.includes(e))) throw new NotFoundException('Employee not found.');
    const linked = new Set(already.map((a) => a.employeeId));
    const fresh = found.filter((e) => !linked.has(e.id));
    if (fresh.length) {
      await this.prisma.checkInLocationPerson.createMany({ data: fresh.map((e) => ({ locationId: id, employeeId: e.id })), skipDuplicates: true });
      for (const e of fresh) {
        await this.audit.record({ userId: user.id, action: 'link_person', entityType: LOCATION, entityId: id, diff: { location: l.name, employeeId: e.id, employee: e.fullNameEn } });
      }
    }
    return this.one(id, user);
  }

  /** A person unlinked from a location, in the audit log; a person the caller may not see, or one not linked to it: 404. */
  async unlinkPerson(id: string, employeeId: string, user: SessionUser): Promise<CheckInLocationView> {
    const l = await this.row(id);
    await this.confidential.assertVisible(user, employeeId);
    const link = await this.prisma.checkInLocationPerson.findUnique({ where: { locationId_employeeId: { locationId: id, employeeId } }, select: { employee: { select: PERSON } } });
    if (!link) throw new NotFoundException('That person isn’t linked to this location.');
    await this.prisma.checkInLocationPerson.delete({ where: { locationId_employeeId: { locationId: id, employeeId } } });
    await this.audit.record({ userId: user.id, action: 'unlink_person', entityType: LOCATION, entityId: id, diff: { location: l.name, employeeId, employee: link.employee.fullNameEn } });
    return this.one(id, user);
  }

  /**
   * The sub-locations a person is linked to (their profile: "Check-in places: Studio, Client X"): for HR, Admin and the
   * CEO, and the person themself; a C-level person's only for those who see them (the route's guard: 404). Anyone else 403.
   */
  async placesOf(employeeId: string, user: SessionUser): Promise<CheckInPlacesView> {
    if (!actsAs(user.roles, ['hr', 'admin', 'ceo']) && (await this.confidential.selfId(user)) !== employeeId) {
      throw new ForbiddenException('Only HR, Admin, the CEO and the person themself see their check-in places.');
    }
    if (!(await this.prisma.employee.count({ where: { id: employeeId } }))) throw new NotFoundException('Employee not found.');
    const rows = await this.prisma.checkInLocationPerson.findMany({
      where: { employeeId, location: { isMain: false } },
      orderBy: { location: { name: 'asc' } },
      select: { location: { select: { id: true, name: true } } },
    });
    return { places: rows.map((r) => r.location) };
  }

  private async row(id: string) {
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

/** Changes of which location is the main (adding, Make main, removing) one at a time, until the transaction ends. */
async function lockLocations(tx: Prisma.TransactionClient): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('people-system:check-in-locations-main'))`;
}
