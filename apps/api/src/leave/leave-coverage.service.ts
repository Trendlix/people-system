import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  breaksStaffingLimit,
  COVER_REQUIRED_OVER_DAYS,
  coverageDayList,
  coverageDays,
  coverProblems,
  coverRequired,
  DEFAULT_WORKING_DAYS,
  defaultStandIn,
  hasStaffingLimit,
  isStaffingLimited,
  leaveDaysBetween,
  sortedCandidates,
  staffingLimitProblems,
  standInProblems,
  type CoverAssignment,
  type CoverCandidate,
  type CoverageElsewhere,
  type CoverageLeave,
  type CoverageMember,
  type CoverageViewer,
  type CoveringClash,
  type LeaveCoverageGroup,
  type LeaveCoverageView,
  type LeaveFormCoverage,
  type StaffingLimit,
  type StaffingUnitView,
  type StandInChoiceView,
  type StandInFacts,
  type StandInPick,
} from '@trendlix/shared';
import { AuditService } from '../audit/audit.service.js';
import type { SessionUser } from '../auth/session-user.js';
import { fromDateOnly, todayInCairo, toDateOnly } from '../common/date-only.js';
import { ConfidentialService, type ConfidentialView } from '../employees/confidential.service.js';
import type { LeaveType, Prisma } from '../generated/prisma/client.js';
import { leadsOf } from '../organisation/departments/leads.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { hiddenRequest, isRequester, seesEveryRequest, seesRequest, type Caller } from './access.js';
import { LeaveBalancesService, TAKING, type LeaveEmployment } from './leave-balances.service.js';
import type { CoverageQueryDto, StaffingLimitDto } from './leave.dto.js';
import { approvesForOthers, standInViewOf } from './stand-ins.js';
import { placeOf, STAFFING_ENTITY } from './views.js';

type Db = PrismaService | Prisma.TransactionClient;

// Leave coverage (owner, 25 October 2026: "if there are leaves applied by an employee and another employee in the same
// department is on a leave, how can we manage it without affecting the workflow?"; asked, "Warn and need HR", "Required
// over 2 days", "To a stand-in", "Names, no leave types"; packages/shared leave-coverage.ts). Worked out from the
// database for a person and days:
// - who else in their team (else their department, its teams with it) is off each day: approved leave, and leave being
//   decided marked waiting; working from home and official duty apart, at work; "N of M at work". By name only to the
//   employee and their colleagues; with "leave" to an approver; with the leave's type to HR and the CEO. A C-level
//   person's leave never shows to those who don't see C-level people (HR, colleagues), nor counts for them.
// - the team's staffing limit (HR and a Super Admin set it): a request of annual or unpaid leave that would leave fewer at
//   work than it wants on any day is still sent, with a warning, and HR approves it too ("Over the staffing limit").
// - the colleague who covers (required for annual and unpaid leave of more than 2 working days), and the stand-in of
//   someone who approves (stand-ins.ts), offered and checked on the form and when it is sent.

/** A coverage's group: the requester's team (else department, its teams with it), its limit, and the units counted in it. */
interface Group {
  group: LeaveCoverageGroup;
  limit: StaffingLimit | null;
  unitIds: string[];
}

/** What the coverage of some days is worked out from, read for a viewer. */
interface Picture {
  members: CoverageMember[];
  leave: CoverageLeave[];
  elsewhere: CoverageElsewhere[];
}

/** What a new request's coverage checks give the request to save. */
export interface NewRequestCoverage {
  problems: string[];
  coverId: string | null;
  handoverNote: string | null;
  overStaffingLimit: boolean;
  standInId: string | null;
  standInHr: boolean;
}

/** A stand-in as sent: "hr", an employee's id, or nothing (the default). */
export const pickOf = (sent: string | null | undefined): StandInPick | null => (!sent ? null : sent === 'hr' ? { employeeId: null, hr: true } : { employeeId: sent, hr: false });

const PERSON = { id: true, fullNameEn: true } as const;
const PLACE = { department: { select: { nameEn: true, parent: { select: { nameEn: true } } } } } as const;
const overlapping = (from: string, to: string) => ({ startDate: { lte: toDateOnly(to) }, endDate: { gte: toDateOnly(from) } });

@Injectable()
export class LeaveCoverageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly confidential: ConfidentialService,
    private readonly balances: LeaveBalancesService,
  ) {}

  // ---------- the form ----------

  /**
   * The new request's coverage as the employee types it (GET /me/leave/coverage): who of their team is off on its days
   * (names only), "N of M at work", the limit and whether it breaks it, the days it takes, whether a cover is required and
   * who may cover, the stand-in (when they approve for others), and the colleagues they cover on those days.
   */
  async formCoverage(query: CoverageQueryDto, user: SessionUser): Promise<LeaveFormCoverage> {
    const caller = await this.caller(user);
    if (!caller.employeeId) throw new ForbiddenException('Only an employee can ask for leave: your sign-in has no employee profile.');
    const employment = await this.balances.employmentOf(caller.employeeId);
    if (!employment || employment.endDate !== null) throw new ConflictException("You have no current employment, so you can't ask for leave.");
    const to = query.to ?? query.from;
    if (to < query.from) throw new BadRequestException(["The last day can't be before the first."]);
    if (Number(toDateOnly(to)) - Number(toDateOnly(query.from)) > 366 * 86_400_000) throw new BadRequestException(['Choose at most a year of days.']);
    const type = query.typeId ? await this.prisma.leaveType.findUnique({ where: { id: query.typeId } }) : null;
    const limited = isStaffingLimited(type?.kind);
    const holidays = await this.holidays(query.from, to);
    const count = { workingDays: employment.workingDays ?? DEFAULT_WORKING_DAYS, holidays, calendarDays: type?.calendarDays ?? false };
    const days = coverageDayList(query.from, to, count);
    const leaveDays = leaveDaysBetween(query.from, to, { ...count, halfDay: query.halfDay ?? false });
    const hidden = caller.confidential?.hidden ?? new Set<string>();
    const group = await this.groupOf(employment.departmentId);
    const picture = group ? await this.picture(group, query.from, to, { requesterId: caller.employeeId, hidden, withTypes: false }) : null;
    const coverage = coverageDays({
      days,
      members: picture?.members ?? [],
      leave: picture?.leave ?? [],
      elsewhere: picture?.elsewhere ?? [],
      requesterId: caller.employeeId,
      request: { startDate: query.from, endDate: to, limited },
      limit: group?.limit ?? null,
    });
    const [candidates, standIn, covering] = await Promise.all([
      this.coverCandidates(caller.employeeId, query.from, to, group?.unitIds ?? [], hidden),
      this.standInChoice(employment, query.from, to, caller.confidential!),
      this.coveringOn(caller.employeeId, query.from, to, hidden),
    ]);
    return {
      group: group?.group ?? null,
      limit: group?.limit ?? null,
      limited,
      viewer: 'requester',
      days: coverage,
      overLimit: limited && breaksStaffingLimit(coverage),
      covering,
      leaveDays,
      cover: { required: !!type && coverRequired(type.kind, leaveDays), overDays: COVER_REQUIRED_OVER_DAYS, candidates },
      standIn: standIn.view,
    };
  }

  // ---------- a request ----------

  /**
   * A request's coverage on its days (GET /leave/requests/:id/coverage), for those who see the request: its employee
   * (names only), an approver (names and "leave"), HR and the CEO (names with the types); the clash with the limit, and
   * the colleagues its employee covers on those days (HR sees the clash).
   */
  async requestCoverage(id: string, user: SessionUser): Promise<LeaveCoverageView> {
    const caller = await this.caller(user);
    const row = await this.prisma.leaveRequest.findUnique({
      where: { id },
      select: {
        id: true,
        employeeId: true,
        managerId: true,
        employmentId: true,
        startDate: true,
        endDate: true,
        type: { select: { kind: true, calendarDays: true } },
        employee: { select: { employments: { where: { endDate: null }, select: { managerId: true }, take: 1 } } },
      },
    });
    const parties = row && { employeeId: row.employeeId, managerId: row.managerId, currentManagerId: row.employee.employments[0]?.managerId ?? null };
    if (!row || !parties || !seesRequest(parties, caller)) throw new NotFoundException('Leave request not found.');
    const viewer: CoverageViewer = isRequester(parties, caller) ? 'requester' : seesEveryRequest(user) && !hiddenRequest(parties, caller) ? 'hr' : 'approver';
    const [employment] = await this.balances.employments([row.employmentId]);
    const from = fromDateOnly(row.startDate);
    const to = fromDateOnly(row.endDate);
    const limited = isStaffingLimited(row.type.kind);
    const holidays = await this.holidays(from, to);
    const days = coverageDayList(from, to, { workingDays: employment?.workingDays ?? DEFAULT_WORKING_DAYS, holidays, calendarDays: row.type.calendarDays });
    // never a C-level person's to those who don't see them; the requester sees as their colleagues do
    const hidden = new Set([...(caller.confidential?.hidden ?? [])].filter((p) => p !== row.employeeId));
    const group = await this.groupOf(employment?.departmentId ?? null);
    const picture = group ? await this.picture(group, from, to, { requesterId: row.employeeId, hidden, withTypes: viewer === 'hr', excludeRequestId: row.id }) : null;
    const coverage = coverageDays({
      days,
      members: picture?.members ?? [],
      leave: picture?.leave ?? [],
      elsewhere: picture?.elsewhere ?? [],
      requesterId: row.employeeId,
      request: { startDate: from, endDate: to, limited },
      limit: group?.limit ?? null,
    });
    return {
      group: group?.group ?? null,
      limit: group?.limit ?? null,
      limited,
      viewer,
      days: coverage,
      overLimit: limited && breaksStaffingLimit(coverage),
      covering: await this.coveringOn(row.employeeId, from, to, hidden, row.id),
    };
  }

  /**
   * The checks of a new request's coverage, before it is saved: the cover (required for annual and unpaid leave of more
   * than 2 working days, not for HR's record; someone employed now, not the employee, not off on those days), the
   * stand-in of someone who approves for others (chosen, else the default), and whether it breaks the team's limit
   * (counted as the employee's colleagues see it: no C-level person's leave but their own).
   */
  async checkNew(args: {
    employment: LeaveEmployment;
    type: LeaveType;
    startDate: string;
    endDate: string;
    days: number;
    holidays: string[];
    coverId?: string | null;
    handoverNote?: string | null;
    standIn?: string | null;
    byHr: boolean;
  }): Promise<NewRequestCoverage> {
    const { employment, type, startDate, endDate } = args;
    const employeeId = employment.employeeId;
    const problems: string[] = [];
    const cLevel = await this.confidential.ids();
    const hidden = new Set([...cLevel].filter((p) => p !== employeeId));
    const hasDates = startDate <= endDate;
    // the colleague who covers
    const coverId = args.coverId ?? null;
    if (coverId && hasDates) {
      const cover = hidden.has(coverId)
        ? null
        : await this.prisma.employee.findUnique({ where: { id: coverId }, select: { fullNameEn: true, employments: { where: { endDate: null }, select: { id: true }, take: 1 } } });
      const off = cover ? await this.prisma.leaveRequest.count({ where: { employeeId: coverId, status: { in: [...TAKING] }, ...overlapping(startDate, endDate) } }) : 0;
      problems.push(...coverProblems({ requesterId: employeeId, coverId, cover: cover && { fullNameEn: cover.fullNameEn, current: cover.employments.length > 0 }, offOnDays: off > 0 }));
    } else if (!coverId && !args.byHr && coverRequired(type.kind, args.days)) {
      problems.push(`Name the colleague who covers your work: ${type.nameEn.toLowerCase()} of more than ${COVER_REQUIRED_OVER_DAYS} working days needs one, someone not off on these days.`);
    }
    // the stand-in, for someone who approves for others
    let standIn: StandInPick | null = null;
    if (hasDates && (await approvesForOthers(this.prisma, employeeId))) {
      const choice = await this.standInChoice(employment, startDate, endDate, { sees: false, all: cLevel, hidden });
      const sent = pickOf(args.standIn);
      if (sent) {
        const person = sent.employeeId
          ? await this.prisma.employee.findUnique({
              where: { id: sent.employeeId },
              select: { fullNameEn: true, employments: { where: { endDate: null }, select: { id: true }, take: 1 }, account: { select: { isActive: true } } },
            })
          : null;
        const found = person && { fullNameEn: person.fullNameEn, current: person.employments.length > 0, account: !!person.account?.isActive };
        const wrong = standInProblems(sent, { ...choice.facts, person: found });
        if (wrong.length) problems.push(...wrong);
        else standIn = sent;
      } else standIn = choice.pick;
    }
    // the staffing limit: annual and unpaid leave only, never sick or casual leave
    let overStaffingLimit = false;
    if (isStaffingLimited(type.kind) && hasDates) {
      const group = await this.groupOf(employment.departmentId);
      if (group?.limit) {
        const picture = await this.picture(group, startDate, endDate, { requesterId: employeeId, hidden, withTypes: false });
        const days = coverageDayList(startDate, endDate, { workingDays: employment.workingDays ?? DEFAULT_WORKING_DAYS, holidays: args.holidays, calendarDays: type.calendarDays });
        overStaffingLimit = breaksStaffingLimit(
          coverageDays({ days, ...picture, requesterId: employeeId, request: { startDate, endDate, limited: true }, limit: group.limit }),
        );
      }
    }
    return {
      problems,
      coverId,
      handoverNote: args.handoverNote ?? null,
      overStaffingLimit,
      standInId: standIn?.employeeId ?? null,
      standInHr: standIn?.hr ?? false,
    };
  }

  /** Whether a colleague may cover a request's days now (the cover changed): the same as when it is sent. */
  async coverProblemsFor(employeeId: string, coverId: string, startDate: string, endDate: string, requestId: string): Promise<{ problems: string[]; name: string | null }> {
    const hidden = new Set([...(await this.confidential.ids())].filter((p) => p !== employeeId));
    const cover = hidden.has(coverId)
      ? null
      : await this.prisma.employee.findUnique({ where: { id: coverId }, select: { fullNameEn: true, employments: { where: { endDate: null }, select: { id: true }, take: 1 } } });
    const off = cover
      ? await this.prisma.leaveRequest.count({ where: { employeeId: coverId, id: { not: requestId }, status: { in: [...TAKING] }, ...overlapping(startDate, endDate) } })
      : 0;
    return { problems: coverProblems({ requesterId: employeeId, coverId, cover: cover && { fullNameEn: cover.fullNameEn, current: cover.employments.length > 0 }, offOnDays: off > 0 }), name: cover?.fullNameEn ?? null };
  }

  // ---------- what the caller covers ----------

  /**
   * The colleagues' leave the caller covers (GET /me/leave/covering), current or to come, approved or being decided: whom,
   * the days, and the handover note; never the type.
   */
  async covering(user: SessionUser): Promise<CoverAssignment[]> {
    const caller = await this.caller(user);
    if (!caller.employeeId) return [];
    const rows = await this.prisma.leaveRequest.findMany({
      where: { coverId: caller.employeeId, status: { in: [...TAKING] }, endDate: { gte: toDateOnly(todayInCairo()) } },
      orderBy: [{ startDate: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, startDate: true, endDate: true, halfDay: true, status: true, handoverNote: true, employee: { select: PERSON } },
    });
    return rows.map((r) => ({
      requestId: r.id,
      employee: r.employee,
      startDate: fromDateOnly(r.startDate),
      endDate: fromDateOnly(r.endDate),
      halfDay: r.halfDay,
      waiting: r.status !== 'approved',
      handoverNote: r.handoverNote,
    }));
  }

  // ---------- staffing limits ----------

  /**
   * Organization → Leave → Staffing (GET /leave/staffing): every department, its teams under it, each with its people
   * employed now and its limit; a department with teams has none of its own (its teams' are set).
   */
  async staffing(): Promise<StaffingUnitView[]> {
    const units = await this.prisma.department.findMany({
      orderBy: [{ sortOrder: 'asc' }, { nameEn: 'asc' }],
      select: {
        id: true,
        nameEn: true,
        parentId: true,
        parent: { select: { id: true, nameEn: true } },
        staffingLimit: { select: { maxOff: true, minAtWorkPercent: true, updatedAt: true } },
        _count: { select: { children: true, employments: { where: { endDate: null } } } },
      },
    });
    const own = new Map(units.map((u) => [u.id, u._count.employments]));
    const view = (u: (typeof units)[number]): StaffingUnitView => {
      const members = u.parentId ? u._count.employments : u._count.employments + units.filter((t) => t.parentId === u.id).reduce((n, t) => n + (own.get(t.id) ?? 0), 0);
      return {
        id: u.id,
        nameEn: u.nameEn,
        parent: u.parent,
        team: u.parentId !== null,
        hasTeams: u._count.children > 0,
        members,
        limit: u.staffingLimit && { maxOff: u.staffingLimit.maxOff, minAtWorkPercent: u.staffingLimit.minAtWorkPercent },
        updatedAt: u.staffingLimit?.updatedAt.toISOString() ?? null,
      };
    };
    return units.filter((u) => !u.parentId).flatMap((d) => [view(d), ...units.filter((t) => t.parentId === d.id).map(view)]);
  }

  /**
   * HR or a Super Admin sets a team's limit (or a department's without teams): at most so many on annual leave at once,
   * and/or at least so many percent at work; both empty removes it. In the audit log.
   */
  async setStaffing(departmentId: string, dto: StaffingLimitDto, user: SessionUser): Promise<StaffingUnitView> {
    const unit = await this.prisma.department.findUnique({
      where: { id: departmentId },
      select: { nameEn: true, parentId: true, staffingLimit: { select: { maxOff: true, minAtWorkPercent: true } }, _count: { select: { children: true } } },
    });
    if (!unit) throw new NotFoundException('Department not found.');
    if (!unit.parentId && unit._count.children > 0) throw new BadRequestException([`${unit.nameEn} has teams: set the limit on each of its teams.`]);
    const limit = { maxOff: dto.maxOff ?? null, minAtWorkPercent: dto.minAtWorkPercent ?? null };
    const problems = staffingLimitProblems(limit);
    if (problems.length) throw new BadRequestException(problems);
    const before = unit.staffingLimit ?? { maxOff: null, minAtWorkPercent: null };
    if (!hasStaffingLimit(limit)) {
      if (unit.staffingLimit) await this.prisma.leaveStaffingLimit.delete({ where: { departmentId } });
    } else {
      await this.prisma.leaveStaffingLimit.upsert({ where: { departmentId }, create: { departmentId, ...limit, updatedById: user.id }, update: { ...limit, updatedById: user.id } });
    }
    await this.audit.record({
      userId: user.id,
      action: !unit.staffingLimit ? 'create' : hasStaffingLimit(limit) ? 'update' : 'delete',
      entityType: STAFFING_ENTITY,
      entityId: departmentId,
      diff: { department: unit.nameEn, maxOff: { from: before.maxOff, to: limit.maxOff }, minAtWorkPercent: { from: before.minAtWorkPercent, to: limit.minAtWorkPercent } },
    });
    return (await this.staffing()).find((u) => u.id === departmentId)!;
  }

  // ---------- helpers ----------

  /** The caller, with their own employee profile, the C-level people and whom they stand in for. */
  private async caller(user: SessionUser): Promise<Caller> {
    const [employeeId, confidential] = await Promise.all([this.confidential.selfId(user), this.confidential.view(user)]);
    return { user, employeeId, confidential, standIn: await standInViewOf(this.prisma, employeeId, user) };
  }

  private async holidays(from: string, to: string): Promise<string[]> {
    return (await this.prisma.holiday.findMany({ where: { date: { gte: toDateOnly(from), lte: toDateOnly(to) } }, select: { date: true } })).map((h) => fromDateOnly(h.date));
  }

  /**
   * The group of someone in `departmentId`: their team, else their department with its teams; its limit (a team's, or
   * a department's without teams).
   */
  private async groupOf(departmentId: string | null, db: Db = this.prisma): Promise<Group | null> {
    if (!departmentId) return null;
    const unit = await db.department.findUnique({
      where: { id: departmentId },
      select: { id: true, nameEn: true, parentId: true, staffingLimit: { select: { maxOff: true, minAtWorkPercent: true } }, children: { select: { id: true } } },
    });
    if (!unit) return null;
    const team = unit.parentId !== null;
    const limit = unit.staffingLimit && (team || !unit.children.length) ? { maxOff: unit.staffingLimit.maxOff, minAtWorkPercent: unit.staffingLimit.minAtWorkPercent } : null;
    return { group: { id: unit.id, nameEn: unit.nameEn, team }, limit, unitIds: team ? [unit.id] : [unit.id, ...unit.children.map((c) => c.id)] };
  }

  /**
   * The group's people employed on some of the days (never one hidden from the viewer, but the requester), their leave
   * approved or being decided (not `excludeRequestId`), and their work from home days and official duties.
   */
  private async picture(group: Group, from: string, to: string, opts: { requesterId: string; hidden: ReadonlySet<string>; withTypes: boolean; excludeRequestId?: string }): Promise<Picture> {
    const employments = await this.prisma.employment.findMany({
      where: { departmentId: { in: group.unitIds }, joinDate: { lte: toDateOnly(to) }, OR: [{ endDate: null }, { endDate: { gte: toDateOnly(from) } }] },
      select: { employeeId: true, joinDate: true, endDate: true, employee: { select: { fullNameEn: true } } },
    });
    const byPerson = new Map<string, CoverageMember>();
    for (const e of employments) {
      if (opts.hidden.has(e.employeeId) && e.employeeId !== opts.requesterId) continue;
      const join = fromDateOnly(e.joinDate);
      const end = fromDateOnly(e.endDate);
      const before = byPerson.get(e.employeeId);
      // someone employed twice in the days: from the first employment's first day to the last's last
      const last = !before ? end : before.to === null || end === null ? null : before.to > end ? before.to : end;
      byPerson.set(e.employeeId, { id: e.employeeId, fullNameEn: e.employee.fullNameEn, from: before && before.from < join ? before.from : join, to: last });
    }
    const members = [...byPerson.values()];
    const ids = members.map((m) => m.id);
    if (!ids.length) return { members, leave: [], elsewhere: [] };
    const [leave, wfh, od] = await Promise.all([
      this.prisma.leaveRequest.findMany({
        where: { employeeId: { in: ids }, status: { in: [...TAKING] }, ...overlapping(from, to), ...(opts.excludeRequestId && { id: { not: opts.excludeRequestId } }) },
        select: { employeeId: true, startDate: true, endDate: true, halfDay: true, status: true, type: { select: { kind: true, nameEn: true } } },
      }),
      this.prisma.wfhRequest.findMany({ where: { employeeId: { in: ids }, status: { in: [...TAKING] }, date: { gte: toDateOnly(from), lte: toDateOnly(to) } }, select: { employeeId: true, date: true, status: true } }),
      this.prisma.odRequest.findMany({ where: { employeeId: { in: ids }, status: { in: [...TAKING] }, ...overlapping(from, to) }, select: { employeeId: true, startDate: true, endDate: true, status: true } }),
    ]);
    return {
      members,
      leave: leave.map((l) => ({
        employeeId: l.employeeId,
        startDate: fromDateOnly(l.startDate),
        endDate: fromDateOnly(l.endDate),
        halfDay: l.halfDay,
        waiting: l.status !== 'approved',
        limited: isStaffingLimited(l.type.kind),
        typeName: opts.withTypes ? l.type.nameEn : null,
      })),
      elsewhere: [
        ...wfh.map((w) => ({ employeeId: w.employeeId, startDate: fromDateOnly(w.date), endDate: fromDateOnly(w.date), kind: 'wfh' as const, waiting: w.status !== 'approved' })),
        ...od.map((o) => ({ employeeId: o.employeeId, startDate: fromDateOnly(o.startDate), endDate: fromDateOnly(o.endDate), kind: 'od' as const, waiting: o.status !== 'approved' })),
      ],
    };
  }

  /** Those off (approved or being decided) on some of the days, among those the viewer sees (`hidden` never counted). */
  private async offOn(from: string, to: string, hidden: ReadonlySet<string>): Promise<Set<string>> {
    const rows = await this.prisma.leaveRequest.findMany({ where: { status: { in: [...TAKING] }, ...overlapping(from, to) }, select: { employeeId: true }, distinct: ['employeeId'] });
    return new Set(rows.map((r) => r.employeeId).filter((id) => !hidden.has(id)));
  }

  /**
   * The colleagues who may cover the days: employed now, not the requester, not off on any of them, never one hidden
   * from the requester; the requester's team first.
   */
  private async coverCandidates(requesterId: string, from: string, to: string, unitIds: readonly string[], hidden: ReadonlySet<string>): Promise<CoverCandidate[]> {
    const [people, off] = await Promise.all([
      this.prisma.employee.findMany({
        where: { id: { notIn: [requesterId, ...hidden] }, employments: { some: { endDate: null } } },
        select: { id: true, fullNameEn: true, employments: { where: { endDate: null }, orderBy: { joinDate: 'desc' }, take: 1, select: { departmentId: true, ...PLACE } } },
      }),
      this.offOn(from, to, hidden),
    ]);
    return sortedCandidates(
      people
        .filter((p) => !off.has(p.id))
        .map((p) => ({ id: p.id, fullNameEn: p.fullNameEn, ...placeOf(p.employments[0]?.department ?? null), sameTeam: unitIds.includes(p.employments[0]?.departmentId ?? '') })),
    );
  }

  /**
   * The stand-in part of the form for someone who approves for others: the default (their department's head; the head's
   * head when they are the head; else HR; a C-level person's the CEO, else a Super Admin), and those offered (employed now,
   * with an active account, not off on the days; a C-level person's the CEO and Super Admins only).
   */
  private async standInChoice(employment: LeaveEmployment, from: string, to: string, confidential: ConfidentialView): Promise<{ view: StandInChoiceView; facts: StandInFacts; pick: StandInPick | null }> {
    const requesterId = employment.employeeId;
    const cLevel = confidential.all.has(requesterId);
    const [needed, leads, accounts, off] = await Promise.all([
      approvesForOthers(this.prisma, requesterId),
      leadsOf(this.prisma, employment.departmentId),
      this.prisma.user.findMany({
        where: { isActive: true, employee: { employments: { some: { endDate: null } } } },
        select: {
          employeeId: true,
          roles: { select: { role: { select: { key: true } } } },
          employee: { select: { fullNameEn: true, employments: { where: { endDate: null }, orderBy: { joinDate: 'desc' }, take: 1, select: PLACE } } },
        },
      }),
      this.offOn(from, to, confidential.hidden),
    ]);
    const keys = (a: (typeof accounts)[number]) => a.roles.map((r) => r.role.key);
    const ceoIds = accounts.filter((a) => keys(a).includes('ceo')).map((a) => a.employeeId!);
    const superAdminIds = accounts.filter((a) => keys(a).includes('super_admin')).map((a) => a.employeeId!);
    const withAccount = new Set(accounts.map((a) => a.employeeId!));
    const facts: StandInFacts = { requesterId, cLevel, departmentHeadId: leads.departmentHead?.id ?? null, managerId: employment.managerId, ceoIds, superAdminIds, unavailable: off };
    // the default is someone who can decide in the system: with an account, not off
    const noAccount = [leads.departmentHead?.id, employment.managerId].filter((id): id is string => !!id && !withAccount.has(id));
    const unavailable = new Set([...off, ...noAccount]);
    const pick = needed ? defaultStandIn({ ...facts, unavailable }) : null;
    const names = new Map(accounts.map((a) => [a.employeeId!, a.employee!.fullNameEn]));
    const options = accounts
      .filter((a) => a.employeeId !== requesterId && !off.has(a.employeeId!) && (!cLevel || ceoIds.includes(a.employeeId!) || superAdminIds.includes(a.employeeId!)))
      .map((a) => ({ id: a.employeeId!, fullNameEn: a.employee!.fullNameEn, ...placeOf(a.employee!.employments[0]?.department ?? null) }))
      .sort((a, b) => a.fullNameEn.localeCompare(b.fullNameEn));
    const view: StandInChoiceView = {
      needed,
      default: pick && { employee: pick.employeeId ? { id: pick.employeeId, fullNameEn: names.get(pick.employeeId) ?? '' } : null, hr: pick.hr },
      options: needed ? options : [],
      hr: !cLevel,
      cLevel,
    };
    return { view, facts, pick };
  }

  /** The colleagues' leave someone covers on some of the days (approved or being decided): a warning, never a block. */
  private async coveringOn(employeeId: string, from: string, to: string, hidden: ReadonlySet<string>, notRequestId?: string): Promise<CoveringClash[]> {
    const rows = await this.prisma.leaveRequest.findMany({
      where: { coverId: employeeId, status: { in: [...TAKING] }, ...overlapping(from, to), ...(notRequestId && { id: { not: notRequestId } }) },
      orderBy: { startDate: 'asc' },
      select: { id: true, employeeId: true, startDate: true, endDate: true, halfDay: true, status: true, employee: { select: PERSON } },
    });
    return rows
      .filter((r) => !hidden.has(r.employeeId))
      .map((r) => ({ requestId: r.id, employee: r.employee, startDate: fromDateOnly(r.startDate), endDate: fromDateOnly(r.endDate), halfDay: r.halfDay, waiting: r.status !== 'approved' }));
  }
}
