import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  decidesHomeStage,
  HOME_OPEN_ALREADY,
  HOME_RADIUS_DEFAULT,
  HOME_STATUS_LABELS,
  homeDecisionStepKind,
  homeLabelOf,
  homeRadiusProblems,
  homeRequestProblems,
  homeStage,
  homeStatusAfterApproval,
  OPEN_HOME_STATUSES,
  removesHome,
  seesHome,
  seesHomeLocations,
  waitsForHome,
  withdrawsHome,
  type HomePoint,
  type HomeStatus,
} from '@trendlix/shared';
import { AuditService } from '../audit/audit.service.js';
import type { SessionUser } from '../auth/session-user.js';
import { ConfidentialService } from '../employees/confidential.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { userNames } from '../payroll/adjustments/people.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { HOME_ENTITY, HOME_INCLUDE, homeParties, homeView, type HomeCaller, type HomeLocationView, type HomeRow } from './home-location-views.js';
import type { CreateHomeLocationDto, DecideHomeLocationDto, ListHomeLocationsDto, RemoveHomeLocationDto } from './home-locations.dto.js';

type Db = PrismaService | Prisma.TransactionClient;

const NOT_FOUND = 'Home location not found.';
const NOT_YOURS = 'Only HR, the CEO and the Super Admin see home locations.';

/** A coordinate kept to 6 decimals (about 10 cm), as the column keeps it. */
const coordinate = (n: number) => Math.round(n * 1e6) / 1e6 + 0;

/** A status as a message says it: "with HR", "with the CEO", "approved". */
const statusWords = (status: string) => {
  const label = HOME_STATUS_LABELS[status as HomeStatus] ?? status;
  return label.startsWith('With ') ? `with ${label.slice(5)}` : label.toLowerCase();
};

/** What a request no longer keeps once it is decided against, withdrawn, replaced or removed: the point and the label. */
const FORGET = { latitude: null, longitude: null, label: null } as const;

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
@Injectable()
export class HomeLocationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly confidential: ConfidentialService,
  ) {}

  // ---------- the employee's own ----------

  /** The caller's own requests, newest first; none without an employee profile. */
  async mine(user: SessionUser): Promise<HomeLocationView[]> {
    const caller = await this.caller(user);
    if (!caller.employeeId) return [];
    const rows = await this.prisma.homeLocationRequest.findMany({ where: { employeeId: caller.employeeId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], include: HOME_INCLUDE });
    return this.views(rows, caller);
  }

  /** The employee asks for their home: with HR first. One being decided at a time. */
  async create(dto: CreateHomeLocationDto, user: SessionUser): Promise<HomeLocationView> {
    const caller = await this.caller(user);
    const employeeId = caller.employeeId;
    if (!employeeId) throw new ForbiddenException('Only an employee can ask for a home location: your sign-in has no employee profile.');
    const problems = homeRequestProblems({ latitude: dto.latitude, longitude: dto.longitude, label: dto.label });
    if (problems.length) throw new BadRequestException(problems);
    const label = homeLabelOf(dto.label);
    const accuracyMetres = typeof dto.accuracy === 'number' ? Math.round(dto.accuracy) : null;
    const id = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM employees WHERE id = ${employeeId}::uuid FOR UPDATE`;
      const open = await tx.homeLocationRequest.count({ where: { employeeId, status: { in: [...OPEN_HOME_STATUSES] } } });
      if (open) throw new ConflictException(HOME_OPEN_ALREADY);
      const made = await tx.homeLocationRequest.create({
        data: {
          employeeId,
          latitude: coordinate(dto.latitude!),
          longitude: coordinate(dto.longitude!),
          radiusMetres: HOME_RADIUS_DEFAULT,
          label,
          accuracyMetres,
          status: 'with_hr',
          createdById: user.id,
        },
        select: { id: true },
      });
      await this.step(tx, made.id, user.id, { kind: 'submitted', radiusMetres: HOME_RADIUS_DEFAULT });
      return made.id;
    });
    // never the point nor the label: what was asked and where it stands
    await this.audit.record({ userId: user.id, action: 'create', entityType: HOME_ENTITY, entityId: id, diff: { employeeId, radiusMetres: HOME_RADIUS_DEFAULT, status: 'with_hr' } });
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
   * if they give one. Its point and label are deleted, not hidden; the audit log records the removal without them.
   */
  async remove(id: string, dto: RemoveHomeLocationDto, user: SessionUser): Promise<HomeLocationView> {
    const caller = await this.caller(user);
    const before = await this.visible(id, caller);
    const parties = homeParties(before, caller);
    if (!removesHome(user, { ...parties, status: before.status })) {
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
      diff: { employeeId: before.employeeId, by: parties.own ? 'employee' : 'staff', status: { from: 'approved', to: 'removed' }, ...(comment && { comment }) },
    });
    return this.one(id, user);
  }

  // ---------- HR, the CEO and the Super Admin ----------

  /**
   * The requests the caller sees (HR not a C-level person's), newest first: by status (`waiting`: theirs to decide;
   * `open`: being decided) and by employee. Anyone else is refused (403).
   */
  async list(query: ListHomeLocationsDto, user: SessionUser): Promise<HomeLocationView[]> {
    if (!seesHomeLocations(user)) throw new ForbiddenException(NOT_YOURS);
    const caller = await this.caller(user);
    const status = query.status === 'waiting' || query.status === 'open' ? { in: [...OPEN_HOME_STATUSES] } : query.status;
    const rows = await this.prisma.homeLocationRequest.findMany({
      where: { ...(status && { status }), ...(query.employeeId && { employeeId: query.employeeId }) },
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
   * The decision of the stage the request is at: HR's (approve, with the radius as asked or another, or reject with a
   * comment), then the CEO's (approve or reject with a comment). A C-level person's HR step is the CEO's (or HR with Super
   * Admin); a CEO's own CEO step a Super Admin's; nobody decides their own. The CEO's approval puts the home in force and
   * replaces the one approved before it, in a transaction holding the employee's row. Rejected, the point is deleted.
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
    const to: HomeStatus = dto.decision === 'reject' ? 'rejected' : homeStatusAfterApproval(stage);
    const now = new Date();

    const replaced = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM employees WHERE id = ${before.employeeId}::uuid FOR UPDATE`;
      // a newly approved home replaces the one approved before it (owner's brief: one approved home a person)
      const old = to === 'approved' ? await tx.homeLocationRequest.findFirst({ where: { employeeId: before.employeeId, status: 'approved', id: { not: id } }, select: { id: true } }) : null;
      if (old) {
        await tx.homeLocationRequest.update({ where: { id: old.id }, data: { status: 'replaced', endedAt: now, ...FORGET } });
        await this.step(tx, old.id, user.id, { kind: 'replaced' });
      }
      const { count } = await tx.homeLocationRequest.updateMany({
        where: { id, status: before.status },
        data:
          to === 'rejected'
            ? { status: to, rejectedStage: stage, rejectReason: comment, endedAt: now, ...FORGET }
            : { status: to, radiusMetres: radius, ...(to === 'approved' && { approvedAt: now }) },
      });
      if (!count) throw new ConflictException('This request was decided or withdrawn meanwhile. Reload the page to see where it is.');
      await this.step(tx, id, user.id, {
        kind: homeDecisionStepKind(stage),
        decision: dto.decision,
        comment,
        radiusMetres: stage === 'hr' && dto.decision === 'approve' ? radius : null,
      });
      return old?.id ?? null;
    });
    await this.audit.record({
      userId: user.id,
      action: dto.decision === 'reject' ? 'reject' : 'approve',
      entityType: HOME_ENTITY,
      entityId: id,
      // "home location approved", never the point
      diff: {
        employeeId: before.employeeId,
        stage,
        decision: dto.decision,
        status: { from: before.status, to },
        ...(radius !== before.radiusMetres && { radiusMetres: { from: before.radiusMetres, to: radius } }),
        ...(comment && { comment }),
        ...(replaced && { replaced }),
      },
    });
    if (replaced) {
      await this.audit.record({ userId: user.id, action: 'replace', entityType: HOME_ENTITY, entityId: replaced, diff: { employeeId: before.employeeId, status: { from: 'approved', to: 'replaced' }, by: id } });
    }
    return this.one(id, user);
  }

  // ---------- for checking in ----------

  /** A person's approved home, as a check-in is read against it; none without one. Never sent on. */
  async homePoint(employeeId: string, db: Db = this.prisma): Promise<HomePoint | null> {
    const home = await db.homeLocationRequest.findFirst({ where: { employeeId, status: 'approved' }, select: { latitude: true, longitude: true, radiusMetres: true } });
    if (!home?.latitude || !home.longitude) return null;
    return { latitude: home.latitude.toNumber(), longitude: home.longitude.toNumber(), radiusMetres: home.radiusMetres };
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

  /** The requests as the caller sees them, with who took each step. */
  private async views(rows: readonly HomeRow[], caller: HomeCaller): Promise<HomeLocationView[]> {
    if (!rows.length) return [];
    const names = await userNames(this.prisma, rows.flatMap((r) => r.steps.map((s) => s.actor)));
    return rows.map((r) => homeView(r, caller, names));
  }
}

