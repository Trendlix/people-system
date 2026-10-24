import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  decidesHomeStage,
  defaultValidity,
  HOME_RADIUS_DEFAULT,
  HOME_STATUS_LABELS,
  homeDecisionStepKind,
  homeLabelOf,
  homeOpenAlready,
  homeRadiusProblems,
  homeRequestProblems,
  homeStage,
  homeStatusAfterApproval,
  isOpenHome,
  OPEN_HOME_STATUSES,
  overlapsOf,
  removesHome,
  seesHome,
  seesHomeLocations,
  setsLocationValidity,
  signedContractEnd,
  validityProblems,
  waitsForHome,
  withdrawsHome,
  type HomeStatus,
  type HomeType,
  type LocationContract,
  type LocationValidity,
  type OverlapCandidate,
  type OwnPlaces,
} from '@trendlix/shared';
import { AuditService } from '../audit/audit.service.js';
import type { SessionUser } from '../auth/session-user.js';
import { fromDateOnly, toDateOnly, todayInCairo } from '../common/date-only.js';
import { ConfidentialService } from '../employees/confidential.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { NoticesService } from '../notifications/notices.service.js';
import { userNames } from '../payroll/adjustments/people.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { HOME_ENTITY, HOME_INCLUDE, homeParties, homeView, standingOf, type HomeCaller, type HomeLocationView, type HomeRow, type OverlapView } from './home-location-views.js';
import type { CreateHomeLocationDto, DecideHomeLocationDto, ListHomeLocationsDto, RemoveHomeLocationDto, SetLocationValidityDto } from './home-locations.dto.js';

type Db = PrismaService | Prisma.TransactionClient;

const NOT_FOUND = 'Home location not found.';
const NOT_YOURS = 'Only HR, the CEO and the Super Admin see home locations.';
const CLIENT_ENDED_ON_SETUP = 'A client location is the company’s once approved: HR changes or ends it on Check-in Setup.';

/** A coordinate kept to 6 decimals (about 10 cm), as the column keeps it. */
const coordinate = (n: number) => Math.round(n * 1e6) / 1e6 + 0;

/** A status as a message says it: "with HR", "with the CEO", "approved". */
const statusWords = (status: string) => {
  const label = HOME_STATUS_LABELS[status as HomeStatus] ?? status;
  return label.startsWith('With ') ? `with ${label.slice(5)}` : label.toLowerCase();
};

/** What a request no longer keeps once it is decided against, withdrawn, replaced or removed: the point and the label. */
const FORGET = { latitude: null, longitude: null, label: null } as const;

const ymd = (d: Date | null | undefined): string | null => (d ? fromDateOnly(d) : null);

// Home locations (owner, 20 October 2026: "allow other users to request to add their home locations when working from
// home"; then "Label Home, flag elsewhere", HR "then approved by the HR and CEO", everyone may ask; packages/shared
// home-locations.ts). Anyone with an employee profile asks from My Requests (the site or the phone pages): the home's
// point, put on a map or read from their device, and a label if they want; one being decided at a time (409), in a
// transaction holding the employee's row. HR approves (with the radius, 100 m to start with, changed if HR wants) or
// rejects with a comment, then the CEO approves or rejects with a comment; a C-level person's both by the CEO (or HR with
// Super Admin at HR's step), a CEO's own CEO step by a Super Admin, nobody their own. Approved by the CEO, it is their
// home (a check-in within it is Home: CheckInService), the one approved before it replaced, in the same transaction. The
// employee withdraws theirs while it is being decided, and removes their approved home at any time; HR, the CEO and the
// Super Admin remove one too. A home is personal data (the employee's request their consent): seen only by the
// employee, HR (not a C-level person's), the CEO and the Super Admin; managers and Finance are refused. Its point and
// label are kept only while it is being decided or in force, and deleted (not hidden) once it isn't: rejected,
// withdrawn, replaced or removed. Each step is logged on it and in the audit log, never with the point or the label.
// Notifications (apps/mobile/README.md, Phase 4): once a request is sent or a step decided, the one in charge of the
// next step is told, and the employee once HR or the CEO decides (NoticesService.homeLocation: names and dates only).
// Requested check-in locations (owner, 24 October 2026: "allow the employee to request adding this location to his
// profile, taking the approval cycle for sure, with a reason behind requesting to add this location (Home Location -
// Remote Site - Client Location) with a comment reason"; "HR → CEO for all three"; "allow the HR to add an end date or lik
// it to the contract date. if renewed renew the due date of the checkin location"; "location to be allowed only to the
// requested employee not all of them if home or remote, all employees if a customer location"): the same request with a
// type, a name, the radius asked (25 to 500 m), the reason (required) and the end date wished; one of each type being
// decided at a time. HR sets its validity when approving (until a date, until the contract ends, or for a client
// location no end) and changes a home's or a remote site's later; the CEO's approval puts a home or a remote site in
// force for the person, and makes a client location a company check-in location for everyone (Check-in Setup, where HR
// changes or ends it). An approved place counts while its validity lasts (the contract's end read each time, so a renewal
// moves it). HR and the CEO see the check-in places a request overlaps, as a warning.
@Injectable()
export class HomeLocationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly confidential: ConfidentialService,
    private readonly notices: NoticesService,
  ) {}

  // ---------- the employee's own ----------

  /** The caller's own requests, newest first; none without an employee profile. */
  async mine(user: SessionUser): Promise<HomeLocationView[]> {
    const caller = await this.caller(user);
    if (!caller.employeeId) return [];
    const rows = await this.prisma.homeLocationRequest.findMany({ where: { employeeId: caller.employeeId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], include: HOME_INCLUDE });
    return this.views(rows, caller);
  }

  /**
   * The employee asks for a place: with HR first. One being decided at a time of each type. Sent without a type (a page
   * from before 24 October 2026), it is a home asked as before: no reason needed, 100 m.
   */
  async create(dto: CreateHomeLocationDto, user: SessionUser): Promise<HomeLocationView> {
    const caller = await this.caller(user);
    const employeeId = caller.employeeId;
    if (!employeeId) throw new ForbiddenException('Only an employee can ask for a check-in location: your sign-in has no employee profile.');
    const typed = dto.type !== undefined;
    const type: HomeType = dto.type ?? 'home';
    const today = todayInCairo();
    const wishedEndDate = type !== 'home' && dto.wishedEndDate ? dto.wishedEndDate : null;
    const problems = homeRequestProblems({
      latitude: dto.latitude,
      longitude: dto.longitude,
      label: dto.label,
      ...(typed && { type, reason: dto.reason ?? null, radiusMetres: dto.radiusMetres ?? null, wishedEndDate: dto.wishedEndDate || null, today }),
    });
    if (problems.length) throw new BadRequestException(problems);
    const label = homeLabelOf(dto.label);
    const reason = typed ? homeLabelOf(dto.reason) : null;
    const radiusMetres = typed && typeof dto.radiusMetres === 'number' ? dto.radiusMetres : HOME_RADIUS_DEFAULT;
    const accuracyMetres = typeof dto.accuracy === 'number' ? Math.round(dto.accuracy) : null;
    const id = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM employees WHERE id = ${employeeId}::uuid FOR UPDATE`;
      const open = await tx.homeLocationRequest.count({ where: { employeeId, type, status: { in: [...OPEN_HOME_STATUSES] } } });
      if (open) throw new ConflictException(homeOpenAlready(type));
      const made = await tx.homeLocationRequest.create({
        data: {
          employeeId,
          type,
          latitude: coordinate(dto.latitude!),
          longitude: coordinate(dto.longitude!),
          radiusMetres,
          label,
          reason,
          wishedEndDate: wishedEndDate ? toDateOnly(wishedEndDate) : null,
          accuracyMetres,
          status: 'with_hr',
          createdById: user.id,
        },
        select: { id: true },
      });
      await this.step(tx, made.id, user.id, { kind: 'submitted', radiusMetres });
      return made.id;
    });
    // never the point, the label nor the reason: what was asked and where it stands
    await this.audit.record({
      userId: user.id,
      action: 'create',
      entityType: HOME_ENTITY,
      entityId: id,
      diff: { employeeId, type, radiusMetres, status: 'with_hr', ...(wishedEndDate && { wishedEndDate }) },
    });
    // HR's step waits (a C-level person's, the CEO's)
    await this.notices.homeLocation(id, 'sent');
    return this.one(id, user);
  }

  /** The employee withdraws their own request while it is being decided: its point and label are deleted. */
  async withdraw(id: string, user: SessionUser): Promise<HomeLocationView> {
    const caller = await this.caller(user);
    const before = await this.visible(id, caller);
    if (!withdrawsHome({ ...homeParties(before, caller), status: before.status })) {
      if (homeParties(before, caller).own) throw new ConflictException(`This request is ${statusWords(before.status)}, so it can't be withdrawn.`);
      throw new ForbiddenException('Only the employee who asked for it withdraws a home location request.');
    }
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.homeLocationRequest.updateMany({ where: { id, status: before.status }, data: { status: 'withdrawn', endedAt: new Date(), ...FORGET } });
      if (!count) throw new ConflictException("This request was decided meanwhile, so it can't be withdrawn. Reload the page to see where it is.");
      await this.step(tx, id, user.id, { kind: 'withdrawn' });
    });
    await this.audit.record({ userId: user.id, action: 'withdraw', entityType: HOME_ENTITY, entityId: id, diff: { employeeId: before.employeeId, status: { from: before.status, to: 'withdrawn' } } });
    return this.one(id, user);
  }

  /**
   * An approved home removed: by its employee at any time, or by HR, the CEO or the Super Admin who see it, with a comment
   * if they give one. Its point and label are deleted, not hidden; the audit log records the removal without them. A
   * remote site the same; a client location, once approved, is the company's: ended on Check-in Setup instead.
   */
  async remove(id: string, dto: RemoveHomeLocationDto, user: SessionUser): Promise<HomeLocationView> {
    const caller = await this.caller(user);
    const before = await this.visible(id, caller);
    const parties = homeParties(before, caller);
    if (!removesHome(user, { ...parties, status: before.status, type: before.type })) {
      if (before.type === 'client' && before.status === 'approved') throw new ConflictException(CLIENT_ENDED_ON_SETUP);
      throw new ConflictException(`This request is ${statusWords(before.status)}: only an approved home location is removed.`);
    }
    const comment = parties.own ? null : (dto.comment ?? null);
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.homeLocationRequest.updateMany({ where: { id, status: 'approved' }, data: { status: 'removed', endedAt: new Date(), ...FORGET } });
      if (!count) throw new ConflictException('This home location was replaced or removed meanwhile. Reload the page to see where it is.');
      await this.step(tx, id, user.id, { kind: 'removed', comment });
    });
    await this.audit.record({
      userId: user.id,
      action: 'remove',
      entityType: HOME_ENTITY,
      entityId: id,
      diff: { employeeId: before.employeeId, type: before.type, by: parties.own ? 'employee' : 'staff', status: { from: 'approved', to: 'removed' }, ...(comment && { comment }) },
    });
    return this.one(id, user);
  }

  // ---------- HR, the CEO and the Super Admin ----------

  /**
   * The requests the caller sees (HR not a C-level person's), newest first: by status (`waiting`: theirs to decide;
   * `open`: being decided), by employee and by type. Anyone else is refused (403).
   */
  async list(query: ListHomeLocationsDto, user: SessionUser): Promise<HomeLocationView[]> {
    if (!seesHomeLocations(user)) throw new ForbiddenException(NOT_YOURS);
    const caller = await this.caller(user);
    const status = query.status === 'waiting' || query.status === 'open' ? { in: [...OPEN_HOME_STATUSES] } : query.status;
    const rows = await this.prisma.homeLocationRequest.findMany({
      where: { ...(status && { status }), ...(query.employeeId && { employeeId: query.employeeId }), ...(query.type && { type: query.type }) },
      orderBy: query.status === 'approved' ? [{ approvedAt: 'desc' }, { id: 'desc' }] : [{ createdAt: 'desc' }, { id: 'desc' }],
      include: HOME_INCLUDE,
    });
    const seen = rows.filter((r) => seesHome(user, homeParties(r, caller)));
    const shown = query.status === 'waiting' ? seen.filter((r) => waitsForHome(user, { ...homeParties(r, caller), status: r.status })) : seen;
    return this.views(shown, caller);
  }

  /** { waiting }: how many wait for the caller's decision (the sidebar's and the phone's To Approve counts). */
  async counts(user: SessionUser): Promise<{ waiting: number }> {
    if (!seesHomeLocations(user)) throw new ForbiddenException(NOT_YOURS);
    const caller = await this.caller(user);
    const open = await this.prisma.homeLocationRequest.findMany({ where: { status: { in: [...OPEN_HOME_STATUSES] } }, select: { employeeId: true, status: true, createdBy: HOME_INCLUDE.createdBy } });
    return { waiting: open.filter((r) => waitsForHome(user, { ...homeParties(r, caller), status: r.status })).length };
  }

  /** One request: for its employee, HR (not a C-level person's), the CEO and the Super Admin; anyone else gets 404. */
  async one(id: string, user: SessionUser): Promise<HomeLocationView> {
    const caller = await this.caller(user);
    return (await this.views([await this.visible(id, caller)], caller))[0];
  }

  /**
   * The decision of the stage the request is at: HR's (approve, with the radius as asked or another and its validity, or
   * reject with a comment), then the CEO's (approve or reject with a comment). A C-level person's HR step is the CEO's (or
   * HR with Super Admin); a CEO's own CEO step a Super Admin's; nobody decides their own. The CEO's approval puts a home or
   * a remote site in force (a home replacing the one approved before it) or makes a client location a company check-in
   * location, in a transaction holding the employee's row. Rejected, the point is deleted.
   */
  async decide(id: string, dto: DecideHomeLocationDto, user: SessionUser): Promise<HomeLocationView> {
    const caller = await this.caller(user);
    const before = await this.visible(id, caller);
    const parties = homeParties(before, caller);
    const stage = homeStage(before.status);
    if (!stage) throw new ConflictException(`This request is ${statusWords(before.status)}, so there is nothing left to decide. Reload the page to see it.`);
    if (parties.own) throw new ForbiddenException('Someone else has to decide your own home location.');
    if (!decidesHomeStage(user, stage, parties)) {
      const other = stage === 'hr' ? 'ceo' : 'hr';
      if (decidesHomeStage(user, other, parties)) {
        throw new ConflictException(`This request is ${statusWords(before.status)} now, so it isn't waiting for your decision. Reload the page to see where it is.`);
      }
      throw new ForbiddenException(
        parties.confidential ? "A C-level person's home location is decided by the CEO, at both steps." : 'HR decides a home location first, then the CEO.',
      );
    }
    const comment = dto.comment ?? null;
    if (dto.decision === 'reject' && !comment) throw new BadRequestException('Write a comment: why the home location is rejected.');
    const radiusSent = typeof dto.radiusMetres === 'number';
    if (radiusSent && stage !== 'hr') throw new BadRequestException('The radius is set at HR’s step: the CEO approves or rejects it as HR sent it.');
    if (radiusSent && dto.decision === 'reject') throw new BadRequestException('Set the radius only when approving.');
    const radius = radiusSent ? dto.radiusMetres! : before.radiusMetres;
    const radiusProblems = homeRadiusProblems(radius);
    if (radiusProblems.length) throw new BadRequestException(radiusProblems);
    // how long it lasts (24 October 2026), set at HR's step when approving: as sent, else the type's default
    const type = before.type as HomeType;
    const today = todayInCairo();
    const validitySent = (dto.validity !== undefined && dto.validity !== null) || !!dto.validUntil;
    if (validitySent && (stage !== 'hr' || dto.decision === 'reject')) throw new BadRequestException('How long it lasts is set at HR’s step, when approving.');
    let validity = (before.validity as LocationValidity | null) ?? null;
    let validUntil = ymd(before.validUntil);
    if (stage === 'hr' && dto.decision === 'approve') {
      const wished = ymd(before.wishedEndDate);
      validity = dto.validity ?? defaultValidity(type, wished);
      validUntil = validity === 'until_date' ? dto.validUntil || (dto.validity ? null : wished) : null;
      const problems = validityProblems(type, validity, validUntil, today);
      if (problems.length) throw new BadRequestException(problems);
    }
    const to: HomeStatus = dto.decision === 'reject' ? 'rejected' : homeStatusAfterApproval(stage);
    // approved at HR's step before validity was kept (a request in flight on 24 October 2026): no end, as approved then
    if (to === 'approved' && !validity) validity = 'no_end';
    const now = new Date();

    const { replaced, made } = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM employees WHERE id = ${before.employeeId}::uuid FOR UPDATE`;
      // a newly approved home replaces the one approved before it (owner's brief: one approved home a person); a remote
      // site is one of several
      const old =
        to === 'approved' && type === 'home'
          ? await tx.homeLocationRequest.findFirst({ where: { employeeId: before.employeeId, type: 'home', status: 'approved', id: { not: id } }, select: { id: true } })
          : null;
      if (old) {
        await tx.homeLocationRequest.update({ where: { id: old.id }, data: { status: 'replaced', endedAt: now, ...FORGET } });
        await this.step(tx, old.id, user.id, { kind: 'replaced' });
      }
      // a client location approved (owner, 24 October 2026: "all employees if a customer location"): the company's, on
      // Check-in Setup, for everyone, named as asked (another number after it when the name is taken)
      const place =
        to === 'approved' && type === 'client' && before.latitude && before.longitude
          ? await tx.checkInLocation.create({
              data: {
                name: await freeName(tx, before.label ?? 'Client location'),
                latitude: before.latitude,
                longitude: before.longitude,
                radiusMetres: radius,
                isMain: false,
                kind: 'client',
                validUntil: validity === 'until_date' && validUntil ? toDateOnly(validUntil) : null,
              },
              select: { id: true, name: true, radiusMetres: true, validUntil: true },
            })
          : null;
      const { count } = await tx.homeLocationRequest.updateMany({
        where: { id, status: before.status },
        data:
          to === 'rejected'
            ? { status: to, rejectedStage: stage, rejectReason: comment, endedAt: now, ...FORGET }
            : {
                status: to,
                radiusMetres: radius,
                validity,
                validUntil: validity === 'until_date' && validUntil ? toDateOnly(validUntil) : null,
                ...(to === 'approved' && { approvedAt: now }),
                ...(place && { locationId: place.id }),
              },
      });
      if (!count) throw new ConflictException('This request was decided or withdrawn meanwhile. Reload the page to see where it is.');
      await this.step(tx, id, user.id, {
        kind: homeDecisionStepKind(stage),
        decision: dto.decision,
        comment,
        radiusMetres: stage === 'hr' && dto.decision === 'approve' ? radius : null,
      });
      return { replaced: old?.id ?? null, made: place };
    });
    const validityChanged = stage === 'hr' && dto.decision === 'approve';
    await this.audit.record({
      userId: user.id,
      action: dto.decision === 'reject' ? 'reject' : 'approve',
      entityType: HOME_ENTITY,
      entityId: id,
      // "home location approved", never the point
      diff: {
        employeeId: before.employeeId,
        type,
        stage,
        decision: dto.decision,
        status: { from: before.status, to },
        ...(radius !== before.radiusMetres && { radiusMetres: { from: before.radiusMetres, to: radius } }),
        ...(validityChanged && { validity, validUntil }),
        ...(comment && { comment }),
        ...(replaced && { replaced }),
        ...(made && { locationId: made.id }),
      },
    });
    if (replaced) {
      await this.audit.record({ userId: user.id, action: 'replace', entityType: HOME_ENTITY, entityId: replaced, diff: { employeeId: before.employeeId, status: { from: 'approved', to: 'replaced' }, by: id } });
    }
    if (made) {
      // the company's place, as Check-in Setup's own additions are audited (its point is the company's, not a person's)
      await this.audit.record({
        userId: user.id,
        action: 'create',
        entityType: 'check_in_location',
        entityId: made.id,
        diff: { name: made.name, kind: 'client', radiusMetres: made.radiusMetres, validUntil: ymd(made.validUntil), requestId: id },
      });
    }
    // the CEO's step waits, or the employee hears how it was decided
    await this.notices.homeLocation(id, 'decided', user.id);
    return this.one(id, user);
  }

  /**
   * An approved home's or remote site's validity changed (owner, 24 October 2026: "allow the HR to add an end date or lik
   * it to the contract date"): by HR (a C-level person's by the CEO, or HR with Super Admin), never the employee; until a
   * date (today or later) or until the contract ends. A step on it and in the audit log; the notice of its end may go
   * again for the new date.
   */
  async setValidity(id: string, dto: SetLocationValidityDto, user: SessionUser): Promise<HomeLocationView> {
    const caller = await this.caller(user);
    const before = await this.visible(id, caller);
    const parties = homeParties(before, caller);
    const type = before.type as HomeType;
    if (!setsLocationValidity(user, { ...parties, status: before.status, type })) {
      if (before.status !== 'approved') throw new ConflictException(`This request is ${statusWords(before.status)}: how long it lasts is set when HR approves it.`);
      if (type === 'client') throw new ConflictException(CLIENT_ENDED_ON_SETUP);
      throw new ForbiddenException(parties.confidential ? "A C-level person's place is changed by the CEO." : 'HR changes how long an approved place lasts.');
    }
    const validUntil = dto.validity === 'until_date' ? (dto.validUntil ?? null) : null;
    const problems = validityProblems(type, dto.validity, validUntil, todayInCairo());
    if (problems.length) throw new BadRequestException(problems);
    const comment = dto.comment ?? null;
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.homeLocationRequest.updateMany({
        where: { id, status: 'approved' },
        data: { validity: dto.validity, validUntil: validUntil ? toDateOnly(validUntil) : null, endingNoticeOn: null },
      });
      if (!count) throw new ConflictException('This place was replaced or removed meanwhile. Reload the page to see where it is.');
      await this.step(tx, id, user.id, { kind: 'validity_changed', comment });
    });
    await this.audit.record({
      userId: user.id,
      action: 'update',
      entityType: HOME_ENTITY,
      entityId: id,
      diff: {
        employeeId: before.employeeId,
        type,
        validity: { from: before.validity, to: dto.validity },
        validUntil: { from: ymd(before.validUntil), to: validUntil },
        ...(comment && { comment }),
      },
    });
    return this.one(id, user);
  }

  // ---------- for checking in ----------

  /**
   * A person's own approved places in force on `today` (24 October 2026: "only to the requested employee ... if home or
   * remote"): their home, and their remote sites, each with its point and radius (a site with its name). Never sent on.
   */
  async ownPlaces(employeeId: string, today: string, db: Db = this.prisma): Promise<OwnPlaces> {
    const rows = await db.homeLocationRequest.findMany({
      where: { employeeId, status: 'approved', type: { in: ['home', 'remote_site'] } },
      orderBy: [{ approvedAt: 'desc' }, { id: 'desc' }],
      select: { type: true, status: true, label: true, latitude: true, longitude: true, radiusMetres: true, validity: true, validUntil: true },
    });
    if (!rows.length) return { home: null, sites: [] };
    const contract = (await this.contracts([employeeId], db)).get(employeeId) ?? null;
    const live = rows.filter((r) => r.latitude && r.longitude && standingOf({ ...r, location: null, locationId: null }, { today, contract }).inForce);
    const point = (r: (typeof rows)[number]) => ({ latitude: r.latitude!.toNumber(), longitude: r.longitude!.toNumber(), radiusMetres: r.radiusMetres });
    const home = live.find((r) => r.type === 'home');
    return { home: home ? point(home) : null, sites: live.filter((r) => r.type === 'remote_site').map((r) => ({ ...point(r), name: r.label ?? 'Remote site' })) };
  }

  /**
   * The contract each person's "until the contract ends" reads (24 October 2026): whether they have a current employment,
   * and the latest end of its signed versions (none: open-ended, or none signed yet).
   */
  async contracts(employeeIds: readonly string[], db: Db = this.prisma): Promise<Map<string, LocationContract>> {
    const ids = [...new Set(employeeIds)];
    const out = new Map<string, LocationContract>(ids.map((id) => [id, { employed: false, end: null }]));
    if (!ids.length) return out;
    const jobs = await db.employment.findMany({
      where: { employeeId: { in: ids }, endDate: null },
      orderBy: { joinDate: 'desc' },
      select: { employeeId: true, contracts: { select: { status: true, endDate: true } } },
    });
    const seen = new Set<string>();
    for (const j of jobs) {
      if (seen.has(j.employeeId)) continue;
      seen.add(j.employeeId);
      out.set(j.employeeId, { employed: true, end: signedContractEnd(j.contracts.map((c) => ({ status: c.status, endDate: ymd(c.endDate) }))) });
    }
    return out;
  }

  // ---------- helpers ----------

  /** The caller, with their own employee profile and every C-level person. */
  private async caller(user: SessionUser): Promise<HomeCaller> {
    const [employeeId, confidential] = await Promise.all([this.confidential.selfId(user), this.confidential.ids()]);
    return { user, employeeId, confidential };
  }

  /** A request the caller may see (their own; HR not a C-level person's; the CEO; the Super Admin); otherwise it isn't there. */
  private async visible(id: string, caller: HomeCaller): Promise<HomeRow> {
    const row = await this.prisma.homeLocationRequest.findUnique({ where: { id }, include: HOME_INCLUDE });
    if (!row || !seesHome(caller.user, homeParties(row, caller))) throw new NotFoundException(NOT_FOUND);
    return row;
  }

  /** Logs a step on a request, in the transaction the step is taken in. */
  private async step(db: Db, requestId: string, actorId: string | null, step: { kind: string; decision?: string; comment?: string | null; radiusMetres?: number | null }) {
    await db.homeLocationStep.create({
      data: { requestId, actorId, kind: step.kind, decision: step.decision ?? null, comment: step.comment ?? null, radiusMetres: step.radiusMetres ?? null },
    });
  }

  /**
   * The requests as the caller sees them, with who took each step, where each stands today (its validity read against the
   * person's contract), and, for HR, the CEO and the Super Admin, the check-in places each one being decided or in force
   * overlaps (owner, 24 October 2026: a warning, never a block).
   */
  private async views(rows: readonly HomeRow[], caller: HomeCaller): Promise<HomeLocationView[]> {
    if (!rows.length) return [];
    const today = todayInCairo();
    const [names, contracts, overlaps] = await Promise.all([
      userNames(this.prisma, rows.flatMap((r) => r.steps.map((s) => s.actor))),
      this.contracts(rows.map((r) => r.employeeId)),
      seesHomeLocations(caller.user) ? this.overlaps(rows, today) : Promise.resolve(null),
    ]);
    return rows.map((r) => homeView(r, caller, names, { today, contract: contracts.get(r.employeeId) ?? null, overlaps: overlaps?.get(r.id) ?? null }));
  }

  /**
   * The check-in places each request's circle overlaps (being decided or approved, with its point): the company's (the
   * main office, the sub-locations, the client locations in force; never its own client location) and the same person's
   * other approved home and remote sites. Other people's homes are never compared.
   */
  private async overlaps(rows: readonly HomeRow[], today: string): Promise<Map<string, OverlapView[]>> {
    const out = new Map<string, OverlapView[]>();
    const shown = rows.filter((r) => r.latitude && r.longitude && (isOpenHome(r.status) || r.status === 'approved'));
    if (!shown.length) return out;
    const [places, theirs] = await Promise.all([
      this.prisma.checkInLocation.findMany({ select: { id: true, name: true, latitude: true, longitude: true, radiusMetres: true, isMain: true, kind: true, validUntil: true, endedAt: true } }),
      this.prisma.homeLocationRequest.findMany({
        where: { employeeId: { in: [...new Set(shown.map((r) => r.employeeId))] }, status: 'approved', type: { in: ['home', 'remote_site'] }, latitude: { not: null } },
        select: { id: true, employeeId: true, type: true, label: true, latitude: true, longitude: true, radiusMetres: true },
      }),
    ]);
    const company = places
      .filter((p) => p.kind !== 'client' || (!p.endedAt && (!p.validUntil || fromDateOnly(p.validUntil) >= today)))
      .map((p) => ({
        id: p.id,
        candidate: {
          label: p.name,
          kind: p.kind === 'client' ? 'client' : p.isMain ? 'office' : 'sub_location',
          latitude: p.latitude.toNumber(),
          longitude: p.longitude.toNumber(),
          radiusMetres: p.radiusMetres,
        } satisfies OverlapCandidate,
      }));
    for (const r of shown) {
      const own = theirs
        .filter((t) => t.employeeId === r.employeeId && t.id !== r.id)
        .map((t) => ({ label: t.label, kind: t.type as HomeType, latitude: t.latitude!.toNumber(), longitude: t.longitude!.toNumber(), radiusMetres: t.radiusMetres }) satisfies OverlapCandidate);
      const others = [...company.filter((c) => c.id !== r.locationId).map((c) => c.candidate), ...own];
      out.set(r.id, overlapsOf({ latitude: r.latitude!.toNumber(), longitude: r.longitude!.toNumber(), radiusMetres: r.radiusMetres }, others));
    }
    return out;
  }
}

/** A check-in location's name not taken yet (whatever its capitals): the name asked, else "Acme (2)", "Acme (3)"… */
async function freeName(tx: Prisma.TransactionClient, wanted: string): Promise<string> {
  const base = wanted.trim().replace(/\s+/g, ' ').slice(0, 74) || 'Client location';
  for (let n = 1; n < 100; n++) {
    const name = n === 1 ? base : `${base} (${n})`;
    const taken = await tx.checkInLocation.count({ where: { name: { equals: name, mode: 'insensitive' } } });
    if (!taken) return name;
  }
  return `${base} (${Date.now().toString(36)})`;
}
