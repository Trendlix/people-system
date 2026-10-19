import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  DEFAULT_WORKING_DAYS,
  employeeMayCancelLeave,
  firstLeaveStatus,
  LEAVE_STATUS_LABELS,
  leaveDecisionNeedsComment,
  leaveDecisionStepKind,
  leaveStage,
  leaveStatusAfterApproval,
  PERMISSION_RULE_DEFAULTS,
  permissionLeft,
  permissionMonth,
  permissionRequestProblems,
  permissionTimes,
  underLabourLaw,
  type LeaveStatus,
  type PermissionRules,
} from '@trendlix/shared';
import { AuditService } from '../audit/audit.service.js';
import type { SessionUser } from '../auth/session-user.js';
import { fromDateOnly, shownDate, todayInCairo, toDateOnly, weekday } from '../common/date-only.js';
import { toTimeOfDay } from '../common/time-of-day.js';
import { ConfidentialService } from '../employees/confidential.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { approverFor } from '../organisation/departments/leads.js';
import { userNames } from '../payroll/adjustments/people.js';
import { firstDay, lastDay } from '../payroll/months.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  decidesStage,
  hiddenRequest,
  hrMayCancel,
  isConfidentialRequest,
  isHr,
  isRequestManager,
  isRequester,
  othersWhere,
  seesRequest,
  waitingWhere,
  type Caller,
  type RequestWhere,
} from './access.js';
import { LeaveBalancesService, TAKING, type LeaveEmployment } from './leave-balances.service.js';
import { LeavePayrollService } from './leave-payroll.service.js';
import type { DecideLeaveDto, HrCancelLeaveDto } from './leave.dto.js';
import {
  PERMISSION_ENTITY,
  PERMISSION_INCLUDE,
  PERMISSION_TYPE,
  permissionParties,
  permissionRulesOf,
  permissionView,
  timeOf,
  type PermissionMonthView,
  type PermissionRequestView,
  type PermissionRow,
} from './permission-views.js';
import type { CreatePermissionDto, ListPermissionsDto, RecordPermissionDto } from './permissions.dto.js';
import { placeOf } from './views.js';

type Db = PrismaService | Prisma.TransactionClient;

const NOT_FOUND = 'Permission request not found.';

/** A status as a message says it: "with HR", "approved". */
const statusWords = (status: string) => {
  const label = LEAVE_STATUS_LABELS[status as LeaveStatus] ?? status;
  return label[0].toLowerCase() + label.slice(1);
};

const hoursOf = (d: Prisma.Decimal) => d.toNumber();
const halfHours = (n: number) => Math.round(n * 2) / 2 + 0;

/** A permission on the calendar, as GET /leave/calendar sends it beside the leave (kind 'permission'). */
export interface PermissionCalendarItem {
  id: string;
  kind: 'permission';
  employee: { id: string; fullNameEn: string; department: string | null; team: string | null };
  type: { id: string; nameEn: string; nameAr: string };
  startDate: string;
  endDate: string;
  halfDay: false;
  hours: number;
  fromTime: string | null;
  toTime: string | null;
  status: LeaveStatus;
}

// Permission requests (owner, 19 October 2026: "this is an option given by us .. 4 hours per month with a maximum 2 hours
// per day"; asked how, "In the system, like leave"; the limits "Yes, in Leave Setup"). An employee asks for a few hours of
// a working day under their current employment, from My Requests → Permission: in half hours, at most the Leave Setup's
// hours a day and what is left of the month's (those approved and being decided counted), never on a rest day of their
// shift, an official holiday or a day they have leave (approved or being decided), each refused with every reason
// (packages/shared permissionRequestProblems), in a transaction holding the employee's row so two sent together can't both
// take the last hours. Decided exactly as leave is (access.ts): their direct manager, else their team lead, else their
// department's head (department leads, 19 October 2026), never themself, then HR; nobody in charge: straight to HR; a
// C-level person's HR stage by the CEO (owner, 19 October 2026: "make C level Employees details not visible to HR"), HR and
// their manager now not seeing it. HR records permission on an employee's behalf, approved at once. The employee cancels
// theirs while it is being decided, or approved and its day still to come; HR cancels an approved one with a comment.
// Each step is logged on the request and in the audit log. Approved or cancelled, the month's draft payroll line is worked
// out again (leave-payroll.service.ts): its permission hours count as worked. Under the labour law only, as leave is: a
// freelancer and an unpaid intern have none (judgment call, 19 October 2026: "like leave").
@Injectable()
export class PermissionRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly balances: LeaveBalancesService,
    private readonly payroll: LeavePayrollService,
    private readonly confidential: ConfidentialService,
  ) {}

  // ---------- the employee's own ----------

  /** The caller's own requests, the latest day first; none without an employee profile. */
  async mine(user: SessionUser): Promise<PermissionRequestView[]> {
    const caller = await this.caller(user);
    if (!caller.employeeId) return [];
    const rows = await this.prisma.permissionRequest.findMany({ where: { employeeId: caller.employeeId }, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }], include: PERMISSION_INCLUDE });
    return this.views(rows, caller);
  }

  /** The caller's own permission hours of a month (this month in Cairo unless sent). */
  async myMonth(month: string | undefined, user: SessionUser): Promise<PermissionMonthView> {
    const caller = await this.caller(user);
    if (!caller.employeeId) throw new ForbiddenException('Your sign-in has no employee profile, so there are no permission hours.');
    return this.monthOf(caller.employeeId, month ?? todayInCairo().slice(0, 7));
  }

  /** An employee's request for themself, under their current employment. */
  async create(dto: CreatePermissionDto, user: SessionUser): Promise<PermissionRequestView> {
    const caller = await this.caller(user);
    if (!caller.employeeId) throw new ForbiddenException('Only an employee can ask for permission: your sign-in has no employee profile.');
    const employment = await this.balances.employmentOf(caller.employeeId);
    if (!employment || employment.endDate !== null) throw new ConflictException("You have no current employment, so you can't ask for permission.");
    const id = await this.submit(employment, dto, caller, false);
    return this.one(id, user);
  }

  /** The employee cancels their own request: while it is being decided, or approved and its day still to come. */
  async cancelMine(id: string, user: SessionUser): Promise<PermissionRequestView> {
    const caller = await this.caller(user);
    const before = await this.prisma.permissionRequest.findUnique({ where: { id } });
    if (!before || !isRequester(before, caller)) throw new NotFoundException(NOT_FOUND);
    const date = fromDateOnly(before.date);
    if (!employeeMayCancelLeave({ status: before.status, startDate: date }, todayInCairo())) {
      throw new ConflictException(
        before.status === 'approved'
          ? "This permission's day has come, so it can no longer be cancelled here. Ask HR to cancel it."
          : `This request is ${statusWords(before.status)}, so it can't be cancelled.`,
      );
    }
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.permissionRequest.updateMany({ where: { id, status: before.status }, data: { status: 'cancelled' } });
      if (!count) throw new ConflictException("This request was decided meanwhile, so it can't be cancelled. Reload the page to see where it is.");
      await this.step(tx, id, user.id, { kind: 'cancelled' });
    });
    await this.audit.record({ userId: user.id, action: 'cancel', entityType: PERMISSION_ENTITY, entityId: id, diff: { employeeId: before.employeeId, status: { from: before.status, to: 'cancelled' } } });
    if (before.status === 'approved') await this.payroll.syncDrafts(before.employeeId, date, date, user);
    return this.one(id, user);
  }

  // ---------- HR on an employee's behalf ----------

  /** HR records permission for an employee, approved at once, under the employment the day is in. Never HR's own. */
  async record(dto: RecordPermissionDto, user: SessionUser): Promise<PermissionRequestView> {
    const caller = await this.caller(user);
    if (!isHr(user)) throw new ForbiddenException('Only HR records permission on an employee’s behalf.');
    if (caller.employeeId === dto.employeeId) throw new ForbiddenException('Someone else in HR has to record your own permission, or send it from My Requests.');
    const person = await this.prisma.employee.findUnique({ where: { id: dto.employeeId }, select: { fullNameEn: true } });
    if (!person || caller.confidential?.hidden.has(dto.employeeId)) throw new NotFoundException('Employee not found.');
    const covering = await this.prisma.employment.findFirst({
      where: { employeeId: dto.employeeId, joinDate: { lte: toDateOnly(dto.date) }, OR: [{ endDate: null }, { endDate: { gte: toDateOnly(dto.date) } }] },
      orderBy: { joinDate: 'desc' },
      select: { id: true },
    });
    const employment = covering ? (await this.balances.employments([covering.id]))[0] : null;
    if (!employment) throw new BadRequestException([`Choose a day within one of ${person.fullNameEn}'s employments.`]);
    const id = await this.submit(employment, dto, caller, true);
    await this.payroll.syncDrafts(dto.employeeId, dto.date, dto.date, user);
    return this.one(id, user);
  }

  // ---------- deciding and seeing them ----------

  /** The requests of others the caller sees, the latest day first (as Leave Requests lists leave). `waiting`: theirs to decide. */
  async list(query: ListPermissionsDto, user: SessionUser): Promise<PermissionRequestView[]> {
    const caller = await this.caller(user);
    const rows = await this.prisma.permissionRequest.findMany({
      where: {
        AND: [
          othersWhere(caller),
          query.status === 'waiting' ? waitingWhere(caller) : query.status ? { status: query.status } : {},
          query.employeeId ? { employeeId: query.employeeId } : {},
          query.from ? { date: { gte: toDateOnly(query.from) } } : {},
          query.to ? { date: { lte: toDateOnly(query.to) } } : {},
        ],
      },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      include: PERMISSION_INCLUDE,
    });
    return this.views(rows, caller);
  }

  /** How many permission requests wait for the caller's decision (the menu's badges count them with the leave). */
  async waitingCount(caller: Caller): Promise<number> {
    return this.prisma.permissionRequest.count({ where: waitingWhere(caller) });
  }

  async one(id: string, user: SessionUser): Promise<PermissionRequestView> {
    const caller = await this.caller(user);
    return (await this.views([await this.visible(id, caller)], caller))[0];
  }

  /**
   * The decision of the stage the request is at, by its decider: the manager it was sent to, then HR (a C-level
   * person's: the CEO); never the employee's own. Approve moves it on (HR's approves it); reject, with a comment, ends it.
   */
  async decide(id: string, dto: DecideLeaveDto, user: SessionUser): Promise<PermissionRequestView> {
    const caller = await this.caller(user);
    const before = await this.visible(id, caller);
    const parties = permissionParties(before);
    const stage = leaveStage(before.status);
    if (!stage) throw new ConflictException(`This request is ${statusWords(before.status)}, so there is nothing left to decide. Reload the page to see it.`);
    if (isRequester(parties, caller)) throw new ForbiddenException('Someone else has to decide your own permission request.');
    if (!decidesStage(stage, parties, caller)) {
      if (isRequestManager(parties, caller) || decidesStage('hr', parties, caller)) {
        throw new ConflictException(`This request is ${statusWords(before.status)} now, so it isn't waiting for your decision. Reload the page to see where it is.`);
      }
      throw new ForbiddenException(
        isConfidentialRequest(parties, caller)
          ? "A C-level person's permission request is decided by its direct manager, then the CEO."
          : "Only the request's direct manager and HR decide a permission request.",
      );
    }
    const comment = dto.comment ?? null;
    if (leaveDecisionNeedsComment(dto.decision) && !comment) throw new BadRequestException('Write a comment: why the permission is rejected.');
    const to: LeaveStatus = dto.decision === 'reject' ? 'rejected' : leaveStatusAfterApproval(stage);
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.permissionRequest.updateMany({
        where: { id, status: before.status },
        data: to === 'rejected' ? { status: to, rejectedStage: stage, rejectReason: comment } : { status: to },
      });
      if (!count) throw new ConflictException('This request was decided or cancelled meanwhile. Reload the page to see where it is.');
      await this.step(tx, id, user.id, { kind: leaveDecisionStepKind(stage), decision: dto.decision, comment });
    });
    await this.audit.record({
      userId: user.id,
      action: dto.decision === 'reject' ? 'reject' : 'approve',
      entityType: PERMISSION_ENTITY,
      entityId: id,
      diff: { employeeId: before.employeeId, stage, decision: dto.decision, status: { from: before.status, to }, ...(comment && { comment }) },
    });
    const date = fromDateOnly(before.date);
    if (to === 'approved') await this.payroll.syncDrafts(before.employeeId, date, date, user);
    return this.one(id, user);
  }

  /** HR cancels an approved request, saying why. Never HR's own; a C-level person's only HR who sees them. */
  async hrCancel(id: string, dto: HrCancelLeaveDto, user: SessionUser): Promise<PermissionRequestView> {
    const caller = await this.caller(user);
    const before = await this.visible(id, caller);
    const parties = permissionParties(before);
    if (!isHr(user)) throw new ForbiddenException('Only HR cancels an approved permission.');
    if (isRequester(parties, caller)) throw new ForbiddenException('Someone else in HR has to cancel your own permission.');
    if (!hrMayCancel({ ...parties, status: before.status }, caller)) {
      throw new ConflictException(`This request is ${statusWords(before.status)}: HR cancels approved permission only. ${before.status === 'with_hr' ? 'Reject it instead.' : ''}`.trim());
    }
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.permissionRequest.updateMany({ where: { id, status: 'approved' }, data: { status: 'cancelled' } });
      if (!count) throw new ConflictException('This request was cancelled meanwhile. Reload the page to see where it is.');
      await this.step(tx, id, user.id, { kind: 'cancelled', comment: dto.comment });
    });
    await this.audit.record({
      userId: user.id,
      action: 'cancel',
      entityType: PERMISSION_ENTITY,
      entityId: id,
      diff: { employeeId: before.employeeId, status: { from: 'approved', to: 'cancelled' }, comment: dto.comment },
    });
    const date = fromDateOnly(before.date);
    await this.payroll.syncDrafts(before.employeeId, date, date, user);
    return this.one(id, user);
  }

  // ---------- an employee's month and the calendar ----------

  /**
   * A person's permission of a month (HR, the CEO, Finance, the person and their manager now, as their leave): the
   * month's hours, and their requests on its days, the latest first.
   */
  async employeeMonth(employeeId: string, month: string | undefined, user: SessionUser): Promise<PermissionMonthView & { requests: PermissionRequestView[] }> {
    const caller = await this.caller(user);
    if (!(await this.prisma.employee.findUnique({ where: { id: employeeId }, select: { id: true } }))) throw new NotFoundException('Employee not found.');
    await this.balances.assertSees(employeeId, caller);
    const m = month ?? todayInCairo().slice(0, 7);
    const rows = await this.prisma.permissionRequest.findMany({
      where: { employeeId, date: { gte: toDateOnly(firstDay(m)), lte: toDateOnly(lastDay(m)) } },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      include: PERMISSION_INCLUDE,
    });
    return { ...(await this.monthOf(employeeId, m)), requests: await this.views(rows, caller) };
  }

  /**
   * The permissions on the leave calendar from `from` to `to` (as hours, owner's brief, 19 October 2026): approved, and
   * for HR those being decided too, as far as the caller sees requests (`scope`), by a department and its teams.
   */
  async calendarItems(scope: RequestWhere, statuses: readonly string[], from: string, to: string, departmentId?: string): Promise<PermissionCalendarItem[]> {
    const rows = await this.prisma.permissionRequest.findMany({
      where: {
        AND: [
          scope,
          { status: { in: [...statuses] } },
          { date: { gte: toDateOnly(from), lte: toDateOnly(to) } },
          departmentId ? { employment: { OR: [{ departmentId }, { department: { parentId: departmentId } }] } } : {},
        ],
      },
      orderBy: [{ date: 'asc' }, { employee: { fullNameEn: 'asc' } }],
      select: {
        id: true,
        date: true,
        hours: true,
        fromTime: true,
        toTime: true,
        status: true,
        employee: { select: { id: true, fullNameEn: true } },
        employment: { select: { department: { select: { nameEn: true, parent: { select: { nameEn: true } } } } } },
      },
    });
    return rows.map((r) => {
      const date = fromDateOnly(r.date);
      return {
        id: r.id,
        kind: 'permission' as const,
        employee: { id: r.employee.id, fullNameEn: r.employee.fullNameEn, ...placeOf(r.employment.department) },
        type: { id: PERMISSION_TYPE.id, nameEn: PERMISSION_TYPE.nameEn, nameAr: PERMISSION_TYPE.nameAr },
        startDate: date,
        endDate: date,
        halfDay: false as const,
        hours: r.hours.toNumber(),
        fromTime: timeOf(r.fromTime),
        toTime: timeOf(r.toTime),
        status: r.status as LeaveStatus,
      };
    });
  }

  // ---------- helpers ----------

  /** The Leave Setup's permission limits (the migration's row; the owner's 4 and 2 should it be missing). */
  async rules(db: Db = this.prisma): Promise<PermissionRules> {
    const row = await db.leaveSettings.findUnique({ where: { id: 1 }, select: { permissionHoursPerMonth: true, permissionMaxHoursPerDay: true } });
    return row ? permissionRulesOf(row) : { ...PERMISSION_RULE_DEFAULTS };
  }

  /** The caller, with their own employee profile and the C-level people. */
  async caller(user: SessionUser): Promise<Caller> {
    const [me, confidential] = await Promise.all([
      this.prisma.employee.findUnique({ where: { workEmail: user.email.toLowerCase() }, select: { id: true } }),
      this.confidential.view(user),
    ]);
    return { user, employeeId: me?.id ?? null, confidential };
  }

  /** A person's permission hours of a month: approved, being decided, left, and by day. */
  private async monthOf(employeeId: string, month: string, db: Db = this.prisma): Promise<PermissionMonthView> {
    const [rules, rows] = await Promise.all([
      this.rules(db),
      db.permissionRequest.findMany({
        where: { employeeId, status: { in: [...TAKING] }, date: { gte: toDateOnly(firstDay(month)), lte: toDateOnly(lastDay(month)) } },
        select: { date: true, hours: true, status: true },
        orderBy: { date: 'asc' },
      }),
    ]);
    const sum = (list: typeof rows) => halfHours(list.reduce((n, r) => n + hoursOf(r.hours), 0));
    const approved = sum(rows.filter((r) => r.status === 'approved'));
    const pending = sum(rows.filter((r) => r.status !== 'approved'));
    const byDay = new Map<string, number>();
    for (const r of rows) byDay.set(fromDateOnly(r.date), halfHours((byDay.get(fromDateOnly(r.date)) ?? 0) + hoursOf(r.hours)));
    return {
      month,
      hoursPerMonth: rules.hoursPerMonth,
      maxHoursPerDay: rules.maxHoursPerDay,
      approved,
      pending,
      left: permissionLeft(rules, approved + pending),
      days: [...byDay].map(([date, hours]) => ({ date, hours })),
    };
  }

  /**
   * A request saved, checked against the Leave Setup's limits in a transaction holding the employee's row: an
   * employee's to the person in charge (or HR), HR's approved at once.
   */
  private async submit(employment: LeaveEmployment, dto: CreatePermissionDto, caller: Caller, byHr: boolean): Promise<string> {
    const user = caller.user;
    const employeeId = employment.employeeId;
    const name = byHr ? employment.employee.fullNameEn : null;
    // under the labour law only, as leave is (a judgment call: "like leave", owner, 19 October 2026)
    if (!underLabourLaw(employment.employmentType)) throw new BadRequestException([noPermissionMessage(employment.employmentType, name)]);
    const inEmployment: string[] = [];
    if (dto.date < employment.joinDate) inEmployment.push(`The permission must be within the employment, which started on ${shownDate(employment.joinDate)}.`);
    if (employment.endDate && dto.date > employment.endDate) inEmployment.push(`The permission must be within the employment, which ended on ${shownDate(employment.endDate)}.`);
    const times = permissionTimes(dto.hours, dto.fromTime, dto.toTime);
    const holiday = await this.prisma.holiday.findUnique({ where: { date: toDateOnly(dto.date) }, select: { nameEn: true } });
    // the direct manager, else the team lead, else the department's head (19 October 2026), never the employee themself
    const approver = await approverFor(this.prisma, { employeeId, managerId: employment.managerId, departmentId: employment.departmentId });
    const managerId = approver?.employeeId ?? null;
    const approverRole = approver?.role ?? null;
    const status: LeaveStatus = byHr ? 'approved' : firstLeaveStatus(managerId !== null);
    const month = permissionMonth(dto.date);

    const id = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM employees WHERE id = ${employeeId}::uuid FOR UPDATE`;
      const [rules, leave, taken] = await Promise.all([
        this.rules(tx),
        tx.leaveRequest.findFirst({
          where: { employeeId, status: { in: [...TAKING] }, startDate: { lte: toDateOnly(dto.date) }, endDate: { gte: toDateOnly(dto.date) } },
          orderBy: { startDate: 'asc' },
          select: { status: true, type: { select: { nameEn: true } } },
        }),
        tx.permissionRequest.findMany({
          where: { employeeId, status: { in: [...TAKING] }, date: { gte: toDateOnly(firstDay(month)), lte: toDateOnly(lastDay(month)) } },
          select: { date: true, hours: true },
        }),
      ]);
      const usedInMonth = halfHours(taken.reduce((n, r) => n + hoursOf(r.hours), 0));
      const usedThatDay = halfHours(taken.filter((r) => fromDateOnly(r.date) === dto.date).reduce((n, r) => n + hoursOf(r.hours), 0));
      const problems = [
        ...inEmployment,
        ...permissionRequestProblems(
          { date: dto.date, hours: dto.hours, fromTime: dto.fromTime, toTime: dto.toTime },
          rules,
          {
            workingDay: (employment.workingDays ?? DEFAULT_WORKING_DAYS).includes(weekday(dto.date)),
            holiday: holiday?.nameEn ?? null,
            leave: leave ? { type: leave.type.nameEn, status: statusWords(leave.status) } : null,
            usedThatDay,
            usedInMonth,
          },
          name,
        ),
      ];
      if (problems.length) throw new BadRequestException(problems);
      const made = await tx.permissionRequest.create({
        data: {
          employeeId,
          employmentId: employment.id,
          date: toDateOnly(dto.date),
          hours: dto.hours,
          fromTime: times.fromTime ? toTimeOfDay(times.fromTime) : null,
          toTime: times.toTime ? toTimeOfDay(times.toTime) : null,
          reason: dto.reason ?? null,
          status,
          managerId,
          approverRole,
          recordedByHr: byHr,
          createdById: user.id,
        },
        select: { id: true },
      });
      if (byHr) await this.step(tx, made.id, user.id, { kind: 'recorded_by_hr' });
      else {
        await this.step(tx, made.id, user.id, { kind: 'submitted' });
        if (!managerId) await this.step(tx, made.id, null, { kind: 'no_manager' });
      }
      return made.id;
    });
    await this.audit.record({
      userId: user.id,
      action: byHr ? 'record' : 'create',
      entityType: PERMISSION_ENTITY,
      entityId: id,
      diff: { employeeId, date: dto.date, hours: dto.hours, fromTime: times.fromTime, toTime: times.toTime, reason: dto.reason ?? null, managerId, approverRole, status },
    });
    return id;
  }

  /** Logs a step on a request, in the transaction the step is taken in. */
  private async step(db: Db, requestId: string, actorId: string | null, step: { kind: string; decision?: string; comment?: string | null }) {
    await db.permissionRequestStep.create({ data: { requestId, actorId, kind: step.kind, decision: step.decision ?? null, comment: step.comment ?? null } });
  }

  /** A request the caller may see; otherwise it isn't there. */
  private async visible(id: string, caller: Caller): Promise<PermissionRow> {
    const row = await this.prisma.permissionRequest.findUnique({ where: { id }, include: PERMISSION_INCLUDE });
    if (!row || !seesRequest(permissionParties(row), caller)) throw new NotFoundException(NOT_FOUND);
    return row;
  }

  /**
   * The requests as the caller sees them, with who took each step and what is left of each one's month (never a C-level
   * person's to the manager a request was sent to, who sees their card only).
   */
  private async views(rows: readonly PermissionRow[], caller: Caller): Promise<PermissionRequestView[]> {
    if (!rows.length) return [];
    const today = todayInCairo();
    const keyOf = (employeeId: string, date: Date) => `${employeeId}:${permissionMonth(fromDateOnly(date))}`;
    const shown = rows.filter((r) => !hiddenRequest(r, caller));
    const days = shown.map((r) => fromDateOnly(r.date)).sort();
    // every month's hours taken at once: those approved and being decided, by person and month
    const [names, rules, taken] = await Promise.all([
      userNames(this.prisma, rows.flatMap((r) => r.steps.map((s) => s.actor))),
      this.rules(),
      shown.length
        ? this.prisma.permissionRequest.findMany({
            where: {
              employeeId: { in: [...new Set(shown.map((r) => r.employeeId))] },
              status: { in: [...TAKING] },
              date: { gte: toDateOnly(firstDay(days[0].slice(0, 7))), lte: toDateOnly(lastDay(days[days.length - 1].slice(0, 7))) },
            },
            select: { employeeId: true, date: true, hours: true },
          })
        : [],
    ]);
    const used = new Map<string, number>();
    for (const t of taken) used.set(keyOf(t.employeeId, t.date), halfHours((used.get(keyOf(t.employeeId, t.date)) ?? 0) + hoursOf(t.hours)));
    return rows.map((r) => permissionView(r, caller, names, hiddenRequest(r, caller) ? null : permissionLeft(rules, used.get(keyOf(r.employeeId, r.date)) ?? 0), today));
  }
}

/**
 * Why there is no permission to ask for or record for someone outside the labour law, whose leave isn't theirs either: a
 * freelancer, and an unpaid intern (as access.ts noLeaveMessage says of leave). `name`: the employee's when HR records it.
 */
export function noPermissionMessage(employmentType: string, name: string | null): string {
  if (employmentType === 'intern') {
    return name
      ? `${name} is an unpaid intern, outside the labour law: there is no permission to record for an unpaid internship.`
      : 'You are an unpaid intern, outside the labour law: there is no permission to ask for under an unpaid internship.';
  }
  return name
    ? `${name} is a freelancer, outside the labour law: there is no permission to record for a freelance employment.`
    : 'You work freelance, outside the labour law: there is no permission to ask for under a freelance employment.';
}
